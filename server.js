const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3001;

// ── Environment validation on startup ─────────────────────────
const REQUIRED_ENV = ["ANTHROPIC_API_KEY", "MONGODB_URI", "ADMIN_PASSWORD"];
REQUIRED_ENV.forEach(key => {
  if (!process.env[key]) console.warn(`WARNING: ${key} not set in environment`);
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "bloodrx-admin-2024";

// ── MongoDB ────────────────────────────────────────────────────
let _db = null;
async function getDB() {
  if (_db) return _db;
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
  });
  await client.connect();
  _db = client.db("bloodrx");
  console.log("Connected to MongoDB");
  return _db;
}
getDB().catch(e => console.error("MongoDB startup error:", e.message));

// ── IP Geolocation / Language detection ───────────────────────
const LANG_MAP = { CN: "zh-CN", HK: "zh-TW", TW: "zh-TW", MO: "zh-TW" };
const ipLangCache = new Map();

app.get("/api/lang", async (req, res) => {
  res.setHeader("Cache-Control", "private, max-age=86400");
  const ip = (req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
  if (ipLangCache.has(ip)) return res.json(ipLangCache.get(ip));
  try {
    const r = await fetch("http://ip-api.com/json/" + ip + "?fields=countryCode");
    const data = await r.json();
    const result = { lang: LANG_MAP[data.countryCode] || "en", country: data.countryCode };
    ipLangCache.set(ip, result);
    setTimeout(() => ipLangCache.delete(ip), 86400000);
    res.json(result);
  } catch(e) {
    res.json({ lang: "en", country: null });
  }
});

// ── Trust Render proxy ─────────────────────────────────────────
app.set("trust proxy", 1);

// ── Security headers (comprehensive) ──────────────────────────
app.disable("x-powered-by");
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");
  // Prevent MIME sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  // XSS protection (legacy browsers)
  res.setHeader("X-XSS-Protection", "1; mode=block");
  // Referrer policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Content Security Policy
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data:; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none';"
  );
  // Permissions policy — disable unnecessary browser features
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  // HSTS — force HTTPS (only effective over HTTPS)
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // Prevent caching of sensitive pages
  if (req.path.startsWith("/api/") || req.path.startsWith("/admin")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
  }
  next();
});

// ── CORS — only allow same origin ─────────────────────────────
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || null;
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, curl for dev)
    if (!origin) return callback(null, true);
    // In production lock to specific domain
    if (ALLOWED_ORIGIN && origin !== ALLOWED_ORIGIN) {
      return callback(new Error("CORS policy violation"), false);
    }
    callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// ── Rate limiting (persistent per-IP sliding window) ──────────
const rateLimits = new Map();

function makeRateLimiter(limit, windowMs, message) {
  return (req, res, next) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    const key = ip;
    let record = rateLimits.get(key) || { timestamps: [] };
    // Remove timestamps outside window
    record.timestamps = record.timestamps.filter(t => now - t < windowMs);
    if (record.timestamps.length >= limit) {
      const retryAfter = Math.ceil((record.timestamps[0] + windowMs - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      res.setHeader("X-RateLimit-Limit", limit);
      res.setHeader("X-RateLimit-Remaining", 0);
      return res.status(429).json({ error: message });
    }
    record.timestamps.push(now);
    rateLimits.set(key, record);
    res.setHeader("X-RateLimit-Limit", limit);
    res.setHeader("X-RateLimit-Remaining", limit - record.timestamps.length);
    next();
  };
}

// Clean up old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimits.entries()) {
    record.timestamps = record.timestamps.filter(t => now - t < 3600000);
    if (record.timestamps.length === 0) rateLimits.delete(key);
  }
}, 300000);

const globalLimit   = makeRateLimiter(30,  60000,  "Too many requests. Please wait and try again.");
const analysisLimit = makeRateLimiter(5,   60000,  "Analysis rate limit reached. Please wait a minute.");
const adminLimit    = makeRateLimiter(20,  60000,  "Too many admin requests.");

// ── Admin brute-force lockout ──────────────────────────────────
const adminFailures = new Map();
const MAX_ADMIN_FAILURES = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

function adminBruteForceProtection(req, res, next) {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const record = adminFailures.get(ip) || { count: 0, lockedUntil: 0, lastAttempt: 0 };

  if (now < record.lockedUntil) {
    const remaining = Math.ceil((record.lockedUntil - now) / 60000);
    res.setHeader("WWW-Authenticate", 'Basic realm="VHS Admin"');
    return res.status(429).send(`Too many failed attempts. Try again in ${remaining} minutes.`);
  }

  req._adminIp = ip;
  next();
}

function recordAdminFailure(ip) {
  const now = Date.now();
  const record = adminFailures.get(ip) || { count: 0, lockedUntil: 0 };
  record.count++;
  record.lastAttempt = now;
  if (record.count >= MAX_ADMIN_FAILURES) {
    record.lockedUntil = now + LOCKOUT_DURATION;
    record.count = 0;
    console.warn(`Admin lockout triggered for IP: ${ip}`);
  }
  adminFailures.set(ip, record);
}

function clearAdminFailure(ip) {
  adminFailures.delete(ip);
}

// ── Input validation ───────────────────────────────────────────
function validateAnalysisRequest(req, res, next) {
  const body = req.body;
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "Invalid request." });
  }
  if (!body.messages || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: "Invalid request format." });
  }
  if (body.messages.length === 0 || body.messages.length > 10) {
    return res.status(400).json({ error: "Invalid number of messages." });
  }
  // Validate each message structure
  for (const msg of body.messages) {
    if (!msg.role || !["user", "assistant"].includes(msg.role)) {
      return res.status(400).json({ error: "Invalid message role." });
    }
    if (!msg.content) {
      return res.status(400).json({ error: "Invalid message content." });
    }
  }
  // Strict size limit
  const bodySize = JSON.stringify(body).length;
  if (bodySize > 52428800) {
    return res.status(413).json({ error: "Request too large." });
  }
  next();
}

// ── Admin authentication ───────────────────────────────────────
function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="VHS Admin"');
    return res.status(401).send("Authentication required.");
  }

  let credentials;
  try {
    credentials = Buffer.from(auth.slice(6), "base64").toString("utf8");
  } catch {
    res.setHeader("WWW-Authenticate", 'Basic realm="VHS Admin"');
    return res.status(401).send("Invalid credentials.");
  }

  const colonIdx = credentials.indexOf(":");
  if (colonIdx === -1) {
    recordAdminFailure(req._adminIp || req.ip);
    res.setHeader("WWW-Authenticate", 'Basic realm="VHS Admin"');
    return res.status(401).send("Invalid credentials.");
  }

  const username = credentials.slice(0, colonIdx);
  const password = credentials.slice(colonIdx + 1);

  // Constant-time comparison for both username and password
  const validUser = username.length === "admin".length &&
    crypto.timingSafeEqual(Buffer.from(username.padEnd(32)), Buffer.from("admin".padEnd(32)));

  const storedPass = Buffer.from(ADMIN_PASSWORD);
  const providedPass = Buffer.from(password || "");
  const passBuffer = Buffer.alloc(storedPass.length);
  providedPass.copy(passBuffer, 0, 0, Math.min(providedPass.length, storedPass.length));

  let validPass = false;
  try {
    validPass = providedPass.length === storedPass.length &&
      crypto.timingSafeEqual(passBuffer, storedPass);
  } catch { validPass = false; }

  if (!validUser || !validPass) {
    recordAdminFailure(req._adminIp || req.ip);
    res.setHeader("WWW-Authenticate", 'Basic realm="VHS Admin"');
    return res.status(401).send("Invalid credentials.");
  }

  clearAdminFailure(req._adminIp || req.ip);
  next();
}

// ── Body parsers ───────────────────────────────────────────────
app.use(express.json({ limit: "50mb", strict: true }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// ── Static files ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-store");
    }
  }
}));

// ── Block common attack paths ──────────────────────────────────
const BLOCKED_PATHS = [
  ".env", ".git", "wp-admin", "phpinfo", "config.php",
  "wp-login", "phpmyadmin", "admin.php", ".htaccess",
  "xmlrpc.php", "shell.php", "eval", "base64_decode",
  "/.well-known/acme", "/cgi-bin", "/proc/", "/etc/passwd"
];

app.use((req, res, next) => {
  const lowerPath = req.path.toLowerCase();
  if (BLOCKED_PATHS.some(b => lowerPath.includes(b))) {
    console.warn(`Blocked request: ${req.ip} -> ${req.path}`);
    return res.status(404).send("Not found.");
  }
  next();
});

// ── Analysis route ─────────────────────────────────────────────
app.post("/api/analyze", globalLimit, analysisLimit, validateAnalysisRequest, async (req, res) => {
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
        system: "You are a corporate health and wellness analyst. Return ONLY a valid JSON object. Be concise — keep findings to the 10 most important markers only, keep all text fields under 200 characters each. Never truncate the JSON — always close all brackets properly. Do NOT include any medication names, antibiotic recommendations, or prescriptions.",
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
      const complaintMatch = promptText.match(/Health concern:\s*(.+)/);
      const notesMatch     = promptText.match(/Health notes:\s*(.+)/);

      const sanitize = (str) => (str || "")
        .replace(/<[^>]*>/g, "")   // strip HTML
        .replace(/[^\x20-\x7E\u00C0-\u024F\u4E00-\u9FFF\u3400-\u4DBF\uAC00-\uD7AF]/g, "") // allow ASCII + CJK + Latin ext
        .trim()
        .slice(0, 500);

      const record = {
        id:                    Date.now(),
        name:                  sanitize(nameMatch?.[1])      || "Unknown",
        phone:                 sanitize(phoneMatch?.[1])     || "",
        age:                   sanitize(ageMatch?.[1])       || "",
        gender:                sanitize(genderMatch?.[1])    || "",
        complaint:             sanitize(complaintMatch?.[1]) || "",
        notes:                 sanitize(notesMatch?.[1])     || "",
        vhs_score:             Number(result.vhs_score)      || 0,
        vhs_label:             sanitize(result.vhs_label)    || "",
        summary:               sanitize(result.health_assessment) || "",
        key_health_concerns:   sanitize(result.key_health_concerns) || "",
        detected_languages:    sanitize(result.detected_languages) || "",
        risk_cardiovascular:   Number(result.risk_profile?.cardiovascular?.score) || 0,
        risk_metabolic:        Number(result.risk_profile?.metabolic?.score) || 0,
        risk_liver:            Number(result.risk_profile?.liver?.score) || 0,
        risk_kidney:           Number(result.risk_profile?.kidney?.score) || 0,
        risk_inflammation:     Number(result.risk_profile?.inflammation?.score) || 0,
        nutrition:             (result.nutrition_recommendations||[]).map(s=>sanitize(s)).join(" | ").slice(0,500),
        lifestyle:             (result.lifestyle_recommendations||[]).map(s=>sanitize(s)).join(" | ").slice(0,500),
        supplements:           (result.nutritional_support||[]).map(s=>sanitize(s)).join(" | ").slice(0,500),
        monitoring_plan:       sanitize(result.monitoring_plan) || "",
        ip:                    req.ip || "",
        created_at:            new Date().toISOString()
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

// ── Admin routes (protected) ───────────────────────────────────
app.get("/admin", adminBruteForceProtection, adminLimit, adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/api/admin/patients", adminBruteForceProtection, adminLimit, adminAuth, async (req, res) => {
  try {
    const database = await getDB();
    // Never expose internal MongoDB _id or IP to frontend
    const patients = await database.collection("patients")
      .find({}, { projection: { _id: 0, ip: 0 } })
      .sort({ id: -1 })
      .limit(1000) // safety cap
      .toArray();
    res.json(patients);
  } catch(e) {
    res.status(500).json({ error: "Failed to load records." });
  }
});

// ── Help Bot route ────────────────────────────────────────────
const botLimit = makeRateLimiter(20, 60000, "Too many bot requests. Please wait a minute.");

const BOT_SYSTEM = `You are the VHS Help Assistant for VANDL Health Score platform. Your ONLY job is to help users understand how to submit their health report and interpret their VHS wellness results.

STRICTLY LIMITED to these topics:
1. How to fill in the form (name, phone, age, gender, complaint, notes)
2. How to upload files (PDF, JPG, PNG, TXT, CSV — max 20MB, multiple files supported)
3. How to select document language
4. What the consent checkbox means
5. How to click Generate Health Assessment
6. What the VHS Health Score (0-100) means: 90-100 Excellent, 75-89 Good, 60-74 Fair, 40-59 Needs Attention, 0-39 Poor
7. What the 5 risk categories mean: Cardiovascular, Metabolic, Liver, Kidney, Inflammation scored 1-5
8. What Nutrition, Lifestyle, Nutritional Support, and Monitoring Plan sections mean
9. Why results are in English (auto-translated)
10. How to start a new assessment

REFUSE everything else — medical advice, data privacy, pricing, technical issues, anything unrelated.
If asked anything outside scope: "I can only help with submitting your health report and understanding your VHS results."
Keep responses under 3 sentences. Be friendly and clear.`;

app.post("/api/bot", globalLimit, botLimit, async (req, res) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: "Configuration error." });

  const { messages, translate } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0 || messages.length > 12) {
    return res.status(400).json({ error: "Invalid request." });
  }
  // Validate messages — translation requests get higher content limit
  const contentLimit = translate ? 8000 : 1000;
  for (const m of messages) {
    if (!["user","assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > contentLimit) {
      return res.status(400).json({ error: "Invalid message." });
    }
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
        max_tokens: translate ? 2000 : 300,
        system: translate ? "You are a professional medical translator. Translate the provided JSON fields accurately. Return ONLY valid JSON with the same keys. Never add explanations or markdown." : BOT_SYSTEM,
        messages: messages.slice(-6),
      }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: "Bot unavailable." });
    const reply = data.content?.[0]?.text || "Sorry, I could not respond.";
    res.json({ reply });
  } catch(e) {
    res.status(500).json({ error: "Bot unavailable." });
  }
});

// ── Admin delete endpoint ─────────────────────────────────────
app.post("/api/admin/patients/delete", adminBruteForceProtection, adminLimit, adminAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0 || ids.length > 100) {
      return res.status(400).json({ error: "Invalid request." });
    }
    // Convert ids to numbers (they are stored as timestamps)
    const numIds = ids.map(id => Number(id)).filter(n => !isNaN(n) && n > 0);
    if (numIds.length === 0) return res.status(400).json({ error: "No valid IDs." });

    const database = await getDB();
    const result = await database.collection("patients").deleteMany({ id: { $in: numIds } });
    res.json({ deleted: result.deletedCount });
  } catch(e) {
    console.error("Delete error:", e.message);
    res.status(500).json({ error: "Delete failed." });
  }
});

// ── Translation endpoint ──────────────────────────────────────
const translateLimit = makeRateLimiter(10, 60000, "Translation rate limit reached.");

app.post("/api/translate", globalLimit, translateLimit, async (req, res) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: "Configuration error." });

  const { fields, targetLang } = req.body;
  if (!fields || typeof fields !== "object" || !targetLang || typeof targetLang !== "string") {
    return res.status(400).json({ error: "Invalid request." });
  }
  if (targetLang.length > 50) return res.status(400).json({ error: "Invalid language." });

  const sanitize = s => String(s || "").slice(0, 2000);
  const safeFields = {};
  const allowed = ["health_assessment","key_health_concerns","vhs_label","monitoring_plan","nutrition","lifestyle","supplements","cv_note","met_note","liv_note","kid_note","inf_note","findings"];
  for (const k of allowed) {
    if (fields[k]) safeFields[k] = sanitize(fields[k]);
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
        model: "claude-haiku-4-5-20251001",
        max_tokens: 3000,
        system: "You are a professional medical translator. Translate the provided JSON field values to the requested language. Return ONLY a valid JSON object with the same keys. Keep medical marker names (like HbA1c, LDL, HDL, WBC) in English. Translate all descriptive text accurately. Never add explanations or markdown. Never truncate the JSON.",
        messages: [{
          role: "user",
          content: "Translate all values in this JSON to " + targetLang + ". Return only valid JSON with the same keys:\n" + JSON.stringify(safeFields)
        }]
      }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: "Translation failed." });
    const text = data.content.map(b => b.text || "").join("").replace(/```json|```/g,"").trim();
    let translated;
    try {
      translated = JSON.parse(text);
    } catch(parseErr) {
      console.error("Translation JSON parse error:", parseErr.message, "Raw:", text.slice(0, 200));
      return res.status(500).json({ error: "Translation parse failed." });
    }
    res.json({ translated });
  } catch(e) {
    console.error("Translation error:", e.message);
    res.status(500).json({ error: "Translation failed." });
  }
});

// ── Legal pages ────────────────────────────────────────────────
app.get("/terms",   (req, res) => res.sendFile(path.join(__dirname, "public", "terms.html")));
app.get("/privacy", (req, res) => res.sendFile(path.join(__dirname, "public", "privacy.html")));

// ── Catch-all ──────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ── Global error handler ───────────────────────────────────────
app.use((err, req, res, next) => {
  // Never leak stack traces or internal error details
  console.error("Unhandled error:", err.message);
  if (err.message && err.message.includes("CORS")) {
    return res.status(403).json({ error: "Forbidden." });
  }
  res.status(500).json({ error: "An error occurred. Please try again." });
});

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`VHS platform running on port ${PORT}`);
});
