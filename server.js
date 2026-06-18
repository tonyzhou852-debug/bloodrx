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
app.get("/admin", adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ── Admin data API ─────────────────────────────────────────────
app.get("/api/admin/patients", adminAuth, async (req, res) => {
  try {
    const database = await getDB();
    const patients = await database.collection("patients").find({}).sort({ id: -1 }).toArray();
    res.json(patients);
  } catch(e) {
    res.status(500).json({ error: "Failed to load patients" });
  }
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
