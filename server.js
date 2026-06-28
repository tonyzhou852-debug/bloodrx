const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { MongoClient } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "vhs-jwt-secret-change-in-production";

// ── Environment validation ─────────────────────────────────────
["ANTHROPIC_API_KEY","MONGODB_URI","ADMIN_PASSWORD","JWT_SECRET"].forEach(k => {
  if (!process.env[k]) console.warn(`WARNING: ${k} not set`);
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "bloodrx-admin-2024";

// ── MongoDB ────────────────────────────────────────────────────
let _db = null;
async function getDB() {
  if (_db) return _db;
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000, maxPoolSize: 10,
  });
  await client.connect();
  _db = client.db("bloodrx");
  // Create indexes
  await _db.collection("users").createIndex({ email: 1 }, { unique: true });
  await _db.collection("users").createIndex({ username: 1 }, { unique: true, sparse: true });
  console.log("Connected to MongoDB");
  return _db;
}
getDB().catch(e => console.error("MongoDB startup error:", e.message));

// ── IP Language detection ──────────────────────────────────────
const LANG_MAP = { CN:"zh-CN", HK:"zh-TW", TW:"zh-TW", MO:"zh-TW" };
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
  } catch(e) { res.json({ lang:"en", country:null }); }
});

// ── Trust Render proxy ─────────────────────────────────────────
app.set("trust proxy", 1);

// ── Security headers ───────────────────────────────────────────
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https://lh3.googleusercontent.com; " +
    "connect-src 'self'; " +
    "frame-src https://accounts.google.com; " +
    "frame-ancestors 'none';"
  );
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (req.path.startsWith("/api/") || req.path.startsWith("/admin")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
  }
  next();
});

// ── CORS ───────────────────────────────────────────────────────
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || null;
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGIN && origin !== ALLOWED_ORIGIN) return callback(new Error("CORS policy violation"), false);
    callback(null, true);
  },
  credentials: true,
  methods: ["GET","POST","DELETE"],
  allowedHeaders: ["Content-Type","Authorization"],
}));

// ── Rate limiting ──────────────────────────────────────────────
const rateLimits = new Map();
function makeRateLimiter(limit, windowMs, message) {
  return (req, res, next) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    let record = rateLimits.get(ip) || { timestamps: [] };
    record.timestamps = record.timestamps.filter(t => now - t < windowMs);
    if (record.timestamps.length >= limit) {
      const retryAfter = Math.ceil((record.timestamps[0] + windowMs - now) / 1000);
      res.setHeader("Retry-After", retryAfter);
      return res.status(429).json({ error: message });
    }
    record.timestamps.push(now);
    rateLimits.set(ip, record);
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, r] of rateLimits.entries()) {
    r.timestamps = r.timestamps.filter(t => now - t < 3600000);
    if (r.timestamps.length === 0) rateLimits.delete(k);
  }
}, 300000);

const globalLimit   = makeRateLimiter(30,  60000, "Too many requests. Please wait.");
const analysisLimit = makeRateLimiter(5,   60000, "Analysis rate limit reached.");
const adminLimit    = makeRateLimiter(20,  60000, "Too many admin requests.");
const authLimit     = makeRateLimiter(10,  60000, "Too many auth requests.");
const translateLimit= makeRateLimiter(30,  60000, "Translation rate limit reached.");

// ── Admin brute-force lockout ──────────────────────────────────
const adminFailures = new Map();
function adminBruteForceProtection(req, res, next) {
  const ip = req.ip || "unknown";
  const now = Date.now();
  const record = adminFailures.get(ip) || { count:0, lockedUntil:0 };
  if (now < record.lockedUntil) {
    const remaining = Math.ceil((record.lockedUntil - now) / 60000);
    res.setHeader("WWW-Authenticate", 'Basic realm="VHS Admin"');
    return res.status(429).send(`Too many failed attempts. Try again in ${remaining} minutes.`);
  }
  req._adminIp = ip;
  next();
}
function recordAdminFailure(ip) {
  const record = adminFailures.get(ip) || { count:0, lockedUntil:0 };
  record.count++;
  if (record.count >= 5) { record.lockedUntil = Date.now() + 15*60*1000; record.count = 0; }
  adminFailures.set(ip, record);
}
function clearAdminFailure(ip) { adminFailures.delete(ip); }

// ── Admin auth ─────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="VHS Admin"');
    return res.status(401).send("Authentication required.");
  }
  let credentials;
  try { credentials = Buffer.from(auth.slice(6), "base64").toString("utf8"); }
  catch { res.setHeader("WWW-Authenticate", 'Basic realm="VHS Admin"'); return res.status(401).send("Invalid credentials."); }
  const colonIdx = credentials.indexOf(":");
  if (colonIdx === -1) { recordAdminFailure(req._adminIp || req.ip); res.setHeader("WWW-Authenticate", 'Basic realm="VHS Admin"'); return res.status(401).send("Invalid credentials."); }
  const username = credentials.slice(0, colonIdx);
  const password = credentials.slice(colonIdx + 1);
  const validUser = username.length === "admin".length && crypto.timingSafeEqual(Buffer.from(username.padEnd(32)), Buffer.from("admin".padEnd(32)));
  const storedPass = Buffer.from(ADMIN_PASSWORD);
  const providedPass = Buffer.from(password || "");
  const passBuffer = Buffer.alloc(storedPass.length);
  providedPass.copy(passBuffer, 0, 0, Math.min(providedPass.length, storedPass.length));
  let validPass = false;
  try { validPass = providedPass.length === storedPass.length && crypto.timingSafeEqual(passBuffer, storedPass); } catch { validPass = false; }
  if (!validUser || !validPass) { recordAdminFailure(req._adminIp || req.ip); res.setHeader("WWW-Authenticate", 'Basic realm="VHS Admin"'); return res.status(401).send("Invalid credentials."); }
  clearAdminFailure(req._adminIp || req.ip);
  next();
}

// ── JWT auth middleware ────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.vhs_token;
  if (!token) return res.status(401).json({ error: "Not authenticated." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch(e) {
    res.clearCookie("vhs_token");
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}

function optionalAuth(req, res, next) {
  const token = req.cookies && req.cookies.vhs_token;
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch(e) { /* ignore */ }
  }
  next();
}

// ── Input validation ───────────────────────────────────────────
function validateAnalysisRequest(req, res, next) {
  const body = req.body;
  if (!body || typeof body !== "object" || !body.messages || !Array.isArray(body.messages)) return res.status(400).json({ error: "Invalid request format." });
  if (body.messages.length === 0 || body.messages.length > 10) return res.status(400).json({ error: "Invalid number of messages." });
  for (const msg of body.messages) {
    if (!msg.role || !["user","assistant"].includes(msg.role) || !msg.content) return res.status(400).json({ error: "Invalid message." });
  }
  if (JSON.stringify(body).length > 52428800) return res.status(413).json({ error: "Request too large." });
  next();
}

// ── Sanitize ───────────────────────────────────────────────────
const sanitize = (str) => (str || "")
  .replace(/<[^>]*>/g, "")
  .replace(/[^\x20-\x7E\u00C0-\u024F\u4E00-\u9FFF\u3400-\u4DBF\uAC00-\uD7AF]/g, "")
  .trim().slice(0, 500);

// ── Body parsers ───────────────────────────────────────────────
app.use(express.json({ limit: "50mb", strict: true }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(cookieParser());

// ── Passport / Google OAuth ────────────────────────────────────
app.use(passport.initialize());

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: (process.env.APP_URL || "http://localhost:3001") + "/auth/google/callback",
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const db = await getDB();
      const email = profile.emails?.[0]?.value || "";
      const displayName = profile.displayName || email;
      let user = await db.collection("users").findOne({ googleId: profile.id });
      if (!user) {
        user = await db.collection("users").findOne({ email });
        if (user) {
          await db.collection("users").updateOne({ _id: user._id }, { $set: { googleId: profile.id, avatar: profile.photos?.[0]?.value } });
          user.googleId = profile.id;
        } else {
          const result = await db.collection("users").insertOne({
            id: Date.now(),
            googleId: profile.id,
            email,
            username: displayName,
            avatar: profile.photos?.[0]?.value || "",
            createdAt: new Date().toISOString(),
          });
          user = { id: Date.now(), email, username: displayName };
        }
      }
      done(null, user);
    } catch(e) { done(e, null); }
  }));
}

// ── Static files (auth-protected) ─────────────────────────────
// Serve login page without auth
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "public", "login.html")));

// Redirect root to login if not authenticated
app.get("/", (req, res, next) => {
  const token = req.cookies && req.cookies.vhs_token;
  if (!token) return res.redirect("/login");
  try {
    jwt.verify(token, JWT_SECRET);
    next(); // serve index.html via static
  } catch(e) {
    res.clearCookie("vhs_token");
    return res.redirect("/login");
  }
});

app.use(express.static(path.join(__dirname, "public"), {
  etag: true, lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
  }
}));

// ── Block attack paths ─────────────────────────────────────────
const BLOCKED_PATHS = [".env",".git","wp-admin","phpinfo","config.php","wp-login","phpmyadmin","admin.php",".htaccess","xmlrpc.php","shell.php","eval","base64_decode","/.well-known/acme","/cgi-bin","/proc/","/etc/passwd"];
app.use((req, res, next) => {
  if (BLOCKED_PATHS.some(b => req.path.toLowerCase().includes(b))) return res.status(404).send("Not found.");
  next();
});

// ══════════════════════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════════════════════

// Register
app.post("/api/auth/register", authLimit, async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: "All fields required." });
  if (username.length < 2 || username.length > 50) return res.status(400).json({ error: "Username must be 2-50 characters." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return res.status(400).json({ error: "Invalid email." });

  try {
    const db = await getDB();
    const existing = await db.collection("users").findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (existing) return res.status(409).json({ error: "Email or username already in use." });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = {
      id: Date.now(),
      username: username.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    await db.collection("users").insertOne(user);

    const rememberMe = req.body.rememberMe !== false;
    const expiresIn = rememberMe ? "30d" : "1d";
    const maxAge = rememberMe ? 30*24*60*60*1000 : 24*60*60*1000;
    const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn });
    res.cookie("vhs_token", token, { httpOnly: true, secure: true, sameSite: "lax", maxAge });
    res.json({ ok: true, user: { username: user.username, email: user.email } });
  } catch(e) {
    console.error("Register error:", e.message);
    res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// Login
app.post("/api/auth/login", authLimit, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required." });

  try {
    const db = await getDB();
    const user = await db.collection("users").findOne({ email: email.toLowerCase().trim() });
    if (!user || !user.passwordHash) return res.status(401).json({ error: "Invalid email or password." });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password." });

    const rememberMe = req.body.rememberMe !== false;
    const expiresIn = rememberMe ? "30d" : "1d";
    const maxAge = rememberMe ? 30*24*60*60*1000 : 24*60*60*1000;
    const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn });
    res.cookie("vhs_token", token, { httpOnly: true, secure: true, sameSite: "lax", maxAge });
    res.json({ ok: true, user: { username: user.username, email: user.email } });
  } catch(e) {
    console.error("Login error:", e.message);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("vhs_token");
  res.json({ ok: true });
});

// Get current user
app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: { username: req.user.username, email: req.user.email, id: req.user.id } });
});

// Google OAuth
app.get("/auth/google", passport.authenticate("google", { scope: ["profile","email"], session: false }));

app.get("/auth/google/callback",
  passport.authenticate("google", { session: false, failureRedirect: "/login?error=google" }),
  (req, res) => {
    const user = req.user;
    const token = jwt.sign({ id: user.id, username: user.username || user.email, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
    res.cookie("vhs_token", token, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 30*24*60*60*1000 });
    res.redirect("/");
  }
);

// ══════════════════════════════════════════════════════════════
// ANALYSIS ROUTE (requires auth)
// ══════════════════════════════════════════════════════════════
app.post("/api/analyze", requireAuth, globalLimit, analysisLimit, validateAnalysisRequest, async (req, res) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: "Server configuration error." });

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
    if (!response.ok) return res.status(response.status).json({ error: "Analysis service error. Please try again." });

    const text = data.content.map(b => b.text || "").join("");
    try {
      const clean = text.replace(/```json|```/g, "").trim();
      const result = JSON.parse(clean);

      const promptText = req.body.messages
        .map(m => typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.filter(p => p.type === "text").map(p => p.text).join(" ") : "")
        .join(" ");

      const nameMatch      = promptText.match(/Name:\s*(.+)/);
      const phoneMatch     = promptText.match(/Phone:\s*(.+)/);
      const ageMatch       = promptText.match(/Age:\s*(.+)/);
      const genderMatch    = promptText.match(/Gender:\s*(.+)/);
      const complaintMatch = promptText.match(/Health concern:\s*(.+)/);
      const notesMatch     = promptText.match(/Health notes:\s*(.+)/);

      const patientName = sanitize(nameMatch?.[1]) || "Unknown";

      const record = {
        id:                  Date.now(),
        userId:              req.user.id,
        submittedBy:         req.user.username,
        name:                patientName,
        phone:               sanitize(phoneMatch?.[1]) || "",
        age:                 sanitize(ageMatch?.[1]) || "",
        gender:              sanitize(genderMatch?.[1]) || "",
        complaint:           sanitize(complaintMatch?.[1]) || "",
        notes:               sanitize(notesMatch?.[1]) || "",
        vhs_score:           Number(result.vhs_score) || 0,
        vhs_label:           sanitize(result.vhs_label) || "",
        summary:             sanitize(result.health_assessment) || "",
        key_health_concerns: sanitize(result.key_health_concerns) || "",
        detected_languages:  sanitize(result.detected_languages) || "",
        risk_cardiovascular: Number(result.risk_profile?.cardiovascular?.score) || 0,
        risk_metabolic:      Number(result.risk_profile?.metabolic?.score) || 0,
        risk_liver:          Number(result.risk_profile?.liver?.score) || 0,
        risk_kidney:         Number(result.risk_profile?.kidney?.score) || 0,
        risk_inflammation:   Number(result.risk_profile?.inflammation?.score) || 0,
        nutrition:           (result.nutrition_recommendations||[]).map(s=>sanitize(s)).join(" | ").slice(0,500),
        lifestyle:           (result.lifestyle_recommendations||[]).map(s=>sanitize(s)).join(" | ").slice(0,500),
        supplements:         (result.nutritional_support||[]).map(s=>sanitize(s)).join(" | ").slice(0,500),
        monitoring_plan:     sanitize(result.monitoring_plan) || "",
        ip:                  req.ip || "",
        created_at:          new Date().toISOString(),
      };

      const db = await getDB();
      await db.collection("patients").insertOne(record);
    } catch(e) { console.log("Could not save to DB:", e.message); }

    res.json(data);
  } catch(err) {
    console.error("Analysis error:", err.message);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

// ══════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ══════════════════════════════════════════════════════════════
app.get("/admin", adminBruteForceProtection, adminLimit, adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/api/admin/patients", adminBruteForceProtection, adminLimit, adminAuth, async (req, res) => {
  try {
    const db = await getDB();
    const patients = await db.collection("patients")
      .find({}, { projection: { _id:0, ip:0 } })
      .sort({ id: -1 }).limit(1000).toArray();
    res.json(patients);
  } catch(e) { res.status(500).json({ error: "Failed to load records." }); }
});

app.post("/api/admin/patients/delete", adminBruteForceProtection, adminLimit, adminAuth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0 || ids.length > 100) return res.status(400).json({ error: "Invalid request." });
    const numIds = ids.map(id => Number(id)).filter(n => !isNaN(n) && n > 0);
    if (numIds.length === 0) return res.status(400).json({ error: "No valid IDs." });
    const db = await getDB();
    const result = await db.collection("patients").deleteMany({ id: { $in: numIds } });
    res.json({ deleted: result.deletedCount });
  } catch(e) { res.status(500).json({ error: "Delete failed." }); }
});

// Admin: get users list
app.get("/api/admin/users", adminBruteForceProtection, adminLimit, adminAuth, async (req, res) => {
  try {
    const db = await getDB();
    const users = await db.collection("users")
      .find({}, { projection: { _id:0, passwordHash:0 } })
      .sort({ id: -1 }).limit(500).toArray();
    res.json(users);
  } catch(e) { res.status(500).json({ error: "Failed." }); }
});

// ══════════════════════════════════════════════════════════════
// OTHER API ROUTES (same as before)
// ══════════════════════════════════════════════════════════════
const botLimit = makeRateLimiter(20, 60000, "Too many bot requests.");
const BOT_SYSTEM = `You are the VHS Help Assistant for VANDL Health Score platform. Your ONLY job is to help users understand how to submit their health report and interpret their VHS wellness results.
STRICTLY LIMITED to: form filling, file upload, VHS score meaning, risk categories, recommendation sections, starting a new assessment.
REFUSE everything else. Keep responses under 3 sentences. Be friendly and clear.`;

app.post("/api/bot", globalLimit, botLimit, async (req, res) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: "Configuration error." });
  const { messages, translate } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0 || messages.length > 12) return res.status(400).json({ error: "Invalid request." });
  const contentLimit = translate ? 8000 : 1000;
  for (const m of messages) {
    if (!["user","assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > contentLimit) return res.status(400).json({ error: "Invalid message." });
  }
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type":"application/json", "x-api-key":ANTHROPIC_API_KEY, "anthropic-version":"2023-06-01" },
      body: JSON.stringify({ model:"claude-sonnet-4-6", max_tokens: translate?2000:300, system: translate?"You are a professional medical translator. Return ONLY valid JSON with same keys.":BOT_SYSTEM, messages: messages.slice(-6) }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: "Bot unavailable." });
    res.json({ reply: data.content?.[0]?.text || "Sorry, I could not respond." });
  } catch(e) { res.status(500).json({ error: "Bot unavailable." }); }
});

app.post("/api/translate", globalLimit, translateLimit, async (req, res) => {
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: "Configuration error." });
  const { fields, targetLang } = req.body;
  if (!fields || typeof fields !== "object" || !targetLang || typeof targetLang !== "string" || targetLang.length > 50) return res.status(400).json({ error: "Invalid request." });
  const safeFields = {};
  const allowed = ["health_assessment","key_health_concerns","vhs_label","monitoring_plan","nutrition","lifestyle","supplements","cv_note","met_note","liv_note","kid_note","inf_note","findings"];
  for (const k of allowed) { if (fields[k]) safeFields[k] = String(fields[k]).slice(0,2000); }
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type":"application/json", "x-api-key":ANTHROPIC_API_KEY, "anthropic-version":"2023-06-01" },
      body: JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:3000, system:"You are a professional medical translator. Translate the provided JSON field values. Return ONLY a valid JSON object with the same keys. Keep medical marker names in English. Never add explanations or markdown.", messages:[{ role:"user", content:"Translate all values to " + targetLang + ". Return only valid JSON:\n" + JSON.stringify(safeFields) }] }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: "Translation failed." });
    const text = data.content.map(b => b.text||"").join("").replace(/```json|```/g,"").trim();
    try { res.json({ translated: JSON.parse(text) }); }
    catch(e) { res.status(500).json({ error: "Translation parse failed." }); }
  } catch(e) { res.status(500).json({ error: "Translation failed." }); }
});

// ── Legal pages ────────────────────────────────────────────────
app.get("/terms",   (req, res) => res.sendFile(path.join(__dirname, "public", "terms.html")));
app.get("/privacy", (req, res) => res.sendFile(path.join(__dirname, "public", "privacy.html")));

// ── Catch-all: protect all other pages ────────────────────────
app.get("*", (req, res) => {
  const token = req.cookies && req.cookies.vhs_token;
  if (!token) return res.redirect("/login");
  try {
    jwt.verify(token, JWT_SECRET);
    res.sendFile(path.join(__dirname, "public", "index.html"));
  } catch(e) {
    res.clearCookie("vhs_token");
    res.redirect("/login");
  }
});

// ── Global error handler ───────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message);
  if (err.message && err.message.includes("CORS")) return res.status(403).json({ error: "Forbidden." });
  res.status(500).json({ error: "An error occurred. Please try again." });
});

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`VHS platform running on port ${PORT}`));
