const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3001;

// ── Admin password (set ADMIN_PASSWORD env var in Render) ──────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "bloodrx-admin-2024";

// ── MongoDB ────────────────────────────────────────────────────
let _db = null;
async function getDB() {
  if (_db) return _db;
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  _db = client.db("bloodrx");
  console.log("Connected to MongoDB");
  return _db;
}
getDB().catch(e => console.error("MongoDB startup error:", e.message));

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

      const database = await getDB();
      await database.collection("patients").insertOne(record);
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
app.get("/admin", adminAuth, async (req, res) => {
  const database = await getDB();
  const patients = await database.collection("patients").find({}).sort({ id: -1 }).toArray();

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

  const rows = patients.map((p, idx) => `
    <tr data-idx="${idx}">
      <td style="width:36px;text-align:center">
        <input type="checkbox" class="row-check" data-idx="${idx}" 
          style="width:16px;height:16px;accent-color:var(--brand);cursor:pointer" 
          aria-label="Select record for ${escHtml(p.name)}">
      </td>
      <td style="color:var(--ink-4);font-size:12px">${escHtml(String(p.id).slice(-6))}</td>
      <td><span class="patient-name">${escHtml(p.name)}</span></td>
      <td style="color:var(--ink-3)">${escHtml(p.phone)}</td>
      <td style="color:var(--ink-3)">${escHtml(p.age)}</td>
      <td style="color:var(--ink-3)">${escHtml(p.gender)}</td>
      <td style="color:var(--ink-2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(p.complaint)}">${escHtml(p.complaint)}</td>
      <td><span class="sev sev-${escHtml(p.severity)}">${escHtml(p.severity) || "—"}</span></td>
      <td>${p.summary ? '<button class="summary-btn" onclick="openModal(this)" data-name="' + escHtml(p.name) + '" data-summary="' + escHtml(p.summary) + '" aria-label="View full summary"><span class="summary-preview">' + escHtml(p.summary) + '</span><svg class="expand-ico" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>' : '<span style="color:var(--ink-4)">—</span>'}</td>
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

/* Summary button */
.summary-btn {
  display: flex; align-items: flex-start; gap: 6px;
  background: none; border: none; cursor: pointer; padding: 0;
  font-family: inherit; text-align: left; color: var(--ink-2);
  font-size: 12px; line-height: 1.5; max-width: 240px;
  transition: color .15s;
}
.summary-btn:hover { color: var(--brand); }
.summary-btn:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 2px; }
.summary-preview {
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; flex: 1;
}
.expand-ico { flex-shrink: 0; margin-top: 2px; opacity: .5; }
.summary-btn:hover .expand-ico { opacity: 1; }

/* Modal */
.modal-overlay {
  display: none; position: fixed; inset: 0;
  background: rgba(0,0,0,.45); z-index: 200;
  align-items: center; justify-content: center; padding: 24px;
}
.modal-overlay.open { display: flex; }
.modal {
  background: var(--surface); border-radius: var(--radius-lg);
  box-shadow: 0 20px 60px rgba(0,0,0,.2);
  width: 100%; max-width: 540px;
  animation: modalIn .2s ease-out;
}
@keyframes modalIn { from { opacity:0; transform:scale(.96) translateY(8px) } to { opacity:1; transform:scale(1) translateY(0) } }
.modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px; border-bottom: 1px solid var(--border);
}
.modal-title { font-size: 14px; font-weight: 600; color: var(--ink); }
.modal-patient { font-size: 12px; color: var(--ink-3); margin-top: 2px; }
.modal-close {
  width: 32px; height: 32px; border-radius: 6px;
  background: none; border: 1px solid var(--border);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  color: var(--ink-3); transition: border-color .15s, color .15s;
  font-size: 16px; flex-shrink: 0;
}
.modal-close:hover { border-color: var(--brand); color: var(--brand); }
.modal-close:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.modal-body { padding: 20px; font-size: 14px; color: var(--ink-2); line-height: 1.75; }

/* Download option buttons */
.dl-opt-btn {
  width: 100%; display: flex; align-items: center; gap: 14px;
  padding: 14px 16px; background: var(--surface);
  border: 1.5px solid var(--border); border-radius: var(--radius);
  cursor: pointer; font-family: inherit; text-align: left;
  transition: border-color .15s, background .15s;
}
.dl-opt-btn:hover:not(:disabled) { border-color: var(--brand); background: var(--brand-bg); }
.dl-opt-btn svg { flex-shrink: 0; stroke: var(--brand); }

/* CSV button */
.csv-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 14px; min-height: 36px;
  background: var(--brand); color: #fff;
  border: none; border-radius: var(--radius-sm);
  font-size: 12px; font-weight: 600; font-family: inherit;
  cursor: pointer; transition: background .15s;
  touch-action: manipulation;
}
.csv-btn:hover { background: var(--brand-dark, #991b1b); }
.csv-btn:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }

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
      <div style="display:flex;align-items:center;gap:10px">
        <span class="record-count">${total} record${total !== 1 ? "s" : ""}</span>
        <button onclick="openDownloadPanel()" class="csv-btn" id="download-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download CSV
        </button>
      </div>
    </div>

    ${total > 0 ? '<div class="search-wrap" style="padding-top:1rem"><input type="search" class="search-input" id="search-input" placeholder="Filter by name, complaint, severity" aria-label="Filter records" oninput="filterTable(this.value)"></div>' : ""}

    <div class="table-wrap">
      <table id="records-table" aria-label="Patient analysis records">
        <thead>
          <tr>
            <th scope="col" style="width:36px;text-align:center">
              <input type="checkbox" id="select-all-check" 
                style="width:16px;height:16px;accent-color:var(--brand);cursor:pointer"
                aria-label="Select all records"
                onchange="toggleAll(this.checked)">
            </th>
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
          ${rows || '<tr><td colspan="10"><div class="empty-state"><p>No records yet. Analyses will appear here after submission.</p></div></td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <footer class="site-footer">
    <p>BloodRx Admin &nbsp;·&nbsp; For authorized use only &nbsp;·&nbsp; All data is patient-confidential</p>
  </footer>

</main>

<!-- Summary modal -->
<div class="modal-overlay" id="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title" onclick="if(event.target===this)closeModal()">
  <div class="modal">
    <div class="modal-head">
      <div>
        <div class="modal-title" id="modal-title">Clinical Summary</div>
        <div class="modal-patient" id="modal-patient"></div>
      </div>
      <button class="modal-close" onclick="closeModal()" aria-label="Close">&#x2715;</button>
    </div>
    <div class="modal-body" id="modal-body"></div>
  </div>
</div>

<!-- Download panel -->
<div class="modal-overlay" id="dl-overlay" role="dialog" aria-modal="true" aria-labelledby="dl-title" onclick="if(event.target===this)closeDL()">
  <div class="modal" style="max-width:420px">
    <div class="modal-head">
      <div>
        <div class="modal-title" id="dl-title">Download CSV</div>
        <div class="modal-patient" id="dl-sub">Choose which records to export</div>
      </div>
      <button class="modal-close" onclick="closeDL()" aria-label="Close">&#x2715;</button>
    </div>
    <div class="modal-body" style="padding:20px;display:flex;flex-direction:column;gap:12px">
      <button class="dl-opt-btn" id="dl-all-btn" onclick="doDownload('all')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
        <div>
          <div style="font-weight:600;font-size:14px">Download All Records</div>
          <div id="dl-all-count" style="font-size:12px;color:var(--ink-3);margin-top:2px"></div>
        </div>
      </button>
      <button class="dl-opt-btn" id="dl-sel-btn" onclick="doDownload('selected')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
        <div>
          <div style="font-weight:600;font-size:14px">Download Selected Only</div>
          <div id="dl-sel-count" style="font-size:12px;color:var(--ink-3);margin-top:2px"></div>
        </div>
      </button>
    </div>
  </div>
</div>

<script>
/* ── Select / deselect ── */
function toggleAll(checked) {
  document.querySelectorAll('.row-check').forEach(cb => {
    const row = cb.closest('tr');
    if (row.style.display !== 'none') cb.checked = checked;
  });
  updateSelectionBar();
}

function updateSelectionBar() {
  const all = document.querySelectorAll('.row-check');
  const checked = document.querySelectorAll('.row-check:checked');
  const selectAllCb = document.getElementById('select-all-check');
  if (selectAllCb) {
    selectAllCb.indeterminate = checked.length > 0 && checked.length < all.length;
    selectAllCb.checked = checked.length === all.length && all.length > 0;
  }
}

document.addEventListener('change', e => {
  if (e.target.classList.contains('row-check')) updateSelectionBar();
});

/* ── Download panel ── */
function openDownloadPanel() {
  const all = document.querySelectorAll('#records-body tr:not([style*="display: none"])');
  const sel = document.querySelectorAll('.row-check:checked');
  document.getElementById('dl-all-count').textContent = all.length + ' record' + (all.length !== 1 ? 's' : '');
  document.getElementById('dl-sel-count').textContent = sel.length + ' record' + (sel.length !== 1 ? 's' : '') + ' selected';
  const selBtn = document.getElementById('dl-sel-btn');
  selBtn.disabled = sel.length === 0;
  selBtn.style.opacity = sel.length === 0 ? '0.45' : '1';
  selBtn.style.cursor = sel.length === 0 ? 'not-allowed' : 'pointer';
  document.getElementById('dl-overlay').classList.add('open');
}
function closeDL() {
  document.getElementById('dl-overlay').classList.remove('open');
}

function doDownload(mode) {
  const headers = ['ID','Name','Phone','Age','Gender','Complaint','Severity','Summary','Date'];
  let rows;
  if (mode === 'all') {
    rows = document.querySelectorAll('#records-body tr:not([style*="display: none"])');
  } else {
    rows = Array.from(document.querySelectorAll('.row-check:checked')).map(cb => cb.closest('tr'));
  }
  const csvRows = [headers.map(h => '"' + h + '"').join(',')];
  rows.forEach(row => {
    const cells = Array.from(row.querySelectorAll('td')).slice(1); // skip checkbox cell
    csvRows.push(cells.map(cell => {
      const text = cell.textContent.replace(/\s+/g, ' ').trim();
      return '"' + text.replace(/"/g, '""') + '"';
    }).join(','));
  });
  const csv = csvRows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'bloodrx-' + mode + '-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  closeDL();
}

/* ── Filter ── */
function filterTable(query) {
  const q = query.toLowerCase().trim();
  const rows = document.querySelectorAll('#records-body tr');
  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
}

/* ── Summary modal ── */
function openModal(btn) {
  const name = btn.dataset.name || '';
  const summary = btn.dataset.summary || '';
  document.getElementById('modal-patient').textContent = name;
  document.getElementById('modal-body').textContent = summary;
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.add('open');
  overlay.querySelector('.modal-close').focus();
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeDL(); }
});
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
