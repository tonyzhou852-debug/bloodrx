"use strict";
const express    = require("express");
const cors       = require("cors");
const path       = require("path");
const crypto     = require("crypto");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const passport   = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { MongoClient } = require("mongodb");

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Secrets — refuse to start with weak defaults ───────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("FATAL: JWT_SECRET must be set and at least 32 characters.");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) console.error("WARNING: ANTHROPIC_API_KEY not set");
if (!process.env.MONGODB_URI)       console.error("WARNING: MONGODB_URI not set");
if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12)
  console.error("WARNING: ADMIN_PASSWORD should be at least 12 characters");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(32).toString("hex");

// ── MongoDB ────────────────────────────────────────────────────
let _db = null;
async function getDB() {
  if (_db) return _db;
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000, maxPoolSize: 10,
  });
  await client.connect();
  _db = client.db("bloodrx");
  await _db.collection("users").createIndex({ email: 1 }, { unique: true });
  await _db.collection("users").createIndex({ username: 1 }, { unique: true, sparse: true });
  await _db.collection("patients").createIndex({ id: 1 });
  await _db.collection("patients").createIndex({ userId: 1 });
  console.log("MongoDB connected");
  return _db;
}
getDB().catch(e => console.error("MongoDB startup error:", e.message));

// ── Trust Render's proxy (must be before rate limiting) ────────
app.set("trust proxy", 1);

// ── Security headers ───────────────────────────────────────────
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com https://translate.google.com https://translate.googleapis.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com https://translate.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: https://lh3.googleusercontent.com https://www.google.com https://translate.google.com; " +
    "connect-src 'self' https://translation.googleapis.com; " +
    "frame-src https://accounts.google.com; " +
    "frame-ancestors 'none';"
  );
  if (req.path.startsWith("/api/") || req.path.startsWith("/admin")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
  }
  next();
});

// ── CORS — only allow same origin ─────────────────────────────
const APP_URL = process.env.APP_URL || "";
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (APP_URL && origin === APP_URL) return cb(null, true);
    if (!APP_URL) return cb(null, true);
    cb(new Error("CORS policy violation"), false);
  },
  credentials: true,
  methods: ["GET","POST","DELETE"],
  allowedHeaders: ["Content-Type","X-Admin-Token"],
}));

// ── Rate limiting (per-IP sliding window) ─────────────────────
const _rateLimits = new Map();
function makeRateLimiter(limit, windowMs, message) {
  return (req, res, next) => {
    const key = req.ip || "unknown";
    const now = Date.now();
    const r = _rateLimits.get(key) || { ts: [] };
    r.ts = r.ts.filter(t => now - t < windowMs);
    if (r.ts.length >= limit) {
      const retry = Math.ceil((r.ts[0] + windowMs - now) / 1000);
      res.setHeader("Retry-After", retry);
      return res.status(429).json({ error: message });
    }
    r.ts.push(now); _rateLimits.set(key, r); next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k,r] of _rateLimits.entries()) {
    r.ts = r.ts.filter(t => now - t < 3600000);
    if (!r.ts.length) _rateLimits.delete(k);
  }
}, 300000);

const globalLimit    = makeRateLimiter(60,  60000, "Too many requests. Please wait.");
const analysisLimit  = makeRateLimiter(5,   60000, "Analysis rate limit reached. Please wait 1 minute.");
const adminLimit     = makeRateLimiter(30,  60000, "Too many admin requests.");
const authLimit      = makeRateLimiter(8,   60000, "Too many auth attempts. Please wait 1 minute.");
const translateLimit = makeRateLimiter(20,  60000, "Translation rate limit reached.");
const botLimit       = makeRateLimiter(20,  60000, "Too many bot requests.");

// ── Admin brute-force lockout ──────────────────────────────────
const _adminFails = new Map();
function adminBruteForce(req, res, next) {
  const ip = req.ip || "unknown";
  const r = _adminFails.get(ip) || { count:0, locked:0 };
  if (Date.now() < r.locked) {
    const mins = Math.ceil((r.locked - Date.now()) / 60000);
    res.setHeader("WWW-Authenticate", 'Basic realm="VHS Admin"');
    return res.status(429).send("Too many failed attempts. Try again in " + mins + " minutes.");
  }
  req._adminIp = ip; next();
}
function adminFail(ip) {
  const r = _adminFails.get(ip) || { count:0, locked:0 };
  r.count++;
  if (r.count >= 5) { r.locked = Date.now() + 15*60*1000; r.count = 0; }
  _adminFails.set(ip, r);
}
function adminOk(ip) { _adminFails.delete(ip); }

// ── Admin Basic Auth ───────────────────────────────────────────
function adminAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="VHS Admin"');
    return res.status(401).send("Authentication required.");
  }
  let creds;
  try { creds = Buffer.from(auth.slice(6), "base64").toString("utf8"); }
  catch { res.setHeader("WWW-Authenticate", 'Basic realm="VHS Admin"'); return res.status(401).send("Invalid credentials."); }
  const idx = creds.indexOf(":");
  if (idx === -1) { adminFail(req._adminIp||req.ip); res.setHeader("WWW-Authenticate", 'Basic realm="VHS Admin"'); return res.status(401).send("Invalid credentials."); }
  const user = creds.slice(0,idx);
  const pass = creds.slice(idx+1);
  const u1 = Buffer.from(user.padEnd(64)); const u2 = Buffer.from("admin".padEnd(64));
  const p1 = Buffer.from(pass || ""); const p2 = Buffer.from(ADMIN_PASSWORD);
  let uOk = false, pOk = false;
  try { uOk = u1.length >= u2.length && crypto.timingSafeEqual(u1.slice(0,u2.length), u2); } catch {}
  if (p1.length === p2.length) {
    try { pOk = crypto.timingSafeEqual(p1, p2); } catch {}
  }
  if (!uOk || !pOk || user !== "admin") {
    adminFail(req._adminIp||req.ip);
    res.setHeader("WWW-Authenticate", 'Basic realm="VHS Admin"');
    return res.status(401).send("Invalid credentials.");
  }
  adminOk(req._adminIp||req.ip); next();
}

// ── Admin token exchange ───────────────────────────────────────
const _adminTokens = new Map();
setInterval(() => { const now=Date.now(); for(const[t,e] of _adminTokens) if(now>e) _adminTokens.delete(t); }, 300000);

app.get("/api/admin/token", adminBruteForce, adminLimit, adminAuth, (req, res) => {
  const token = crypto.randomBytes(32).toString("hex");
  _adminTokens.set(token, Date.now() + 3600000);
  res.json({ token });
});

function adminAuthOrToken(req, res, next) {
  const t = req.headers["x-admin-token"];
  if (t) {
    const exp = _adminTokens.get(t);
    if (exp && Date.now() < exp) return next();
    return res.status(401).json({ error: "Invalid or expired admin token." });
  }
  adminBruteForce(req, res, () => adminAuth(req, res, next));
}

// ── JWT auth ───────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies?.vhs_token;
  if (!token) return res.status(401).json({ error: "Not authenticated." });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.clearCookie("vhs_token"); return res.status(401).json({ error: "Session expired." }); }
}

// ── Input sanitization ─────────────────────────────────────────
const sanitize = s => (s||"")
  .replace(/<[^>]*>/g,"")
  .replace(/[^\x20-\x7E\u00C0-\u024F\u4E00-\u9FFF\u3400-\u4DBF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF\u0900-\u097F\u0E00-\u0E7F\u1E00-\u1EFF]/g,"")
  .trim().slice(0,500);

// ── Body parsers ───────────────────────────────────────────────
app.use(express.json({ limit:"50mb", strict:true }));
app.use(express.urlencoded({ extended:false, limit:"1mb" }));
app.use(cookieParser());

// ── Validate analysis request ─────────────────────────────────
function validateAnalysis(req, res, next) {
  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages) || !messages.length || messages.length > 10)
    return res.status(400).json({ error:"Invalid request." });
  for (const m of messages) {
    if (!["user","assistant"].includes(m.role) || !m.content) return res.status(400).json({ error:"Invalid message." });
  }
  if (JSON.stringify(req.body).length > 52428800) return res.status(413).json({ error:"Request too large." });
  next();
}

// ── Block known attack paths ───────────────────────────────────
const BLOCKED = [".env",".git","wp-admin","phpinfo","config.php","wp-login","phpmyadmin",
  ".htaccess","xmlrpc.php","shell.php","/proc/","/etc/passwd","/../","/..",
  "select%20","union%20","insert%20","drop%20","<script","javascript:"];
app.use((req, res, next) => {
  const p = decodeURIComponent(req.path).toLowerCase();
  const q = (req.query.q||"").toLowerCase();
  if (BLOCKED.some(b => p.includes(b) || q.includes(b))) return res.status(404).send("Not found.");
  next();
});

// ── Google OAuth ───────────────────────────────────────────────
app.use(passport.initialize());
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: (process.env.APP_URL || "http://localhost:3001") + "/auth/google/callback",
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const db = await getDB();
      const email = (profile.emails?.[0]?.value || "").toLowerCase().trim();
      if (!email) return done(new Error("No email from Google"), null);
      let user = await db.collection("users").findOne({ googleId: profile.id });
      if (!user) {
        user = await db.collection("users").findOne({ email });
        if (user) {
          await db.collection("users").updateOne({ _id:user._id }, { $set:{ googleId:profile.id, avatar:profile.photos?.[0]?.value } });
        } else {
          const doc = { id:Date.now(), googleId:profile.id, email, username:profile.displayName||email, avatar:profile.photos?.[0]?.value||"", createdAt:new Date().toISOString() };
          await db.collection("users").insertOne(doc);
          user = doc;
        }
      }
      done(null, user);
    } catch(e) { done(e, null); }
  }));
}

// ── IP Language detection ──────────────────────────────────────
const LANG_MAP = { CN:"zh-CN", HK:"zh-TW", TW:"zh-TW", MO:"zh-TW" };
const _ipLangCache = new Map();
app.get("/api/lang", async (req, res) => {
  res.setHeader("Cache-Control","private, max-age=86400");
  const ip = (req.headers["x-forwarded-for"]||req.ip||"").split(",")[0].trim();
  if (_ipLangCache.has(ip)) return res.json(_ipLangCache.get(ip));
  try {
    const r = await fetch("http://ip-api.com/json/"+ip+"?fields=countryCode");
    const data = await r.json();
    const result = { lang: LANG_MAP[data.countryCode]||"en", country:data.countryCode };
    _ipLangCache.set(ip, result);
    setTimeout(()=>_ipLangCache.delete(ip), 86400000);
    res.json(result);
  } catch { res.json({ lang:"en", country:null }); }
});

// ── Static files ───────────────────────────────────────────────
app.get("/login",   (req, res) => res.sendFile(path.join(__dirname,"public","login.html")));
app.get("/terms",   (req, res) => res.sendFile(path.join(__dirname,"public","terms.html")));
app.get("/privacy", (req, res) => res.sendFile(path.join(__dirname,"public","privacy.html")));

app.get("/", (req, res, next) => {
  const token = req.cookies?.vhs_token;
  if (!token) return res.redirect("/login");
  try { jwt.verify(token, JWT_SECRET); next(); }
  catch { res.clearCookie("vhs_token"); return res.redirect("/login"); }
});

app.use(express.static(path.join(__dirname,"public"), {
  etag:true, lastModified:true,
  setHeaders:(res,filePath)=>{ if(filePath.endsWith(".html")) res.setHeader("Cache-Control","no-store"); }
}));

// ══════════════════════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════════════════════

app.post("/api/auth/register", globalLimit, authLimit, async (req, res) => {
  const { username, email, password, rememberMe } = req.body || {};
  if (!username || !email || !password) return res.status(400).json({ error:"All fields required." });
  if (typeof username !== "string" || username.length < 2 || username.length > 50)
    return res.status(400).json({ error:"Username must be 2-50 characters." });
  if (typeof password !== "string" || password.length < 8)
    return res.status(400).json({ error:"Password must be at least 8 characters." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error:"Invalid email address." });
  if (/<|>|script|javascript/i.test(username))
    return res.status(400).json({ error:"Invalid characters in username." });
  try {
    const db = await getDB();
    const exists = await db.collection("users").findOne({ $or:[{email:email.toLowerCase().trim()},{username:username.trim()}] });
    if (exists) return res.status(409).json({ error:"Email or username already in use." });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = { id:Date.now(), username:username.trim(), email:email.toLowerCase().trim(), passwordHash, createdAt:new Date().toISOString() };
    await db.collection("users").insertOne(user);
    const expire = rememberMe !== false ? "30d" : "1d";
    const maxAge = rememberMe !== false ? 30*24*60*60*1000 : 24*60*60*1000;
    const token = jwt.sign({ id:user.id, username:user.username, email:user.email }, JWT_SECRET, { expiresIn:expire });
    res.cookie("vhs_token", token, { httpOnly:true, secure:true, sameSite:"lax", maxAge });
    res.json({ ok:true, user:{ username:user.username, email:user.email } });
  } catch(e) {
    console.error("Register error:", e.message);
    res.status(500).json({ error:"Registration failed. Please try again." });
  }
});

app.post("/api/auth/login", globalLimit, authLimit, async (req, res) => {
  const { email, password, rememberMe } = req.body || {};
  if (!email || !password) return res.status(400).json({ error:"Email and password required." });
  if (typeof email !== "string" || typeof password !== "string")
    return res.status(400).json({ error:"Invalid input." });
  try {
    const db = await getDB();
    const user = await db.collection("users").findOne({ email:email.toLowerCase().trim() });
    if (!user || !user.passwordHash) {
      await bcrypt.compare(password, "$2a$12$fakehashfakehashfakehashfakehashfakehashfakehash00000");
      return res.status(401).json({ error:"Invalid email or password." });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error:"Invalid email or password." });
    const expire = rememberMe !== false ? "30d" : "1d";
    const maxAge = rememberMe !== false ? 30*24*60*60*1000 : 24*60*60*1000;
    const token = jwt.sign({ id:user.id, username:user.username, email:user.email }, JWT_SECRET, { expiresIn:expire });
    res.cookie("vhs_token", token, { httpOnly:true, secure:true, sameSite:"lax", maxAge });
    res.json({ ok:true, user:{ username:user.username, email:user.email } });
  } catch(e) {
    console.error("Login error:", e.message);
    res.status(500).json({ error:"Login failed. Please try again." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("vhs_token", { httpOnly:true, secure:true, sameSite:"lax" });
  res.json({ ok:true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user:{ username:req.user.username, email:req.user.email, id:req.user.id } });
});

app.get("/auth/google", passport.authenticate("google", { scope:["profile","email"], session:false }));
app.get("/auth/google/callback",
  passport.authenticate("google", { session:false, failureRedirect:"/login?error=google" }),
  (req, res) => {
    const u = req.user;
    const token = jwt.sign({ id:u.id, username:u.username||u.email, email:u.email }, JWT_SECRET, { expiresIn:"30d" });
    res.cookie("vhs_token", token, { httpOnly:true, secure:true, sameSite:"lax", maxAge:30*24*60*60*1000 });
    res.redirect("/");
  }
);

// ══════════════════════════════════════════════════════════════
// ANALYSIS with SSE streaming
// ══════════════════════════════════════════════════════════════
app.post("/api/analyze", requireAuth, globalLimit, analysisLimit, validateAnalysis, async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error:"Server configuration error." });
  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-api-key":key, "anthropic-version":"2023-06-01" },
      body: JSON.stringify({
        model:"claude-sonnet-4-6", max_tokens:8000, stream:true,
        system:"You are a health wellness analyst. Return ONLY a single complete valid JSON object. Include all findings. Keep text fields under 200 chars each. Never truncate JSON. No medication names or prescriptions.",
        messages:req.body.messages,
      }),
    });
    if (!upstream.ok) {
      const err = await upstream.json().catch(()=>({}));
      return res.status(upstream.status).json({ error:"Analysis service error." });
    }
    res.setHeader("Content-Type","text/event-stream");
    res.setHeader("Cache-Control","no-cache");
    res.setHeader("Connection","keep-alive");
    res.setHeader("X-Accel-Buffering","no");
    res.flushHeaders();

    let fullText = "";
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream:true });
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (raw === "[DONE]") continue;
        try {
          const ev = JSON.parse(raw);
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            fullText += ev.delta.text;
            res.write("data:" + JSON.stringify({ t: ev.delta.text }) + "\n\n");
          } else if (ev.type === "message_stop") {
            res.write("data:" + JSON.stringify({ done: true }) + "\n\n");
          }
        } catch(e) { /* skip */ }
      }
    }

    try {
      const result = JSON.parse(fullText.replace(/```json|```/g,"").trim());
      const prompt = req.body.messages.map(m=>typeof m.content==="string"?m.content:Array.isArray(m.content)?m.content.filter(p=>p.type==="text").map(p=>p.text).join(" "):"").join(" ");
      const g = k => { const m=prompt.match(new RegExp(k+":\\s*(.+)")); return m?m[1]:""; };
      const record = {
        id: Date.now(), userId: req.user.id, submittedBy: req.user.username,
        name: sanitize(g("Name")) || "Unknown",
        phone: sanitize(g("Phone")), age: sanitize(g("Age")), gender: sanitize(g("Gender")),
        complaint: sanitize(g("Health concern")), notes: sanitize(g("Health notes")),
        vhs_score: Math.min(100,Math.max(0,Number(result.vhs_score)||0)),
        vhs_label: sanitize(result.vhs_label),
        summary: sanitize(result.health_assessment),
        key_health_concerns: sanitize(result.key_health_concerns),
        detected_languages: sanitize(result.detected_languages),
        risk_cardiovascular: Math.min(5,Math.max(0,Number(result.risk_profile?.cardiovascular?.score)||0)),
        risk_metabolic:      Math.min(5,Math.max(0,Number(result.risk_profile?.metabolic?.score)||0)),
        risk_liver:          Math.min(5,Math.max(0,Number(result.risk_profile?.liver?.score)||0)),
        risk_kidney:         Math.min(5,Math.max(0,Number(result.risk_profile?.kidney?.score)||0)),
        risk_inflammation:   Math.min(5,Math.max(0,Number(result.risk_profile?.inflammation?.score)||0)),
        nutrition:    (result.nutrition_recommendations||[]).map(s=>sanitize(s)).join(" | ").slice(0,500),
        lifestyle:    (result.lifestyle_recommendations||[]).map(s=>sanitize(s)).join(" | ").slice(0,500),
        supplements:  (result.nutritional_support||[]).map(s=>sanitize(s)).join(" | ").slice(0,500),
        monitoring_plan: sanitize(result.monitoring_plan),
        ip: req.ip||"", created_at: new Date().toISOString(),
      };
      getDB().then(db => db.collection("patients").insertOne(record)).catch(e => console.log("DB save error:", e.message));
    } catch(e) { console.log("DB parse error:", e.message); }

    res.end();
  } catch(e) {
    console.error("Analysis error:", e.message);
    if (!res.headersSent) res.status(500).json({ error:"Server error." });
    else res.end();
  }
});

// ══════════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════════
app.get("/admin", adminBruteForce, adminLimit, adminAuth, (req, res) => {
  res.sendFile(path.join(__dirname,"public","admin.html"));
});

app.get("/api/admin/patients", adminLimit, adminAuthOrToken, async (req, res) => {
  try {
    const db = await getDB();
    const rows = await db.collection("patients").find({},{ projection:{_id:0,ip:0} }).sort({id:-1}).limit(1000).toArray();
    res.json(rows);
  } catch(e) { res.status(500).json({ error:"Failed to load." }); }
});

// ── Delete ALL records for a patient (bulk by ids) ─────────────
app.post("/api/admin/patients/delete", adminLimit, adminAuthOrToken, async (req, res) => {
  const { ids } = req.body||{};
  if (!ids||!Array.isArray(ids)||!ids.length||ids.length>100) return res.status(400).json({ error:"Invalid request." });
  const nums = ids.map(Number).filter(n=>Number.isFinite(n)&&n>0);
  if (!nums.length) return res.status(400).json({ error:"No valid IDs." });
  try {
    const db = await getDB();
    const r = await db.collection("patients").deleteMany({ id:{$in:nums} });
    res.json({ deleted:r.deletedCount });
  } catch(e) { res.status(500).json({ error:"Delete failed." }); }
});

// ── Delete a SINGLE visit record by id ────────────────────────
app.post("/api/admin/records/delete-one", adminLimit, adminAuthOrToken, async (req, res) => {
  const { id } = req.body || {};
  const num = Number(id);
  if (!Number.isFinite(num) || num <= 0) return res.status(400).json({ error: "Invalid ID." });
  try {
    const db = await getDB();
    const r = await db.collection("patients").deleteOne({ id: num });
    if (r.deletedCount === 0) return res.status(404).json({ error: "Record not found." });
    res.json({ deleted: 1 });
  } catch(e) { res.status(500).json({ error: "Delete failed." }); }
});

app.get("/api/admin/users", adminLimit, adminAuthOrToken, async (req, res) => {
  try {
    const db = await getDB();
    const users = await db.collection("users").find({},{ projection:{_id:0,passwordHash:0} }).sort({id:-1}).limit(500).toArray();
    res.json(users);
  } catch(e) { res.status(500).json({ error:"Failed." }); }
});

// ══════════════════════════════════════════════════════════════
// BOT & TRANSLATE
// ══════════════════════════════════════════════════════════════
const BOT_SYSTEM = `You are the VHS Help Assistant for VANDL Health Score platform. Your ONLY job is to help users understand how to submit their health report and interpret their VHS wellness results. STRICTLY LIMITED to: form filling, file upload, VHS score meaning, risk categories, recommendation sections, starting a new assessment. REFUSE everything else. Keep responses under 3 sentences. Be friendly and clear.`;

app.post("/api/bot", requireAuth, globalLimit, botLimit, async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error:"Configuration error." });
  const { messages, translate } = req.body||{};
  if (!messages||!Array.isArray(messages)||!messages.length||messages.length>12) return res.status(400).json({ error:"Invalid request." });
  const limit = translate ? 8000 : 1000;
  for (const m of messages) {
    if (!["user","assistant"].includes(m.role)||typeof m.content!=="string"||m.content.length>limit) return res.status(400).json({ error:"Invalid message." });
  }
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{ "Content-Type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01" },
      body:JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:translate?2000:300, system:translate?"You are a professional medical translator. Return ONLY valid JSON with same keys.":BOT_SYSTEM, messages:messages.slice(-6) }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error:"Bot unavailable." });
    res.json({ reply:data.content?.[0]?.text||"Sorry, I could not respond." });
  } catch(e) { res.status(500).json({ error:"Bot unavailable." }); }
});

app.post("/api/translate/public", globalLimit, makeRateLimiter(30, 60000, "Translation rate limit reached."), async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error:"Configuration error." });
  const { text, targetLang } = req.body||{};
  if (!text||typeof text!=="string"||!targetLang||typeof targetLang!=="string") return res.status(400).json({ error:"Invalid request." });
  if (text.length > 6000) return res.status(400).json({ error:"Text too long." });
  if (targetLang.length > 50) return res.status(400).json({ error:"Invalid language." });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:6000,
        system:"You are a professional legal document translator. Translate the provided text accurately to "+targetLang+". Preserve all formatting, structure, and legal terminology. Return ONLY the translated text, nothing else.",
        messages:[{role:"user",content:"Translate this to "+targetLang+". Text: "+text}] })
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error:"Translation failed." });
    res.json({ translated: data.content.map(b=>b.text||"").join("") });
  } catch(e) { res.status(500).json({ error:"Translation failed." }); }
});

app.post("/api/translate", requireAuth, globalLimit, translateLimit, async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error:"Configuration error." });
  const { fields, targetLang } = req.body||{};
  if (!fields||typeof fields!=="object"||!targetLang||typeof targetLang!=="string"||targetLang.length>50) return res.status(400).json({ error:"Invalid request." });
  const allowed = ["health_assessment","key_health_concerns","vhs_label","monitoring_plan","nutrition","lifestyle","supplements","cv_note","met_note","liv_note","kid_note","inf_note","findings"];
  const safe = {};
  for (const k of allowed) { if (fields[k]) safe[k]=String(fields[k]).slice(0,2000); }
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{ "Content-Type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01" },
      body:JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:1500, system:"Medical translator. Return ONLY valid JSON same keys. Keep marker names in English.", messages:[{ role:"user", content:"Translate all values to "+targetLang+". Return only valid JSON:\n"+JSON.stringify(safe) }] }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error:"Translation failed." });
    const text = data.content.map(b=>b.text||"").join("").replace(/```json|```/g,"").trim();
    try { res.json({ translated:JSON.parse(text) }); }
    catch { res.status(500).json({ error:"Translation parse failed." }); }
  } catch(e) { res.status(500).json({ error:"Translation failed." }); }
});

// ══════════════════════════════════════════════════════════════
// CATCH-ALL
// ══════════════════════════════════════════════════════════════
app.get("*", (req, res) => {
  const token = req.cookies?.vhs_token;
  if (!token) return res.redirect("/login");
  try { jwt.verify(token, JWT_SECRET); res.sendFile(path.join(__dirname,"public","index.html")); }
  catch { res.clearCookie("vhs_token"); res.redirect("/login"); }
});

// ── Global error handler ───────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled:", err.message);
  if (err.message?.includes("CORS")) return res.status(403).json({ error:"Forbidden." });
  res.status(500).json({ error:"An error occurred. Please try again." });
});

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => console.log("VHS running on port " + PORT));
