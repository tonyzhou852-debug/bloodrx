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
// Only allow requests from your own site
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || true,
  credentials: true
}));

// Remove server fingerprinting
app.disable("x-powered-by");

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// ── Rate limiting (no extra package needed) ────────────────────
const requestCounts = new Map();
const RATE_LIMIT = 20;      // max requests
const RATE_WINDOW = 60000;  // per 60 seconds

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const now = Date.now();
  const record = requestCounts.get(ip) || { count: 0, start: now };

  if (now - record.start > RATE_WINDOW) {
    record.count = 1;
    record.start = now;
  } else {
    record.count++;
  }

  requestCounts.set(ip, record);

  if (record.count > RATE_LIMIT) {
    return res.status(429).json({ error: "Too many requests. Please wait a minute and try again." });
  }
  next();
}

// Stricter limit for analysis endpoint
const analysisCounts = new Map();
const ANALYSIS_LIMIT = 5; // max 5 analyses per minute per IP

function analysisRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const now = Date.now();
  const record = analysisCounts.get(ip) || { count: 0, start: now };

  if (now - record.start > RATE_WINDOW) {
    record.count = 1;
    record.start = now;
  } else {
    record.count++;
  }

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

  // Check request size (50MB limit already set, but double check)
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

    // Save to database
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

      // Sanitize stored data
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

  const rows = patients.map(p => `
    <tr>
      <td>${escHtml(p.id)}</td>
      <td>${escHtml(p.name)}</td>
      <td>${escHtml(p.phone)}</td>
      <td>${escHtml(p.age)}</td>
      <td>${escHtml(p.gender)}</td>
      <td>${escHtml(p.complaint)}</td>
      <td><span class="sev sev-${escHtml(p.severity)}">${escHtml(p.severity)}</span></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(p.summary)}">${escHtml(p.summary)}</td>
      <td>${escHtml(new Date(p.created_at).toLocaleString())}</td>
    </tr>
  `).join("");

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>BloodRx Admin</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, sans-serif; padding: 2rem; background: #f4f5f7; }
        h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
        .count { font-size: 13px; color: #666; margin-bottom: 1.5rem; margin-top: 4px; }
        .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 10px; }
        .btn { padding: 8px 16px; background: #2563eb; color: white; border: none; border-radius: 8px; font-size: 13px; text-decoration: none; }
        .table-wrap { overflow-x: auto; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
        table { width: 100%; border-collapse: collapse; background: white; min-width: 900px; }
        th { background: #2563eb; color: white; padding: 12px 16px; text-align: left; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
        td { padding: 11px 16px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: #f8faff; }
        .sev { padding: 2px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
        .sev-mild { background: #ecfdf5; color: #059669; }
        .sev-moderate { background: #fffbeb; color: #b45309; }
        .sev-severe, .sev-critical { background: #fef2f2; color: #dc2626; }
        .empty { text-align: center; color: #999; padding: 3rem; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h1>🧬 BloodRx Patient Records</h1>
          <p class="count">${patients.length} total record${patients.length !== 1 ? "s" : ""}</p>
        </div>
        <a href="/" class="btn">← Back to analyzer</a>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Name</th><th>Phone</th><th>Age</th><th>Gender</th>
              <th>Complaint</th><th>Severity</th><th>Summary</th><th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="9" class="empty">No records yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </body>
    </html>
  `);
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
