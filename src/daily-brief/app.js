// Zahab Daily Brief admin console — Express app, shared by:
//   - local:  src/daily-brief/server.js  (node, port 3600, full features)
//   - online: api/index.js on Vercel     (serverless, read-only briefs from the repo)
// Login: ADMIN_EMAIL / ADMIN_PASSWORD (defaults shashank@admin.com / royal2026).
// Auth cookie is a stateless HMAC of the admin credentials — serverless instances
// share no memory, so a session store cannot work there.
import "./env.js";
import express from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { existsSync } from "fs";
import { join } from "path";
import { istDateParts } from "./plan.js";
import { generateBrief, loadBrief, listBriefs, BRIEFS_DIR } from "./generate.js";
import { deliverBrief } from "./notify.js";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "shashank@admin.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "royal2026";
const READ_ONLY = Boolean(process.env.VERCEL); // no disk writes / no generation on Vercel

function sessionToken() {
  return createHmac("sha256", `${ADMIN_EMAIL}|${ADMIN_PASSWORD}`).update("zahab-brief-admin").digest("hex");
}
function isAuthed(req) {
  const m = /brief_session=([a-f0-9]{64})/.exec(req.headers.cookie || "");
  if (!m) return false;
  const got = Buffer.from(m[1], "hex");
  const want = Buffer.from(sessionToken(), "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: "Not signed in" });
}

export function createApp() {
  const app = express();
  app.use(express.json());

  app.post("/api/login", (req, res) => {
    const { email, password } = req.body || {};
    if (String(email).trim().toLowerCase() === ADMIN_EMAIL.toLowerCase() && password === ADMIN_PASSWORD) {
      res.setHeader("Set-Cookie", `brief_session=${sessionToken()}; HttpOnly; Path=/; Max-Age=604800`);
      return res.json({ ok: true });
    }
    res.status(401).json({ error: "Email or password is incorrect." });
  });
  app.post("/api/logout", (_req, res) => {
    res.setHeader("Set-Cookie", "brief_session=; Path=/; Max-Age=0");
    res.json({ ok: true });
  });
  app.get("/api/me", (req, res) => res.json({ signedIn: isAuthed(req), readOnly: READ_ONLY }));

  app.get("/api/briefs", requireAuth, (_req, res) => res.json(listBriefs()));
  app.get("/api/briefs/:id", requireAuth, (req, res) => {
    try {
      res.json(loadBrief(req.params.id));
    } catch {
      res.status(404).json({ error: "Brief not found" });
    }
  });
  app.get("/api/briefs/:id/audio.mp3", requireAuth, (req, res) => {
    const p = join(BRIEFS_DIR, req.params.id, "brief.mp3");
    if (!existsSync(p)) return res.status(404).end();
    res.sendFile(p);
  });
  app.post("/api/generate", requireAuth, async (req, res) => {
    if (READ_ONLY) {
      return res.status(400).json({
        error: "Generation runs on GitHub Actions (daily 8 PM IST) or locally with `npm run brief:today`. The online console shows the briefs the Action commits to the repo.",
      });
    }
    try {
      const date = req.body?.date || istDateParts().iso;
      const brief = await generateBrief(date, { force: Boolean(req.body?.force) });
      res.json(brief.off ? brief : { ok: true, id: brief.id, off: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.post("/api/briefs/:id/send", requireAuth, async (req, res) => {
    try {
      const brief = loadBrief(req.params.id);
      const result = await deliverBrief(brief);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/", (_req, res) => res.type("html").send(PAGE));
  return app;
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zahab Daily Brief Console</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: Georgia, 'Times New Roman', serif; background: #fafaf9; color: #172554; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 32px 20px; }
  .card { background: #fff; border: 1px solid #e7e5e4; border-radius: 16px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.05); }
  h1 { font-weight: 400; font-size: 26px; } h2 { font-weight: 400; font-size: 19px; margin-bottom: 12px; }
  .sub { color: #78716c; font-size: 13px; margin-top: 4px; }
  input { width: 100%; padding: 10px 12px; border: 1px solid #d6d3d1; border-radius: 10px; font-size: 14px; margin-top: 6px; }
  label { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: #78716c; display: block; margin-top: 14px; }
  button { background: #172554; color: #fef3c7; border: 0; border-radius: 999px; padding: 10px 20px; font-size: 13px; cursor: pointer; margin-top: 16px; }
  button.ghost { background: #f5f5f4; color: #172554; }
  button:disabled { opacity: .5; cursor: wait; }
  .err { color: #be123c; font-size: 13px; margin-top: 10px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .pill { font-size: 11px; padding: 3px 10px; border-radius: 999px; background: #fef3c7; color: #92400e; }
  .pill.ok { background: #dcfce7; color: #14532d; } .pill.bad { background: #ffe4e6; color: #9f1239; }
  pre { white-space: pre-wrap; font-family: inherit; font-size: 14px; line-height: 1.65; color: #1e293b; background: #fafaf9; border-radius: 10px; padding: 14px; margin-top: 8px; }
  .brief-item { padding: 14px 0; border-bottom: 1px solid #f5f5f4; cursor: pointer; }
  .brief-item:hover { background: #fafaf9; }
  audio { width: 100%; margin-top: 10px; }
  .hidden { display: none; }
  .crown { width: 44px; height: 44px; border-radius: 12px; background: #172554; color: #fde68a; display: inline-flex; align-items: center; justify-content: center; font-size: 22px; margin-bottom: 10px; }
</style></head>
<body><div class="wrap">
  <div id="login" class="hidden">
    <div style="text-align:center;margin:40px 0 24px"><div class="crown">♛</div>
      <h1>Zahab Daily Brief Console</h1><div class="sub">Voice notes &amp; translations · Admin access only</div></div>
    <div class="card" style="max-width:420px;margin:0 auto">
      <label>Email</label><input id="email" type="email" placeholder="shashank@admin.com">
      <label>Password</label><input id="password" type="password" placeholder="Password">
      <div id="loginErr" class="err"></div>
      <button onclick="login()" style="width:100%">Sign In</button>
    </div>
  </div>

  <div id="appMain" class="hidden">
    <div class="row" style="justify-content:space-between;margin-bottom:20px">
      <div><h1>Zahab and Rishabh · Daily Cleaning Brief</h1>
        <div class="sub">Azure Swara voice note · OpenAI translation · new brief every evening for the next day</div></div>
      <button class="ghost" onclick="logout()">Sign Out</button>
    </div>
    <div class="card" id="genCard">
      <div class="row">
        <button id="genBtn" onclick="generateToday()">Generate Today's Brief</button>
        <input id="genDate" type="date" style="width:auto;margin-top:16px">
        <button class="ghost" onclick="generateForDate()">Generate for Date</button>
        <span id="genStatus" class="sub"></span>
      </div>
    </div>
    <div class="card"><h2>Briefs</h2><div id="list" class="sub">Loading…</div></div>
    <div id="detail" class="card hidden"></div>
  </div>
</div>
<script>
const $ = (id) => document.getElementById(id);
async function api(path, opts) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (r.status === 401) { show("login"); throw new Error("auth"); }
  return r.json();
}
function show(view) {
  $("login").classList.toggle("hidden", view !== "login");
  $("appMain").classList.toggle("hidden", view !== "app");
}
async function login() {
  $("loginErr").textContent = "";
  const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: $("email").value, password: $("password").value }) });
  if (!r.ok) { $("loginErr").textContent = "Email or password is incorrect."; return; }
  show("app"); refresh();
}
async function logout() { await fetch("/api/logout", { method: "POST" }); show("login"); }
async function refresh() {
  const briefs = await api("/api/briefs");
  $("list").innerHTML = briefs.length ? briefs.map(b => \`
    <div class="brief-item" onclick="openBrief('\${b.id}')">
      <div class="row" style="justify-content:space-between">
        <strong>\${b.weekday}, \${b.date} — Day \${b.day} of 78</strong>
        <span>
          <span class="pill">\${b.totalTasks} tasks · ~\${b.totalMinutes} min</span>
          <span class="pill \${b.sent?.email?.ok ? "ok" : "bad"}">email \${b.sent?.email?.ok ? "sent" : b.sent ? "pending" : "not sent"}</span>
        </span>
      </div>
    </div>\`).join("") : "No briefs yet. The nightly run (8 PM IST) adds the next day's brief.";
}
async function openBrief(id) {
  const b = await api("/api/briefs/" + id);
  $("detail").classList.remove("hidden");
  $("detail").innerHTML = \`
    <h2>\${b.weekday}, \${b.date} — Day \${b.day} · Week \${b.week} · \${b.totalTasks} tasks</h2>
    <div class="sub">Voice: \${b.voice} · Translation: OpenAI \${b.translateModel} · \${Math.round(b.audioBytes/1024)} KB
      \${b.sent?.email ? " · email: " + (b.sent.email.ok ? "sent ✓" : (b.sent.email.detail||"failed")) : ""}
      \${b.sent?.whatsapp ? " · whatsapp: " + (b.sent.whatsapp.ok ? "sent ✓" : (b.sent.whatsapp.skipped ? "skipped" : "failed")) : ""}</div>
    <audio controls src="/api/briefs/\${b.id}/audio.mp3"></audio>
    <div class="row"><button onclick="sendBrief('\${b.id}')">Send Now (Email + WhatsApp)</button><span id="sendStatus" class="sub"></span></div>
    <h2 style="margin-top:20px">Voice Note Script — Hindi (Roman)</h2><pre>\${esc(b.hindiRoman)}</pre>
    \${b.hindiDevanagari ? "<h2>देवनागरी</h2><pre>" + esc(b.hindiDevanagari) + "</pre>" : ""}
    <h2>English Translation</h2><pre>\${esc(b.english)}</pre>\`;
  $("detail").scrollIntoView({ behavior: "smooth" });
}
async function generateToday() { await doGenerate({}); }
async function generateForDate() {
  const d = $("genDate").value;
  if (!d) return; await doGenerate({ date: d });
}
async function doGenerate(body) {
  $("genBtn").disabled = true;
  $("genStatus").textContent = "Generating (script → OpenAI translation → Swara audio)… ~1 min";
  try {
    const r = await api("/api/generate", { method: "POST", body: JSON.stringify(body) });
    $("genStatus").textContent = r.error ? r.error : (r.off ? r.reason : "Done: " + r.id);
    await refresh();
    if (r.id) openBrief(r.id);
  } catch (e) { $("genStatus").textContent = "Failed: " + e.message; }
  $("genBtn").disabled = false;
}
async function sendBrief(id) {
  $("sendStatus").textContent = "Sending…";
  const r = await api("/api/briefs/" + id + "/send", { method: "POST" });
  $("sendStatus").textContent = r.error ? ("failed — " + r.error) :
    "email: " + (r.email.ok ? "sent ✓" : r.email.skipped ? "skipped — " + r.email.detail : "failed — " + r.email.detail) +
    " · whatsapp: " + (r.whatsapp.ok ? "sent ✓" : r.whatsapp.skipped ? "skipped" : "failed — " + r.whatsapp.detail);
  refresh();
}
function esc(s) { return String(s||"").replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
api("/api/me").then(m => { if (m.readOnly) $("genCard").classList.add("hidden"); show(m.signedIn ? "app" : "login"); if (m.signedIn) refresh(); });
</script></body></html>`;
