"use strict";
const express    = require("express");
const cors       = require("cors");
const path       = require("path");
const fs         = require("fs");
const crypto     = require("crypto");
const nodemailer = require("nodemailer");
const AliyunSmsClient   = require("@alicloud/dysmsapi20170525").default;
const AliyunOpenApi     = require("@alicloud/openapi-client");
const { SendSmsRequest } = require("@alicloud/dysmsapi20170525/dist/models/SendSmsRequest");
const AliyunTeaUtil     = require("@alicloud/tea-util");

// ── Email sending via Resend (HTTPS, works on Render free tier) ──
async function sendResetEmail(toEmail, resetUrl) {
  const apiKey = process.env.RESEND_API_KEY;

  // Fallback to nodemailer if Resend not configured
  if (!apiKey) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn("[email] No email provider configured (set RESEND_API_KEY or SMTP_USER/PASS)");
      return;
    }
    const mailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await mailer.sendMail({
      from: `"Vitava" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: "Reset your Vitava password",
      html: emailHtml(resetUrl),
    });
    return;
  }

  // Use Resend API (HTTPS — works on Render free tier)
  const fromAddress = process.env.RESEND_FROM || "Vitava <noreply@vitava.health>";
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [toEmail],
      subject: "Reset your Vitava password",
      html: emailHtml(resetUrl),
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Resend API error: ${err.message || resp.status}`);
  }
}

function emailHtml(resetUrl) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#b91c1c">Reset your password</h2>
      <p>Click the button below to reset your Vitava password. This link expires in 1 hour.</p>
      <a href="${resetUrl}" style="display:inline-block;margin:20px 0;padding:12px 24px;background:#b91c1c;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Reset Password</a>
      <p style="color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
    </div>`;
}

// ── SMS sending via Aliyun SMS (report link) ────────────────────
function normalizeCnPhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("86")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  return null; // not a recognizable CN mobile number
}

let _aliyunSmsClient = null;
function getAliyunSmsClient() {
  if (_aliyunSmsClient) return _aliyunSmsClient;
  const config = new AliyunOpenApi.Config({
    accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
    accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
  });
  config.endpoint = "dysmsapi.aliyuncs.com";
  _aliyunSmsClient = new AliyunSmsClient(config);
  return _aliyunSmsClient;
}

async function sendReportSms(rawPhone, patientName, reportId, shareToken) {
  const accessKeyId     = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
  const signName        = process.env.ALIYUN_SMS_SIGN;
  const templateCode    = process.env.ALIYUN_SMS_TEMPLATE;
  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    console.warn("[sms] Aliyun SMS not configured (missing ALIYUN_* env vars) - skipping");
    return;
  }
  const phone = normalizeCnPhone(rawPhone);
  if (!phone) {
    console.warn("[sms] No valid CN phone number to text - skipping");
    return;
  }
  const masked = phone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2");

  try {
    const client = getAliyunSmsClient();
    const req = new SendSmsRequest({
      phoneNumbers: phone,
      signName: signName,
      templateCode: templateCode,
      templateParam: JSON.stringify({ name: (patientName || "用户").slice(0, 20), ReportID: String(reportId), shareToken: String(shareToken) }),
    });
    const resp = await client.sendSmsWithOptions(req, new AliyunTeaUtil.RuntimeOptions({}));
    const body = resp.body || {};
    if (body.code !== "OK") {
      console.error("[sms] Aliyun SMS failed for", masked, "-", body.code, body.message);
    } else {
      console.log("[sms] Report link sent to", masked, "- BizId:", body.bizId);
    }
  } catch (e) {
    console.error("[sms] Aliyun SMS request error:", e.message);
  }
}

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
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
if (!ADMIN_EMAILS.length)
  console.error("WARNING: ADMIN_EMAILS not set - admin panel is disabled until it is configured");

// ── MongoDB ────────────────────────────────────────────────────
let _db = null;
async function getDB() {
  if (_db) return _db;
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000, maxPoolSize: 10,
  });
  await client.connect();
  _db = client.db(process.env.MONGODB_DB || "bloodrx");
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

// ── CORS — explicit origin allowlist ──────────────────────────
const APP_URL = process.env.APP_URL || "";
const ALLOWED_ORIGINS = new Set([
  APP_URL,
  "https://vitava.health",
  "https://www.vitava.health",
  "https://vitava.cn",
  "https://www.vitava.cn",
  "https://bloodrx.onrender.com",
  // legacy domains — remove after full cutover
  "https://vandlvhs.com",
  "https://www.vandlvhs.com",
  "https://vandlvhs.cn",
  "https://www.vandlvhs.cn",
  "https://cn.vandlvhs.com",
].filter(Boolean));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    if (!APP_URL) return cb(null, true); // local dev fallback
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
    res.setHeader("WWW-Authenticate", 'Basic realm="Vitava Admin"');
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
    res.setHeader("WWW-Authenticate", 'Basic realm="Vitava Admin"');
    return res.status(401).send("Authentication required.");
  }
  let creds;
  try { creds = Buffer.from(auth.slice(6), "base64").toString("utf8"); }
  catch { res.setHeader("WWW-Authenticate", 'Basic realm="Vitava Admin"'); return res.status(401).send("Invalid credentials."); }
  const idx = creds.indexOf(":");
  if (idx === -1) { adminFail(req._adminIp||req.ip); res.setHeader("WWW-Authenticate", 'Basic realm="Vitava Admin"'); return res.status(401).send("Invalid credentials."); }
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
    res.setHeader("WWW-Authenticate", 'Basic realm="Vitava Admin"');
    return res.status(401).send("Invalid credentials.");
  }
  adminOk(req._adminIp||req.ip); next();
}

// ── Admin auth now uses requireAdmin (Google login + ADMIN_EMAILS allowlist) ──

// ── JWT auth ───────────────────────────────────────────────────
// Accepts either the website's cookie (vhs_token) or a Bearer token in the
// Authorization header (used by the Mini Program, which can't rely on cookies).
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const token = req.cookies?.vhs_token || bearerToken;
  if (!token) return res.status(401).json({ error: "Not authenticated." });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { if (req.cookies?.vhs_token) res.clearCookie("vhs_token"); return res.status(401).json({ error: "Session expired." }); }
}

// ── Admin authorization: logged-in user whose email is on the allowlist ──
function requireAdmin(req, res, next) {
  const wantsPage = req.path === "/admin";
  const token = req.cookies?.vhs_token;
  if (!token) {
    if (wantsPage) return res.redirect("/login");
    return res.status(401).json({ error: "Not authenticated." });
  }
  try { req.user = jwt.verify(token, JWT_SECRET); }
  catch {
    res.clearCookie("vhs_token");
    if (wantsPage) return res.redirect("/login");
    return res.status(401).json({ error: "Session expired." });
  }
  const email = String(req.user.email || "").toLowerCase();
  if (!ADMIN_EMAILS.length || !ADMIN_EMAILS.includes(email)) {
    if (wantsPage) return res.status(403).send("Forbidden: this account is not an administrator.");
    return res.status(403).json({ error: "Not an administrator." });
  }
  next();
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
const GOOGLE_AUTH_DISABLED = ["1","true","yes"].includes(String(process.env.DISABLE_GOOGLE_AUTH||"").toLowerCase());
if (GOOGLE_AUTH_DISABLED) console.log("Google auth is DISABLED on this server (DISABLE_GOOGLE_AUTH set)");
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

// My Records — for a logged-in regular user to see only their own submitted data
app.get("/my-records", (req, res) => {
  const token = req.cookies?.vhs_token;
  if (!token) return res.redirect("/login");
  try { jwt.verify(token, JWT_SECRET); res.sendFile(path.join(__dirname,"public","my-records.html")); }
  catch { res.clearCookie("vhs_token"); res.redirect("/login"); }
});

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


// ── Robust JSON repair ────────────────────────────────────────
function repairJson(raw) {
  let s = raw.replace(/```json|```/g, "").trim();
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  s = s.replace(/\n/g, " ").replace(/\r/g, " ");
  // Try direct parse first
  try { return JSON.parse(s); } catch(e) {}
  // Find last complete closing brace
  let depth = 0, lastComplete = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) lastComplete = i; }
  }
  if (lastComplete > 0) {
    try { return JSON.parse(s.slice(0, lastComplete + 1)); } catch(e) {}
  }
  // Strip trailing incomplete key-value pair
  const trimmed = s.replace(/,\s*"[^"]*"\s*:\s*[^,}]*$/, "").replace(/,\s*$/, "") + "}";
  try { return JSON.parse(trimmed); } catch(e) {}
  // Last resort - extract what we can
  return null;
}


// ── Qwen (通义千问) API call ───────────────────────────────────
async function callQwen(messages, maxTokens, system) {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) throw new Error("QWEN_API_KEY not configured");
  
  const qwenMessages = [];
  if (system) qwenMessages.push({ role: "system", content: system });
  
  // Convert Anthropic-style messages to Qwen format
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      qwenMessages.push({ role: msg.role, content: msg.content });
    } else if (Array.isArray(msg.content)) {
      // Handle multimodal content (images + text)
      const parts = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          parts.push({ type: "text", text: part.text });
        } else if (part.type === "image" && part.source?.data) {
          parts.push({ 
            type: "image_url", 
            image_url: { url: `data:${part.source.media_type};base64,${part.source.data}` }
          });
        } else if (part.type === "document" && part.source?.data) {
          // Qwen doesn't support PDF directly - convert to text instruction
          parts.push({ type: "text", text: "[PDF document uploaded - please analyze the health report content]" });
        }
      }
      qwenMessages.push({ role: msg.role, content: parts });
    }
  }

  const resp = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "qwen-vl-max",
      messages: qwenMessages,
      max_tokens: maxTokens || 6000,
      stream: false
    })
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Qwen API error: ${resp.status} ${JSON.stringify(err)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || "";
}

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


// ── In-memory SMS code store (TTL 10 min) ─────────────────────
const _smsCodeStore = new Map();
function setSmsCode(phone, code) {
  _smsCodeStore.set(phone, { code, expires: Date.now() + 10 * 60 * 1000 });
  setTimeout(() => _smsCodeStore.delete(phone), 10 * 60 * 1000);
}
function verifySmsCode(phone, code) {
  const entry = _smsCodeStore.get(phone);
  if (!entry) return false;
  if (Date.now() > entry.expires) { _smsCodeStore.delete(phone); return false; }
  if (entry.code !== code) return false;
  _smsCodeStore.delete(phone);
  return true;
}


// ── Phone SMS Login ────────────────────────────────────────────
app.post("/api/sms-login/send", globalLimit, authLimit, async (req, res) => {
  const { phone } = req.body || {};
  if (!phone || !/^\+?[0-9]{8,15}$/.test(phone.replace(/[\s\-]/g, ""))) {
    return res.status(400).json({ error: "请输入有效的手机号码。" });
  }
  const normalizedPhone = phone.replace(/[\s\-]/g, "");
  const code = String(Math.floor(100000 + Math.random() * 900000));
  setSmsCode(normalizedPhone, code);

  try {
    const client = await getAliyunSmsClient();
    const { SendSmsRequest } = require("@alicloud/dysmsapi20170525/dist/models/SendSmsRequest");
    const AliyunTeaUtil = require("@alicloud/tea-util");
    const req2 = new SendSmsRequest({
      phoneNumbers: normalizedPhone,
      signName: process.env.ALIYUN_SMS_SIGN,
      templateCode: process.env.ALIYUN_SMS_LOGIN_TEMPLATE || "SMS_512160574",
      templateParam: JSON.stringify({ code }),
    });
    const resp = await client.sendSmsWithOptions(req2, new AliyunTeaUtil.RuntimeOptions({}));
    const body = resp.body || {};
    if (body.code !== "OK") {
      console.error("[sms-login] Send failed:", body.code, body.message);
      return res.status(500).json({ error: "短信发送失败，请稍后重试。" });
    }
    console.log("[sms-login] Code sent to", normalizedPhone.replace(/(\d{3})\d{4}(\d{4})/, "$1****$2"));
    res.json({ ok: true });
  } catch (e) {
    console.error("[sms-login] Error:", e.message);
    res.status(500).json({ error: "短信发送失败，请稍后重试。" });
  }
});

app.post("/api/sms-login/verify", globalLimit, authLimit, async (req, res) => {
  const { phone, code } = req.body || {};
  if (!phone || !code) return res.status(400).json({ error: "请输入手机号和验证码。" });
  const normalizedPhone = phone.replace(/[\s\-]/g, "");
  if (!verifySmsCode(normalizedPhone, String(code))) {
    return res.status(401).json({ error: "验证码错误或已过期，请重新获取。" });
  }
  try {
    const db = await getDB();
    let user = await db.collection("users").findOne({ phone: normalizedPhone });
    if (!user) {
      // Create new account
      user = {
        id: Date.now(),
        phone: normalizedPhone,
        username: "用户" + normalizedPhone.slice(-4),
        createdAt: new Date()
      };
      await db.collection("users").insertOne(user);
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, phone: normalizedPhone },
      JWT_SECRET,
      { expiresIn: "30d" }
    );
    res.json({ ok: true, token, user: { username: user.username, phone: normalizedPhone } });
  } catch (e) {
    console.error("[sms-login] Verify error:", e.message);
    res.status(500).json({ error: "登录失败，请重试。" });
  }
});

app.post("/api/wechat-login", globalLimit, async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: "Missing code." });
  try {
    const params = new URLSearchParams({
      appid: process.env.WECHAT_APPID,
      secret: process.env.WECHAT_SECRET,
      js_code: code,
      grant_type: "authorization_code"
    });
    const wxRes = await new Promise((resolve, reject) => {
      require("https").get(`https://api.weixin.qq.com/sns/jscode2session?${params}`, r => {
        let data = "";
        r.on("data", c => data += c);
        r.on("end", () => resolve(JSON.parse(data)));
      }).on("error", reject);
    });
    if (wxRes.errcode) {
      console.error("WeChat login error:", wxRes.errmsg);
      return res.status(401).json({ error: "WeChat auth failed." });
    }
    const { openid } = wxRes;
    const db = await getDB();
    let user = await db.collection("users").findOne({ wechatOpenId: openid });
    if (!user) {
      user = { id: crypto.randomUUID(), wechatOpenId: openid, username: `微信用户${openid.slice(-6)}`, createdAt: new Date() };
      await db.collection("users").insertOne(user);
    }
    const token = jwt.sign({ id: user.id, username: user.username, wechatOpenId: openid }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ ok: true, token, user: { username: user.username } });
  } catch (e) {
    console.error("WeChat login error:", e.message);
    res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("vhs_token", { httpOnly:true, secure:true, sameSite:"lax" });
  res.json({ ok:true });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user:{ username:req.user.username, email:req.user.email, id:req.user.id } });
});

const MONTHLY_LIMIT = 20;

async function checkMonthlyLimit(req, res, next) {
  // Unlimited accounts (team/admin) skip the monthly cap
  try {
    const _db = await getDB();
    const _u = await _db.collection("users").findOne({ id: req.user.id }, { projection: { unlimitedAnalysis: 1 } });
    if (_u && _u.unlimitedAnalysis === true) return next();
  } catch (e) {}

  try {
    const db = await getDB();
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const user = await db.collection("users").findOne({ id: req.user.id }, { projection: { usageMonthly: 1 } });
    const usage = user?.usageMonthly || {};
    const used = usage[monthKey] || 0;
    if (used >= MONTHLY_LIMIT) {
      // Send SSE-friendly error since headers may not be sent yet
      res.setHeader("Content-Type","text/event-stream");
      res.setHeader("Cache-Control","no-cache");
      res.flushHeaders();
      res.write(`data:${JSON.stringify({ error: `Monthly limit reached. You've used ${used}/${MONTHLY_LIMIT} analyses this month. Contact us to upgrade.` })}\n\n`);
      res.end();
      return;
    }
    req._monthKey = monthKey;
    req._usedCount = used;
    next();
  } catch(e) { next(); } // fail open — don't block on DB error
}

// Usage status endpoint — called by client on load
app.get("/api/usage", requireAuth, globalLimit, async (req, res) => {
  try {
    const db = await getDB();
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const user = await db.collection("users").findOne({ id: req.user.id }, { projection: { usageMonthly: 1, unlimitedAnalysis: 1 } });
    const used = user?.usageMonthly?.[monthKey] || 0;
    if (user && user.unlimitedAnalysis === true) {
      return res.json({ used, limit: 999999, remaining: 999999, monthKey, unlimited: true });
    }
    res.json({ used, limit: MONTHLY_LIMIT, remaining: Math.max(0, MONTHLY_LIMIT - used), monthKey });
  } catch(e) { res.status(500).json({ error: "Failed." }); }
});


app.get("/api/family/members", requireAuth, globalLimit, async (req, res) => {
  try {
    const db = await getDB();
    const user = await db.collection("users").findOne({ id: req.user.id }, { projection: { familyMembers: 1 } });
    res.json({ members: user?.familyMembers || [] });
  } catch(e) { res.status(500).json({ error: "Failed." }); }
});

app.post("/api/family/members", requireAuth, globalLimit, async (req, res) => {
  const { name, relation, age, gender } = req.body || {};
  if (!name || !relation) return res.status(400).json({ error: "Name and relation required." });
  const member = {
    id: Date.now().toString(),
    name: sanitize(name).slice(0, 60),
    relation: sanitize(relation).slice(0, 30),
    age: sanitize(String(age || "")).slice(0, 5),
    gender: sanitize(gender || "").slice(0, 20),
  };
  try {
    const db = await getDB();
    await db.collection("users").updateOne(
      { id: req.user.id },
      { $push: { familyMembers: member } }
    );
    res.json({ member });
  } catch(e) { res.status(500).json({ error: "Failed." }); }
});

app.delete("/api/family/members/:memberId", requireAuth, globalLimit, async (req, res) => {
  try {
    const db = await getDB();
    await db.collection("users").updateOne(
      { id: req.user.id },
      { $pull: { familyMembers: { id: req.params.memberId } } }
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: "Failed." }); }
});

app.get("/api/family/history/:memberId", requireAuth, globalLimit, async (req, res) => {
  try {
    const db = await getDB();
    const records = await db.collection("patients")
      .find({ userId: req.user.id, familyMemberId: req.params.memberId },
        { projection: { _id:0, ip:0, userId:0 } })
      .sort({ id: 1 })
      .limit(100)
      .toArray();
    res.json({ records });
  } catch(e) { res.status(500).json({ error: "Failed." }); }
});


app.post("/api/auth/forgot-password", globalLimit, authLimit, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error:"Email required." });
  try {
    const db = await getDB();
    const user = await db.collection("users").findOne({ email: email.toLowerCase().trim() });
    // Always return success to prevent email enumeration
    if (!user) return res.json({ ok: true });

    const token = crypto.randomBytes(32).toString("hex");
    const expiry = Date.now() + 60 * 60 * 1000; // 1 hour
    await db.collection("users").updateOne(
      { email: user.email },
      { $set: { resetToken: token, resetExpiry: expiry } }
    );

    const appUrl = process.env.APP_URL || "https://bloodrx.onrender.com";
    const resetUrl = `${appUrl}/reset-password?token=${token}`;

    console.log(`[forgot-password] Sending reset email to ${user.email}`);
    await sendResetEmail(user.email, resetUrl);
    console.log(`[forgot-password] Email sent successfully to ${user.email}`);
    res.json({ ok: true });
  } catch(e) {
    console.error("Forgot password error:", e.message);
    res.status(500).json({ error: "Failed to send reset email." });
  }
});

app.get("/reset-password", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "reset-password.html"));
});

app.post("/api/auth/reset-password", globalLimit, authLimit, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 8)
    return res.status(400).json({ error: "Invalid request." });
  try {
    const db = await getDB();
    const user = await db.collection("users").findOne({
      resetToken: token,
      resetExpiry: { $gt: Date.now() }
    });
    if (!user) return res.status(400).json({ error: "Reset link is invalid or has expired." });

    const passwordHash = await require("bcryptjs").hash(password, 12);
    await db.collection("users").updateOne(
      { email: user.email },
      { $set: { passwordHash }, $unset: { resetToken: "", resetExpiry: "" } }
    );
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: "Reset failed." });
  }
});

app.get("/auth/google", (req, res, next) => {
  if (GOOGLE_AUTH_DISABLED) return res.redirect("/login");
  next();
}, passport.authenticate("google", { scope:["profile","email"], session:false }));
app.get("/auth/google/callback",
  (req, res, next) => { if (GOOGLE_AUTH_DISABLED) return res.redirect("/login"); next(); },
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
app.post("/api/analyze", requireAuth, globalLimit, analysisLimit, checkMonthlyLimit, validateAnalysis, async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error:"Server configuration error." });

  // Set up SSE immediately so client knows we're alive
  res.setHeader("Content-Type","text/event-stream");
  res.setHeader("Cache-Control","no-cache");
  res.setHeader("Connection","keep-alive");
  res.setHeader("X-Accel-Buffering","no");
  res.flushHeaders();

  // Keepalive ping every 10s to prevent proxy/browser dropping the connection
  const keepalive = setInterval(() => {
    try { res.write(": ping\n\n"); } catch(e) { clearInterval(keepalive); }
  }, 10000);

  const sendEvent = (obj) => {
    try { res.write("data:" + JSON.stringify(obj) + "\n\n"); } catch(e) {}
  };

  let fullText = "";

  try {
    const abortCtrl = new AbortController();
    // 120s total timeout for the entire stream
    const streamTimeout = setTimeout(() => {
      abortCtrl.abort();
    }, 120000);

    // Count images to adjust output limits
    const msgContent = req.body.messages?.[0]?.content || [];
    const recordId = Date.now();
    const savedFiles = [];
    try {
      const uploadDir = path.join(__dirname, "uploads", String(recordId));
      const itemsToSave = Array.isArray(msgContent) ? msgContent.filter(p => (p.type === "image" || p.type === "document") && p.source?.data) : [];
      if (itemsToSave.length) {
        fs.mkdirSync(uploadDir, { recursive: true });
        itemsToSave.forEach((item, idx) => {
          const mediaType = item.source.media_type || "application/octet-stream";
          const ext = mediaType.split("/")[1]?.split("+")[0] || "bin";
          const fileName = `file${idx + 1}.${ext}`;
          const filePath = path.join(uploadDir, fileName);
          fs.writeFileSync(filePath, Buffer.from(item.source.data, "base64"));
          savedFiles.push({ fileName, mediaType, size: fs.statSync(filePath).size });
        });
      }
    } catch (fileErr) {
      console.error("File save error:", fileErr.message);
    }

    const imageCount = Array.isArray(msgContent) ? msgContent.filter(p => p.type === 'image').length : 0;
    const maxTokens = 8000; // Always 8000 — meal plan needs the room
    const sizeNote = imageCount >= 2
      ? 'Multiple images: max 3 findings, all non-meal text under 80 chars, max 2 recommendations each.'
      : 'max 5 findings, all non-meal text fields under 120 chars, recommendations max 3 items each under 100 chars.';

    const upstream = await fetch("https://bloodrx.onrender.com/api/anthropic-proxy", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-api-key":key, "anthropic-version":"2023-06-01" },
      signal: abortCtrl.signal,
      body: JSON.stringify({
        model:"claude-sonnet-4-6", max_tokens:maxTokens, stream:true,
        system:`You are a health wellness analyst. Return ONLY a single complete valid JSON object. CRITICAL: All string values must use only basic ASCII characters — no special quotes, no newlines inside strings, no backslashes, no unicode escapes. Replace any special characters with spaces. STRICT LIMITS: ${sizeNote} The meal_plan.week field should have all 7 days with brief meal names only (under 60 chars each). Always close the JSON object completely. No medication names or prescriptions.`,
        messages:req.body.messages,
      }),
    });

    if (!upstream.ok) {
      clearTimeout(streamTimeout);
      const err = await upstream.json().catch(()=>({}));
      console.error("Anthropic API error:", upstream.status, err);
      sendEvent({ error:"Analysis service error. Please try again." });
      clearInterval(keepalive);
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch(readErr) {
        console.error("Stream read error:", readErr.message);
        break;
      }
      if (chunk.done) break;

      buf += decoder.decode(chunk.value, { stream:true });
      const lines = buf.split("\n");
      buf = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (raw === "[DONE]") continue;
        try {
          const ev = JSON.parse(raw);
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            fullText += ev.delta.text;
            sendEvent({ t: ev.delta.text });
          }
        } catch(e) { /* skip malformed SSE line */ }
      }
    }

    clearTimeout(streamTimeout);

    // Always signal done to the client, even if stream ended unexpectedly
    sendEvent({ done: true });

    // Increment monthly usage counter (non-blocking)
    if (req._monthKey) {
      getDB().then(db => db.collection("users").updateOne(
        { id: req.user.id },
        { $inc: { [`usageMonthly.${req._monthKey}`]: 1 } }
      )).catch(() => {});
    }

  } catch(e) {
    console.error("Analysis error:", e.message);
    sendEvent({ error: e.name === "AbortError"
      ? "Analysis timed out. Please try again."
      : "Analysis failed: " + e.message });
  } finally {
    clearInterval(keepalive);
    res.end();
  }

  // Save to DB (non-blocking, after response ends)
  if (!fullText) return;
  try {
    const result = repairJson(fullText);
    const prompt = req.body.messages.map(m=>typeof m.content==="string"?m.content:Array.isArray(m.content)?m.content.filter(p=>p.type==="text").map(p=>p.text).join(" "):"").join(" ");
    const g = k => { const m=prompt.match(new RegExp(k+":\\s*(.+)")); return m?m[1]:""; };
    const record = {
      id: (typeof recordId !== "undefined" ? recordId : Date.now()), userId: req.user.id, submittedBy: req.user.username,
      shareToken: crypto.randomUUID().replace(/-/g, ""),
      filePaths: (typeof savedFiles !== "undefined" ? savedFiles : []), filesExpireAt: new Date(Date.now() + 180*24*60*60*1000).toISOString(),
      familyMemberId: sanitize(g("FamilyMemberId") || ""),
      familyMemberName: sanitize(g("FamilyMemberName") || ""),
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
      meal_plan: result.meal_plan || null,
      ip: req.ip||"", created_at: new Date().toISOString(),
    };
    getDB().then(db => db.collection("patients").insertOne(record))
      .then(() => {
        sendReportSms(req.body.patientPhone || record.phone, record.name, record.id, record.shareToken)
          .catch(e => console.error("[sms] unexpected error:", e.message));
      })
      .catch(e => console.log("DB save error:", e.message));
  } catch(e) { console.log("DB parse error:", e.message, "| Raw length:", fullText.length); }
});

// ══════════════════════════════════════════════════════════════
// ANALYSIS (non-streaming) — for clients that can't consume SSE,
// e.g. the WeChat Mini Program. Same auth/rate-limit/quota rules
// and same request shape ({messages:[...]}) as /api/analyze, but
// waits for the full result and responds with one JSON object
// instead of a stream. Uses a lower max_tokens than the website
// as a modest cost control for this path.
// ══════════════════════════════════════════════════════════════
app.post("/api/analyze-sync", requireAuth, globalLimit, analysisLimit, checkMonthlyLimit, validateAnalysis, async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error:"Server configuration error." });

  let fullText = "";
  const msgContent = req.body.messages?.[0]?.content || [];
  const recordId = Date.now();
  const savedFiles = [];
  try {
    const uploadDir = path.join(__dirname, "uploads", String(recordId));
    const itemsToSave = Array.isArray(msgContent) ? msgContent.filter(p => (p.type === "image" || p.type === "document") && p.source?.data) : [];
    if (itemsToSave.length) {
      fs.mkdirSync(uploadDir, { recursive: true });
      itemsToSave.forEach((item, idx) => {
        const mediaType = item.source.media_type || "application/octet-stream";
        const ext = mediaType.split("/")[1]?.split("+")[0] || "bin";
        const fileName = `file${idx + 1}.${ext}`;
        const filePath = path.join(uploadDir, fileName);
        fs.writeFileSync(filePath, Buffer.from(item.source.data, "base64"));
        savedFiles.push({ fileName, mediaType, size: fs.statSync(filePath).size });
      });
    }
  } catch (fileErr) {
    console.error("File save error (sync):", fileErr.message);
  }

  const imageCount = Array.isArray(msgContent) ? msgContent.filter(p => p.type === 'image').length : 0;
  const maxTokens = 6000; // lower than the website's 8000 - cost control for this path
  const sizeNote = imageCount >= 2
    ? 'Multiple images: max 3 findings, all non-meal text under 80 chars, max 2 recommendations each.'
    : 'max 5 findings, all non-meal text fields under 120 chars, recommendations max 3 items each under 100 chars.';

  try {
    const abortCtrl = new AbortController();
    const streamTimeout = setTimeout(() => abortCtrl.abort(), 120000);

    const upstream = await fetch("https://bloodrx.onrender.com/api/anthropic-proxy", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-api-key":key, "anthropic-version":"2023-06-01" },
      signal: abortCtrl.signal,
      body: JSON.stringify({
        model:"claude-sonnet-4-6", max_tokens:maxTokens, stream:true,
        system:`You are a health wellness analyst. Return ONLY a single complete valid JSON object. CRITICAL: All string values must use only basic ASCII characters — no special quotes, no newlines inside strings, no backslashes, no unicode escapes. Replace any special characters with spaces. STRICT LIMITS: ${sizeNote} The meal_plan.week field should have all 7 days with brief meal names only (under 60 chars each). Always close the JSON object completely. No medication names or prescriptions.`,
        messages:req.body.messages,
      }),
    });

    if (!upstream.ok) {
      clearTimeout(streamTimeout);
      const err = await upstream.json().catch(()=>({}));
      console.error("Anthropic API error (sync):", upstream.status, err);
      return res.status(502).json({ error:"Analysis service error. Please try again." });
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch(readErr) {
        console.error("Stream read error (sync):", readErr.message);
        break;
      }
      if (chunk.done) break;

      buf += decoder.decode(chunk.value, { stream:true });
      const lines = buf.split("\n");
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (raw === "[DONE]") continue;
        try {
          const ev = JSON.parse(raw);
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
            fullText += ev.delta.text;
          }
        } catch(e) { /* skip malformed SSE line */ }
      }
    }

    clearTimeout(streamTimeout);

    if (req._monthKey) {
      getDB().then(db => db.collection("users").updateOne(
        { id: req.user.id },
        { $inc: { [`usageMonthly.${req._monthKey}`]: 1 } }
      )).catch(() => {});
    }
  } catch(e) {
    console.error("Analysis error (sync):", e.message);
    return res.status(500).json({ error: e.name === "AbortError" ? "Analysis timed out. Please try again." : "Analysis failed: " + e.message });
  }

  if (!fullText) return res.status(500).json({ error: "Analysis produced no output. Please try again." });

  try {
    const result = repairJson(fullText);
    const prompt = req.body.messages.map(m=>typeof m.content==="string"?m.content:Array.isArray(m.content)?m.content.filter(p=>p.type==="text").map(p=>p.text).join(" "):"").join(" ");
    const g = k => { const m=prompt.match(new RegExp(k+":\\s*(.+)")); return m?m[1]:""; };
    const record = {
      id: recordId, userId: req.user.id, submittedBy: req.user.username,
      shareToken: crypto.randomUUID().replace(/-/g, ""),
      filePaths: savedFiles, filesExpireAt: new Date(Date.now() + 180*24*60*60*1000).toISOString(),
      familyMemberId: sanitize(g("FamilyMemberId") || ""),
      familyMemberName: sanitize(g("FamilyMemberName") || ""),
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
      meal_plan: result.meal_plan || null,
      ip: req.ip||"", created_at: new Date().toISOString(),
    };
    getDB().then(db => db.collection("patients").insertOne(record))
      .then(() => {
        sendReportSms(req.body.patientPhone || record.phone, record.name, record.id, record.shareToken)
          .catch(e => console.error("[sms] unexpected error:", e.message));
      })
      .catch(e => console.log("DB save error (sync):", e.message));

    return res.json({ ok:true, result, id: record.id, shareToken: record.shareToken });
  } catch(e) {
    console.log("DB parse error (sync):", e.message, "| Raw length:", fullText.length);
    return res.status(500).json({ error: "Failed to parse analysis result. Please try again." });
  }
});

// ══════════════════════════════════════════════════════════════
// ADMIN
// ══════════════════════════════════════════════════════════════
app.get("/admin", adminLimit, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname,"public","admin.html"));
});

app.get("/api/admin/patients", adminLimit, requireAdmin, async (req, res) => {
  try {
    const db = await getDB();
    const rows = await db.collection("patients").find({},{ projection:{_id:0,ip:0} }).sort({id:-1}).limit(1000).toArray();
    res.json(rows);
  } catch(e) { res.status(500).json({ error:"Failed to load." }); }
});

// ── Delete ALL records for a patient (bulk by ids) ─────────────
// ── File download for user's own records ──────────────────────
app.get("/api/records/:id/files", requireAuth, globalLimit, async (req, res) => {
  try {
    const db = await getDB();
    const record = await db.collection("patients").findOne({ id: Number(req.params.id), userId: req.user.id });
    if (!record) return res.status(404).json({ error: "Record not found." });
    res.json({ files: record.filePaths || [], expiresAt: record.filesExpireAt || null });
  } catch (e) {
    res.status(500).json({ error: "Failed to list files." });
  }
});

app.get("/api/records/:id/files/:fileName", requireAuth, globalLimit, async (req, res) => {
  try {
    const db = await getDB();
    const record = await db.collection("patients").findOne({ id: Number(req.params.id), userId: req.user.id });
    if (!record) return res.status(404).json({ error: "Record not found." });
    const safeFileName = path.basename(req.params.fileName);
    const filePath = path.join(__dirname, "uploads", String(record.id), safeFileName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found or expired." });
    res.download(filePath, safeFileName);
  } catch (e) {
    res.status(500).json({ error: "Failed to download file." });
  }
});

// ── Public shareable report page (for SMS links) ───────────────
function escHtmlPub(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
app.get("/r/:id", globalLimit, async (req, res) => {
  try {
    const token = String(req.query.t || "");
    if (!token || token.length < 16) return res.status(404).send("Report not found.");
    const db = await getDB();
    const record = await db.collection("patients").findOne({ id: Number(req.params.id), shareToken: token });
    if (!record) return res.status(404).send("Report not found or link expired.");

    const name = escHtmlPub(record.patientName || "用户");
    const date = escHtmlPub(String(record.createdAt || record.created_at || "").slice(0, 10));
    const summary = escHtmlPub(record.health_assessment || record.summary || record.overall_summary || "");

    // Build findings from key_health_concerns
    const rawFindings = Array.isArray(record.key_health_concerns) ? record.key_health_concerns : [];
    const findings = rawFindings.map(f => typeof f === "string" ? { title: f, description: "" } : f);

    // Build recommendations from lifestyle + nutrition
    const lifestyle = Array.isArray(record.lifestyle_recommendations) ? record.lifestyle_recommendations :
      (record.lifestyle ? record.lifestyle.split(" | ").filter(Boolean) : []);
    const nutrition = Array.isArray(record.nutrition_recommendations) ? record.nutrition_recommendations :
      (record.nutrition ? record.nutrition.split(" | ").filter(Boolean) : []);
    const recs = [...lifestyle, ...nutrition];

    // Extra sections
    const monitoring = escHtmlPub(record.monitoring_plan || "");
    const supplements = record.supplements ? record.supplements.split(" | ").filter(Boolean) : [];
    const mealPlan = record.meal_plan || null;

    // Risk scores
    const risks = [
      { label: "心血管", score: record.risk_cardiovascular || 0 },
      { label: "代谢", score: record.risk_metabolic || 0 },
      { label: "肝脏", score: record.risk_liver || 0 },
      { label: "肾脏", score: record.risk_kidney || 0 },
      { label: "炎症", score: record.risk_inflammation || 0 },
    ].filter(r => r.score > 0);

    // Patient info
    const patAge = escHtmlPub(record.age || "");
    const patGender = escHtmlPub(record.gender || "");
    const patComplaint = escHtmlPub(record.complaint || "");

    const findingsHtml = findings.map(f => {
      const t = escHtmlPub(typeof f === "string" ? f : (f.title || ""));
      const d = escHtmlPub(typeof f === "object" && f ? (f.description || "") : "");
      return `<div class="item"><div class="dot"></div><div><div class="item-t">${t}</div>${d ? `<div class="item-d">${d}</div>` : ""}</div></div>`;
    }).join("");

    const recsHtml = recs.map((r, i) => {
      const t = escHtmlPub(typeof r === "string" ? r : (r.text || r.title || ""));
      return `<div class="item"><div class="num">${i + 1}</div><div class="item-t rec">${t}</div></div>`;
    }).join("");

    res.send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vitava 健康报告</title>
<style>
  body{margin:0;font-family:-apple-system,'PingFang SC','Helvetica Neue',sans-serif;background:#F7FAF9;color:#102A2E;}
  .wrap{max-width:640px;margin:0 auto;padding:24px 20px 48px;}
  .brand{display:flex;align-items:center;gap:8px;margin-bottom:20px;}
  .mark{width:16px;height:16px;border-radius:5px;background:#0E9384;}
  .brand-t{font-size:17px;font-weight:700;}
  .card{background:#fff;border-radius:16px;padding:22px;margin-bottom:14px;box-shadow:0 3px 12px rgba(16,42,46,.05);}
  h1{font-size:20px;margin:0 0 4px;}
  .meta{font-size:13px;color:#7C9296;margin-bottom:10px;}
  .summary{font-size:14px;color:#33454A;line-height:1.75;}
  h2{font-size:15px;margin:0 0 14px;padding-left:10px;border-left:4px solid #0E9384;}
  .item{display:flex;gap:10px;margin-bottom:12px;align-items:flex-start;}
  .dot{width:8px;height:8px;border-radius:50%;background:#0E9384;margin-top:6px;flex-shrink:0;}
  .num{width:22px;height:22px;border-radius:50%;background:#E7F5F2;color:#0E9384;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .item-t{font-size:14px;font-weight:600;}
  .item-t.rec{font-weight:400;line-height:1.7;}
  .item-d{font-size:13px;color:#7C9296;margin-top:2px;line-height:1.6;}
  .foot{font-size:11px;color:#9DAFB2;text-align:center;line-height:1.8;margin-top:28px;}
</style></head><body><div class="wrap">
  <div class="brand"><div class="mark"></div><div class="brand-t">Vitava 健康</div></div>
  <div class="card"><h1>${name} 的健康解读</h1><div class="meta">${date}</div>
  ${summary ? `<div class="summary">${summary}</div>` : ""}</div>
  ${findingsHtml ? `<div class="card"><h2>主要发现</h2>${findingsHtml}</div>` : ""}
  ${recsHtml ? `<div class="card"><h2>健康建议</h2>${recsHtml}</div>` : ""}
  ${supplements.length ? `<div class="card"><h2>营养补充建议</h2>${supplements.map(s=>`<div class="item"><div class="dot" style="background:#0E9384"></div><div class="item-t" style="font-weight:400;line-height:1.7">${escHtmlPub(s)}</div></div>`).join("")}</div>` : ""}
  ${risks.length ? `<div class="card"><h2>风险评估</h2>${risks.map(r=>{const pct=Math.round(r.score/5*100);const col=r.score<=1?"#059669":r.score<=3?"#d97706":"#dc2626";return `<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>${r.label}</span><span style="color:${col};font-weight:600">${r.score}/5</span></div><div style="background:#f0f0f0;border-radius:4px;height:8px"><div style="width:${pct}%;background:${col};height:8px;border-radius:4px"></div></div></div>`;}).join("")}</div>` : ""}
  ${monitoring ? `<div class="card"><h2>复查计划</h2><p style="font-size:14px;color:#33454A;line-height:1.75">${monitoring}</p></div>` : ""}
  ${mealPlan && mealPlan.week ? `<div class="card"><h2>饮食建议</h2><table style="width:100%;border-collapse:collapse;font-size:13px">${mealPlan.week.map(d=>`<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:8px 4px;color:#7C9296;width:40px">${escHtmlPub(d.day||"")}</td><td style="padding:8px 4px">${escHtmlPub(d.meals||d.summary||"")}</td></tr>`).join("")}</table></div>` : ""}
  <div class="foot">本报告仅用于健康教育与wellness管理，不构成医疗诊断或处方。<br>沪ICP备2026036977号-1 · 上海裔陇生物科技有限公司</div>
</div></body></html>`);
  } catch (e) {
    console.error("Public report error:", e.message);
    res.status(500).send("Failed to load report.");
  }
});

// ── Mini Program non-streaming analyze endpoint ───────────────
app.post("/api/mp/analyze", requireAuth, globalLimit, analysisLimit, checkMonthlyLimit, async (req, res) => {
  const { messages, patientName, patientAge, patientGender, patientPhone, chiefComplaint, clinicalNotes, language } = req.body || {};
  if (!messages || !Array.isArray(messages) || !messages.length)
    return res.status(400).json({ error: "Invalid request." });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "API key not configured." });

  // Increment monthly usage
  if (req._monthKey) {
    getDB().then(db => db.collection("users").updateOne(
      { id: req.user.id },
      { $inc: { [`usageMonthly.${req._monthKey}`]: 1 } }
    )).catch(() => {});
  }

  try {
    const system = `You are a health wellness analyst. Return ONLY a single complete valid JSON object. CRITICAL: All string values must use only basic ASCII characters — no special quotes, no newlines inside strings, no backslashes, no unicode escapes. Replace any special characters with spaces. No medication names or prescriptions. Always close the JSON object completely.`;
    
    let fullText = "";
    try {
      fullText = await callQwen(messages, 6000, system);
    } catch(qwenErr) {
      console.error("Qwen API error:", qwenErr.message);
      return res.status(502).json({ error: "Analysis service temporarily unavailable. Please try again." });
    }
    if (!fullText) return res.status(500).json({ error: "Empty response from AI." });

    let result = {};
    try {
      const cleaned = fullText.replace(/```json|```/g, "").trim().replace(/\n/g, " ").replace(/\r/g, " ");
      result = JSON.parse(cleaned);
    } catch(e) {
      return res.status(500).json({ error: "Failed to parse analysis result." });
    }

    const sanitize = s => (s || "").replace(/[<>&"']/g, "").trim();
    const g = (k) => result[k] || result[k.toLowerCase()] || result[k.replace(/ /g, "_")] || "";

    const record = {
      id: Date.now(),
      userId: req.user.id,
      submittedBy: req.user.username,
      name: sanitize(patientName || g("Name") || ""),
      phone: sanitize(patientPhone || g("Phone") || ""),
      age: sanitize(String(patientAge || g("Age") || "")),
      gender: sanitize(patientGender === "男" ? "male" : patientGender === "女" ? "female" : patientGender || g("Gender") || ""),
      complaint: sanitize(chiefComplaint || g("Health concern") || ""),
      notes: sanitize(clinicalNotes || g("Health notes") || ""),
      vhs_score: Math.min(100, Math.max(0, Number(result.vhs_score) || 0)),
      vhs_label: sanitize(result.vhs_label || ""),
      summary: sanitize(result.health_assessment || ""),
      key_health_concerns: Array.isArray(result.key_health_concerns) ? result.key_health_concerns.map(s => sanitize(s)) : [],
      risk_cardiovascular: Math.min(5, Math.max(0, Number(result.risk_profile?.cardiovascular?.score) || 0)),
      risk_metabolic: Math.min(5, Math.max(0, Number(result.risk_profile?.metabolic?.score) || 0)),
      risk_liver: Math.min(5, Math.max(0, Number(result.risk_profile?.liver?.score) || 0)),
      risk_kidney: Math.min(5, Math.max(0, Number(result.risk_profile?.kidney?.score) || 0)),
      risk_inflammation: Math.min(5, Math.max(0, Number(result.risk_profile?.inflammation?.score) || 0)),
      nutrition: (result.nutrition_recommendations || []).map(s => sanitize(s)).join(" | ").slice(0, 500),
      lifestyle: (result.lifestyle_recommendations || []).map(s => sanitize(s)).join(" | ").slice(0, 500),
      supplements: (result.nutritional_support || []).map(s => sanitize(s)).join(" | ").slice(0, 500),
      monitoring_plan: sanitize(result.monitoring_plan || ""),
      meal_plan: result.meal_plan || null,
      shareToken: require("crypto").randomUUID().replace(/-/g, ""),
      filePaths: [],
      filesExpireAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
      ip: req.ip || "",
    };

    getDB().then(async db => {
      await db.collection("patients").insertOne(record);
      sendReportSms(record.phone, record.name, record.id, record.shareToken);
    }).catch(e => console.error("MP analyze save error:", e.message));

    res.json(record);
  } catch(e) {
    console.error("MP analyze error:", e.message);
    res.status(500).json({ error: "Analysis failed: " + e.message });
  }
});

// ── Delete family member ───────────────────────────────────────
app.delete("/api/family/members/:memberId", requireAuth, globalLimit, async (req, res) => {
  const memberId = req.params.memberId;
  try {
    const db = await getDB();
    const user = await db.collection("users").findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: "User not found." });
    const members = (user.familyMembers || []).filter(m => String(m.id) !== String(memberId));
    await db.collection("users").updateOne({ id: req.user.id }, { $set: { familyMembers: members } });
    res.json({ ok: true, members });
  } catch(e) {
    res.status(500).json({ error: "Failed to delete member." });
  }
});

app.post("/api/admin/patients/delete", adminLimit, requireAdmin, async (req, res) => {
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
app.post("/api/admin/records/delete-one", adminLimit, requireAdmin, async (req, res) => {
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

app.get("/api/admin/users", adminLimit, requireAdmin, async (req, res) => {
  try {
    const db = await getDB();
    const users = await db.collection("users").find({},{ projection:{_id:0,passwordHash:0} }).sort({id:-1}).limit(500).toArray();
    res.json(users);
  } catch(e) { res.status(500).json({ error:"Failed." }); }
});

// ══════════════════════════════════════════════════════════════
// MY RECORDS — regular logged-in user, scoped to their own data
// ══════════════════════════════════════════════════════════════
app.get("/api/my/records", requireAuth, globalLimit, async (req, res) => {
  try {
    const db = await getDB();
    const rows = await db.collection("patients")
      .find({ userId: req.user.id }, { projection:{ _id:0, ip:0, userId:0 } })
      .sort({ id:-1 })
      .limit(500)
      .toArray();
    res.json(rows);
  } catch(e) { res.status(500).json({ error:"Failed to load records." }); }
});

app.post("/api/my/records/delete", requireAuth, globalLimit, async (req, res) => {
  const { id } = req.body || {};
  const num = Number(id);
  if (!Number.isFinite(num) || num <= 0) return res.status(400).json({ error:"Invalid ID." });
  try {
    const db = await getDB();
    // Only allow deleting records owned by this user
    const r = await db.collection("patients").deleteOne({ id: num, userId: req.user.id });
    if (r.deletedCount === 0) return res.status(404).json({ error:"Record not found or not yours." });
    res.json({ deleted: 1 });
  } catch(e) { res.status(500).json({ error:"Delete failed." }); }
});

// ══════════════════════════════════════════════════════════════
// BOT & TRANSLATE
// ══════════════════════════════════════════════════════════════
const BOT_SYSTEM = `You are the Vitava Assistant for Vitava Health Score platform. Your ONLY job is to help users understand how to submit their health report and interpret their Vitava wellness results. STRICTLY LIMITED to: form filling, file upload, Vitava score meaning, risk categories, recommendation sections, starting a new assessment. REFUSE everything else. Keep responses under 3 sentences. Be friendly and clear.`;

app.post("/api/bot", requireAuth, globalLimit, botLimit, async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error:"Configuration error." });
  const { messages, translate, system: customSystem } = req.body||{};
  if (!messages||!Array.isArray(messages)||!messages.length||messages.length>12) return res.status(400).json({ error:"Invalid request." });
  const limit = translate ? 8000 : (customSystem ? 6000 : 1000);
  for (const m of messages) {
    if (!["user","assistant"].includes(m.role)||typeof m.content!=="string"||m.content.length>limit) return res.status(400).json({ error:"Invalid message." });
  }
  // Use custom system prompt for family health chat, otherwise use default bot system
  const systemPrompt = (customSystem && typeof customSystem === 'string' && customSystem.length < 6000 && !translate)
    ? customSystem
    : translate ? "You are a professional medical translator. Return ONLY valid JSON with same keys." : BOT_SYSTEM;
  const maxTok = translate ? 2000 : (customSystem ? 1000 : 300);
  try {
    const r = await fetch("https://bloodrx.onrender.com/api/anthropic-proxy", {
      method:"POST",
      headers:{ "Content-Type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01" },
      body:JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:maxTok, system:systemPrompt, messages:messages.slice(-8) }),
    });
    const data = await r.json();
    if (!r.ok) { console.error("Bot API error:", JSON.stringify(data)); return res.status(500).json({ error:"Bot unavailable." }); }
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
    const r = await fetch("https://bloodrx.onrender.com/api/anthropic-proxy", {
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
    const r = await fetch("https://bloodrx.onrender.com/api/anthropic-proxy", {
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
// ANTHROPIC PROXY — for China server which cannot reach Anthropic directly
// ══════════════════════════════════════════════════════════════
app.post("/api/anthropic-proxy", async (req, res) => {
  // Only allow requests from China server
  const allowedIPs = ["8.153.73.140", "127.0.0.1", "::1"];
  const clientIP = req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.ip;
  const ip = clientIP.split(",")[0].trim();
  if (!allowedIPs.includes(ip)) return res.status(403).json({ error:"Forbidden." });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error:"Configuration error." });

  const isStreaming = req.body && req.body.stream === true;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify(req.body)
    });

    if (isStreaming) {
      // Stream the SSE response directly back to China server
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.status(r.status);
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
      res.end();
    } else {
      const data = await r.json();
      res.status(r.status).json(data);
    }
  } catch(e) {
    res.status(500).json({ error: "Proxy error: " + e.message });
  }
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
app.listen(PORT, () => console.log("Vitava running on port " + PORT));
