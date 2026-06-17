const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3001;

// ── Admin password (set ADMIN_PASSWORD env var in Render) ──────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "bloodrx-admin-2024";

// ── Simple JSON file database ──────────────────────────────────
const DB_FILE = "/tmp/bloodrx.json";
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return { patients: [] }; }
}
function saveDB(data) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }
  catch(e) { console.log("DB save error:", e.message); }
}

// ── Security middleware ────────────────────────────────────────
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || true,
  credentials: true
}));

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// ── Rate limiting ──────────────────────────────────────────────
const requestCounts = new Map();
const RATE_LIMIT = 20;
const RATE_WINDOW = 60000;

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const now = Date.now();
  const record = requestCounts.get(ip) || { count: 0, start: now };
  if (now - record.start > RATE_WINDOW) { record.count = 1; record.start = now; }
  else { record.count++; }
  requestCounts.set(ip, record);
  if (record.count > RATE_LIMIT) {
    return res.status(429).json({ error: "Too many requests. Please wait a minute and try again." });
  }
  next();
}

const analysisCounts = new Map();
const ANALYSIS_LIMIT = 5;

function analysisRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const now = Date.now();
  const record = analysisCounts.get(ip) || { count: 0, start: now };
  if (now - record.start > RATE_WINDOW) { record.count = 1; record.start = now; }
  else { record.count++; }
  analysisCounts.set(ip, record);
  if (record.count > ANALYSIS_LIMIT) {
    return res.status(429).json({ error: "Analysis rate limit reached. Please wait a minute." });
  }
  next();
}

// ── Input validation ───────────────────────────────────────────
function validateAnalysisRequest(req, res, next) {
  const body = req.body;
  if (!body || !body.messages || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: "Invalid request format." });
  }
  if (body.messages.length === 0 || body.messages.length > 10) {
    return res.status(400).json({ error: "Invalid number of messages." });
  }
  const bodyStr = JSON.stringify(body);
  if (bodyStr.length > 52428800) {
    return res.status(413).json({ error: "Request too large." });
  }
  next();
}

// ── Admin authentication ───────────────────────────────────────
function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="BloodRx Admin"');
    return res.status(401).send("Authentication required.");
  }
  const credentials = Buffer.from(auth.slice(6), "base64").toString("utf8");
  const [username, password] = credentials.split(":");
  const validUser = username === "admin";
  const validPass = crypto.timingSafeEqual(
    Buffer.from(password || ""),
    Buffer.from(ADMIN_PASSWORD)
  );
  if (!validUser || !validPass) {
    res.setHeader("WWW-Authenticate", 'Basic realm="BloodRx Admin"');
    return res.status(401).send("Invalid credentials.");
  }
  next();
}

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: false, limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── Analysis route ─────────────────────────────────────────────
app.post("/api/analyze", rateLimit, analysisRateLimit, validateAnalysisRequest, async (req, res) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server configuration error." });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8096,
        system: "You are a clinical analysis assistant. Return ONLY a valid JSON object. Be concise — keep findings to the 10 most important markers only, antibiotics to maximum 3 recommendations, and keep all text fields under 200 characters each. Never truncate the JSON — always close all brackets properly.",
        messages: req.body.messages,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: "Analysis service error. Please try again." });
    }

    const text = data.content.map(b => b.text || "").join("");

    try {
      const clean = text.replace(/```json|```/g, "").trim();
      const result = JSON.parse(clean);

      const promptText = req.body.messages
        .map(m => typeof m.content === "string" ? m.content :
          Array.isArray(m.content) ? m.content.filter(p => p.type === "text").map(p => p.text).join(" ") : "")
        .join(" ");

      const nameMatch      = promptText.match(/Name:\s*(.+)/);
      const phoneMatch     = promptText.match(/Phone:\s*(.+)/);
      const ageMatch       = promptText.match(/Age:\s*(.+)/);
      const genderMatch    = promptText.match(/Gender:\s*(.+)/);
      const complaintMatch = promptText.match(/Chief complaint:\s*(.+)/);
      const notesMatch     = promptText.match(/Clinical notes[^:]*:\s*(.+)/);

      const sanitize = (str) => (str || "").replace(/<[^>]*>/g, "").trim().slice(0, 500);

      const record = {
        id:        Date.now(),
        name:      sanitize(nameMatch?.[1])      || "Unknown",
        phone:     sanitize(phoneMatch?.[1])     || "",
        age:       sanitize(ageMatch?.[1])       || "",
        gender:    sanitize(genderMatch?.[1])    || "",
        complaint: sanitize(complaintMatch?.[1]) || "",
        notes:     sanitize(notesMatch?.[1])     || "",
        severity:  sanitize(result.severity)     || "",
        summary:   sanitize(result.summary)      || "",
        ip:        req.ip || "",
        created_at: new Date().toISOString()
      };

      const dbData = loadDB();
      dbData.patients.push(record);
      saveDB(dbData);
    } catch (e) {
      console.log("Could not save to DB:", e.message);
    }

    res.json(data);

  } catch (err) {
    console.error("Analysis error:", err.message);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

// ── Admin route (password protected) ──────────────────────────
app.get("/admin", adminAuth, (req, res) => {
  const dbData = loadDB();
  const patients = [...dbData.patients].reverse();

  const escHtml = s => String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Stats
  const total    = patients.length;
  const today    = patients.filter(p => new Date(p.created_at).toDateString() === new Date().toDateString()).length;
  const severe   = patients.filter(p => p.severity === "severe" || p.severity === "critical").length;
  const moderate = patients.filter(p => p.severity === "moderate").length;

  const rows = patients.map(p => `
    <tr>
      <td style="color:var(--ink-4);font-size:12px">${escHtml(String(p.id).slice(-6))}</td>
      <td><span class="patient-name">${escHtml(p.name)}</span></td>
      <td style="color:var(--ink-3)">${escHtml(p.phone)}</td>
      <td style="color:var(--ink-3)">${escHtml(p.age)}</td>
      <td style="color:var(--ink-3)">${escHtml(p.gender)}</td>
      <td style="color:var(--ink-2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(p.complaint)}">${escHtml(p.complaint)}</td>
      <td><span class="sev sev-${escHtml(p.severity)}">${escHtml(p.severity) || "—"}</span></td>
      <td style="color:var(--ink-3);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px" title="${escHtml(p.summary)}">${escHtml(p.summary)}</td>
      <td style="color:var(--ink-4);font-size:12px;white-space:nowrap">${escHtml(new Date(p.created_at).toLocaleString("en-GB", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }))}</td>
    </tr>
  `).join("");

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin — BloodRx</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap&font-display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --ink:       #111827;
  --ink-2:     #374151;
  --ink-3:     #6b7280;
  --ink-4:     #9ca3af;
  --border:    #e5e7eb;
  --surface:   #ffffff;
  --bg:        #f7f8f9;
  --bg-2:      #f3f4f6;
  --brand:     #b91c1c;
  --brand-bg:  #fff1f1;
  --brand-bd:  #fecaca;
  --green:     #059669;
  --green-bg:  #ecfdf5;
  --green-bd:  #a7f3d0;
  --amber:     #b45309;
  --amber-bg:  #fffbeb;
  --amber-bd:  #fde68a;
  --red:       #dc2626;
  --red-bg:    #fef2f2;
  --red-bd:    #fecaca;
  --radius-sm: 6px;
  --radius:    10px;
  --radius-lg: 14px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.05);
  --shadow:    0 1px 3px rgba(0,0,0,.07), 0 1px 2px rgba(0,0,0,.04);
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }

html { scroll-behavior: smooth; }
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px; line-height: 1.6;
  color: var(--ink); background: var(--bg);
  min-height: 100vh; -webkit-font-smoothing: antialiased;
}

/* ── Nav ── */
.topbar {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 50;
  box-shadow: var(--shadow-sm);
}
.topbar-inner {
  max-width: 1400px; margin: 0 auto;
  padding: 0 1.5rem; height: 60px;
  display: flex; align-items: center; gap: 12px;
}
.logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
.logo-icon {
  width: 32px; height: 32px; border-radius: 8px;
  background: var(--brand);
  display: flex; align-items: center; justify-content: center;
}
.logo-icon svg { width: 16px; height: 16px; fill: none; stroke: #fff; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.logo-text { font-size: 15px; font-weight: 700; color: var(--ink); letter-spacing: -.2px; }
.logo-text em { color: var(--brand); font-style: normal; }
.admin-badge {
  font-size: 10px; font-weight: 600; letter-spacing: .05em;
  background: var(--brand-bg); color: var(--brand);
  border: 1px solid var(--brand-bd); border-radius: 4px;
  padding: 2px 8px; text-transform: uppercase;
}
.topbar-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.back-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 7px 14px; min-height: 36px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-sm); font-size: 13px; font-weight: 500;
  color: var(--ink-2); text-decoration: none;
  transition: border-color .15s, color .15s;
}
.back-btn:hover { border-color: var(--brand); color: var(--brand); }
.back-btn:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }

/* ── Page ── */
.page { max-width: 1400px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }

/* ── Page header ── */
.page-header { margin-bottom: 1.75rem; }
.page-header h1 { font-size: 22px; font-weight: 700; letter-spacing: -.3px; margin-bottom: 2px; }
.page-header p { font-size: 13px; color: var(--ink-3); }

/* ── Stat cards ── */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px; margin-bottom: 1.5rem;
}
.stat-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 1rem 1.25rem;
  box-shadow: var(--shadow-sm);
}
.stat-label { font-size: 11px; font-weight: 600; color: var(--ink-3); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
.stat-value { font-size: 28px; font-weight: 700; letter-spacing: -.03em; color: var(--ink); line-height: 1; }
.stat-card.brand .stat-value { color: var(--brand); }
.stat-card.amber .stat-value { color: var(--amber); }
.stat-card.red   .stat-value { color: var(--red); }

/* ── Table card ── */
.table-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius-lg); box-shadow: var(--shadow);
  overflow: hidden;
}
.table-card-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 1rem 1.25rem; border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.table-card-head h2 { font-size: 13px; font-weight: 600; color: var(--ink); }
.record-count {
  font-size: 12px; font-weight: 500; color: var(--ink-3);
  background: var(--bg-2); border: 1px solid var(--border);
  border-radius: 20px; padding: 2px 10px;
}
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; min-width: 900px; }
thead tr { border-bottom: 1px solid var(--border); }
th {
  padding: 10px 14px; font-size: 11px; font-weight: 600;
  color: var(--ink-3); text-transform: uppercase; letter-spacing: .05em;
  text-align: left; white-space: nowrap; background: var(--bg-2);
}
td { padding: 11px 14px; border-bottom: 1px solid var(--border); font-size: 13px; vertical-align: middle; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #fafafa; }

.patient-name { font-weight: 600; color: var(--ink); }

/* Severity badges — matching main site */
.sev {
  display: inline-block; padding: 2px 10px;
  border-radius: 20px; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .05em; white-space: nowrap;
}
.sev-mild     { background: var(--green-bg); color: var(--green); border: 1px solid var(--green-bd); }
.sev-moderate { background: var(--amber-bg); color: var(--amber); border: 1px solid var(--amber-bd); }
.sev-severe   { background: var(--red-bg);   color: var(--red);   border: 1px solid var(--red-bd); }
.sev-critical { background: var(--red-bg);   color: var(--red);   border: 1px solid var(--red-bd); }

/* Empty state */
.empty-state {
  text-align: center; padding: 4rem 2rem;
  color: var(--ink-3);
}
.empty-state svg { width: 40px; height: 40px; stroke: var(--border); margin-bottom: 12px; }
.empty-state p { font-size: 14px; }

/* Search bar */
.search-wrap { padding: 0 1.25rem 1rem; }
.search-input {
  width: 100%; max-width: 320px; padding: 8px 12px;
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  font-size: 13px; font-family: inherit; color: var(--ink);
  background: var(--surface); outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.search-input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px rgba(185,28,28,.1); }

/* Footer */
.site-footer {
  text-align: center; font-size: 12px; color: var(--ink-4);
  margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--border);
}
</style>
</head>
<body>

<nav class="topbar" aria-label="Admin navigation">
  <div class="topbar-inner">
    <a href="/" class="logo" aria-label="BloodRx home">
      <div class="logo-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 2L8 9H3l4.5 5.5L5 22l7-4.5L19 22l-2.5-7.5L21 9h-5L12 2z"/></svg>
      </div>
      <span class="logo-text">Blood<em>Rx</em></span>
    </a>
    <span class="admin-badge">Admin</span>
    <div class="topbar-right">
      <a href="/" class="back-btn" aria-label="Back to analyzer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
        Back to Analyzer
      </a>
    </div>
  </div>
</nav>

<main class="page">

  <div class="page-header">
    <h1>Patient Records</h1>
    <p>All analyses submitted through BloodRx — most recent first</p>
  </div>

  <!-- Stat cards -->
  <div class="stats-grid" role="list" aria-label="Summary statistics">
    <div class="stat-card" role="listitem">
      <div class="stat-label">Total Records</div>
      <div class="stat-value">${total}</div>
    </div>
    <div class="stat-card brand" role="listitem">
      <div class="stat-label">Today</div>
      <div class="stat-value">${today}</div>
    </div>
    <div class="stat-card amber" role="listitem">
      <div class="stat-label">Moderate</div>
      <div class="stat-value">${moderate}</div>
    </div>
    <div class="stat-card red" role="listitem">
      <div class="stat-label">Severe / Critical</div>
      <div class="stat-value">${severe}</div>
    </div>
  </div>

  <!-- Records table -->
  <div class="table-card" role="region" aria-label="Patient records table">
    <div class="table-card-head">
      <h2>All Analyses</h2>
      <span class="record-count">${total} record${total !== 1 ? "s" : ""}</span>
    </div>

    ${total > 0 ? `
    <div class="search-wrap" style="padding-top:1rem">
      <input type="search" class="search-input" id="search-input"
        placeholder="Filter by name, complaint, severity…"
        aria-label="Filter records"
        oninput="filterTable(this.value)">
    </div>` : ""}

    <div class="table-wrap">
      <table id="records-table" aria-label="Patient analysis records">
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Name</th>
            <th scope="col">Phone</th>
            <th scope="col">Age</th>
            <th scope="col">Gender</th>
            <th scope="col">Complaint</th>
            <th scope="col">Severity</th>
            <th scope="col">Summary</th>
            <th scope="col">Date</th>
          </tr>
        </thead>
        <tbody id="records-body">
          ${rows || `
          <tr>
            <td colspan="9">
              <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
                <p>No records yet. Analyses will appear here after submission.</p>
              </div>
            </td>
          </tr>`}
        </tbody>
      </table>
    </div>
  </div>

  <footer class="site-footer">
    <p>BloodRx Admin &nbsp;·&nbsp; For authorized use only &nbsp;·&nbsp; All data is patient-confidential</p>
  </footer>

</main>

<script>
function filterTable(query) {
  const q = query.toLowerCase().trim();
  const rows = document.querySelectorAll('#records-body tr');
  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
}
</script>
</body>
</html>`);
});

// Block common attack paths
app.use((req, res, next) => {
  const blocked = [".env", ".git", "wp-admin", "phpinfo", "config.php"];
  if (blocked.some(b => req.path.includes(b))) {
    return res.status(404).send("Not found.");
  }
  next();
});

// Legal pages
app.get("/terms", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "terms.html"));
});

app.get("/privacy", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "privacy.html"));
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "An error occurred. Please try again." });
});

app.listen(PORT, () => {
  console.log(`BloodRx server running on port ${PORT}`);
});
