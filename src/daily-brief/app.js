// Zahab Daily Brief admin console — Express app, shared by:
//   - local:  src/daily-brief/server.js  (node, port 3600, full features)
//   - online: api/index.js on Vercel     (serverless, read-only briefs from the repo)
// Login: ADMIN_EMAIL / ADMIN_PASSWORD (defaults shashank@admin.com / royal2026).
// Auth cookie is a stateless HMAC of the admin credentials — serverless instances
// share no memory, so a session store cannot work there.
import "./env.js";
import express from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { istDateParts, scheduleForDate } from "./plan.js";
import { generateBrief, loadBrief, listBriefs, BRIEFS_DIR } from "./generate.js";
import { deliverBrief, sendWorkReport, sendWorkReportWhatsApp } from "./notify.js";
import { getSettings, saveSettings, AZURE_VOICES, TRANSLATE_MODELS } from "./settings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRESS_DIR = join(__dirname, "progress");

function loadProgress(date) {
  const p = join(PROGRESS_DIR, `${date}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function saveProgress(date, doneIds, notDoneIds) {
  mkdirSync(PROGRESS_DIR, { recursive: true });
  const data = { date, doneIds, notDoneIds, savedAt: new Date().toISOString() };
  writeFileSync(join(PROGRESS_DIR, `${date}.json`), JSON.stringify(data, null, 2));
  return data;
}

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

  // Zahab's daily working plan — the schedule tasks behind each brief (this client only).
  app.get("/api/plan", requireAuth, (req, res) => {
    const date = String(req.query.date || istDateParts().iso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    const sched = scheduleForDate(date);
    const prog = loadProgress(date);
    res.json({ ...sched, progress: prog ? { doneIds: prog.doneIds, notDoneIds: prog.notDoneIds, savedAt: prog.savedAt } : null });
  });

  // Load saved progress (tick marks) for a date.
  app.get("/api/plan/progress", requireAuth, (req, res) => {
    const date = String(req.query.date || istDateParts().iso);
    const prog = loadProgress(date);
    res.json(prog || { date, doneIds: [], notDoneIds: [] });
  });

  // Save work progress: split tasks into done / not-done.
  app.post("/api/plan/progress", requireAuth, (req, res) => {
    if (READ_ONLY) return res.status(400).json({ error: "Progress tracking is not available online. Use the local console." });
    const { date, doneIds, notDoneIds } = req.body || {};
    if (!date || !Array.isArray(doneIds) || !Array.isArray(notDoneIds)) {
      return res.status(400).json({ error: "date, doneIds[], and notDoneIds[] are required" });
    }
    res.json({ ok: true, progress: saveProgress(date, doneIds, notDoneIds) });
  });

  // Share work report via email + WhatsApp.
  app.post("/api/plan/share", requireAuth, async (req, res) => {
    const { date } = req.body || {};
    if (!date) return res.status(400).json({ error: "date is required" });
    const prog = loadProgress(date);
    if (!prog) return res.status(400).json({ error: "No saved progress for this date. Save progress first." });
    const sched = scheduleForDate(date);
    if (sched.off) return res.status(400).json({ error: sched.reason });
    const taskMap = new Map(sched.tasks.map(t => [t.id, t]));
    const done = (prog.doneIds || []).map(id => taskMap.get(id)).filter(Boolean);
    const notDone = (prog.notDoneIds || []).map(id => taskMap.get(id)).filter(Boolean);
    const report = { date, weekday: sched.weekday, day: sched.day, week: sched.week, clientName: sched.clientName, done, notDone, totalMinutes: sched.totalMinutes };
    const email = await sendWorkReport(report);
    const whatsapp = await sendWorkReportWhatsApp(report);
    res.json({ email, whatsapp });
  });

  // TTS setup — drives voice, translation model, recipients for every generation.
  app.get("/api/settings", requireAuth, (_req, res) =>
    res.json({ settings: getSettings(), voices: AZURE_VOICES, models: TRANSLATE_MODELS, readOnly: READ_ONLY }));
  app.post("/api/settings", requireAuth, (req, res) => {
    if (READ_ONLY) {
      return res.status(400).json({ error: "Setup is view-only online. Change it locally in the console (or edit src/daily-brief/settings.json) and push — the nightly run and this site pick it up." });
    }
    try {
      res.json({ ok: true, settings: saveSettings(req.body) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

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
<title>Behalf — Run Home on your behalf</title>
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
  .tab { background: #f5f5f4; color: #172554; margin-top: 0; }
  .tab.active { background: #172554; color: #fef3c7; }
  select { width: 100%; padding: 10px 12px; border: 1px solid #d6d3d1; border-radius: 10px; font-size: 14px; margin-top: 6px; background: #fff; }
  table.plan { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.plan th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #78716c; padding: 8px 10px; border-bottom: 1px solid #e7e5e4; }
  table.plan td { padding: 7px 10px; border-bottom: 1px solid #f5f5f4; vertical-align: top; }
  td.space-cell { font-weight: 600; color: #172554; background: #fafaf9; }
  .tick-cb { width: 18px; height: 18px; cursor: pointer; accent-color: #16a34a; }
  tr.done-row td { background: #f0fdf4; }
  .plan-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 16px; }
  .count-done { color: #16a34a; font-weight: 600; } .count-notdone { color: #dc2626; font-weight: 600; }
</style></head>
<body><div class="wrap">
  <div id="login" class="hidden">
    <div style="text-align:center;margin:40px 0 24px"><div class="crown">♛</div>
      <h1>Behalf</h1><div class="sub">Run Home on your behalf</div></div>
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
    <div class="row" style="margin-bottom:16px">
      <button class="tab active" id="tab-briefs" onclick="switchTab('briefs')">Briefs</button>
      <button class="tab" id="tab-plan" onclick="switchTab('plan')">Daily Working Plan</button>
      <button class="tab" id="tab-setup" onclick="switchTab('setup')">TTS Setup</button>
    </div>

    <div id="view-briefs">
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

    <div id="view-plan" class="hidden">
      <div class="card">
        <div class="row">
          <label style="margin-top:0">Date</label>
          <input id="planDate" type="date" style="width:auto;margin-top:0">
          <button class="ghost" style="margin-top:0" onclick="loadPlan()">Show Plan</button>
          <span id="planHead" class="sub"></span>
        </div>
      </div>
      <div class="card" id="planCard"><div class="sub">Pick a date to see Zahab and Rishabh's working plan for that day.</div></div>
    </div>

    <div id="view-setup" class="hidden">
      <div class="card">
        <h2>TTS Setup — Zahab's daily brief pipeline</h2>
        <div class="sub">These settings drive every generation: the working plan for the day is scripted in English, translated by the OpenAI model below, and spoken by the Azure voice below. Saved settings are used by the local console and, once pushed, by the nightly 8 PM IST GitHub run.</div>
        <label>Azure Voice (voice note)</label><select id="setVoice"></select>
        <label>OpenAI Translation Model</label><select id="setModel"></select>
        <label>Deliver to Email</label><input id="setEmail" type="email">
        <label>Deliver to WhatsApp Number</label><input id="setPhone" type="text">
        <label>Local Auto-Send Time (IST, Mon–Sat — only when the local server runs with BRIEF_AUTO_SEND=true; the cloud run is fixed at 20:00 IST in the GitHub workflow)</label><input id="setTime" type="text" placeholder="06:30">
        <div class="row"><button id="setSave" onclick="saveSetup()">Save Setup</button><span id="setStatus" class="sub"></span></div>
      </div>
    </div>
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

// --- Tabs ---
function switchTab(name) {
  for (const t of ["briefs","plan","setup"]) {
    $("view-" + t).classList.toggle("hidden", t !== name);
    $("tab-" + t).classList.toggle("active", t === name);
  }
  if (name === "plan" && !$("planDate").value) { $("planDate").value = new Date().toISOString().slice(0,10); loadPlan(); }
  if (name === "setup") loadSetup();
}

// --- Daily Working Plan (Zahab client only) ---
let currentPlan = null;
async function loadPlan() {
  const d = $("planDate").value;
  if (!d) return;
  $("planHead").textContent = "Loading…";
  const p = await api("/api/plan?date=" + d);
  if (p.off) {
    currentPlan = null;
    $("planHead").textContent = "";
    $("planCard").innerHTML = '<div class="sub">' + esc(p.reason) + '</div>';
    return;
  }
  currentPlan = p;
  const doneSet = new Set((p.progress?.doneIds || []).map(String));
  $("planHead").textContent = \`Day \${p.day} of 78 · \${p.weekday} · Week \${p.week} · \${p.tasks.length} tasks · ~\${p.totalMinutes} min\`;
  const bySpace = new Map();
  for (const t of p.tasks) {
    if (!bySpace.has(t.spaceName)) bySpace.set(t.spaceName, []);
    bySpace.get(t.spaceName).push(t);
  }
  let rows = "";
  for (const [space, tasks] of bySpace) {
    tasks.forEach((t, i) => {
      const checked = doneSet.has(String(t.id));
      rows += \`<tr class="\${checked ? "done-row" : ""}" id="row-\${t.id}">\${i === 0 ? \`<td class="space-cell" rowspan="\${tasks.length}">\${esc(space)}</td>\` : ""}
        <td>\${esc(t.object)}</td><td>\${esc(t.work)}</td><td>\${esc(t.phase)}</td>
        <td>\${t.freq === 1 ? "Daily" : "Every " + t.freq + " days"}</td><td>\${t.timeMinutes} min</td>
        <td><input type="checkbox" class="tick-cb" data-task-id="\${t.id}" \${checked ? "checked" : ""} onchange="tickChanged(this)"></td></tr>\`;
    });
  }
  $("planCard").innerHTML = \`<h2>\${esc(p.clientName)} — Working Plan · \${p.weekday}, \${p.date}</h2>
    <div style="overflow-x:auto"><table class="plan">
      <tr><th>Space</th><th>Object</th><th>Work</th><th>Phase</th><th>Frequency</th><th>Time</th><th>Done</th></tr>\${rows}</table></div>
    <div class="plan-actions">
      <span id="planCounts"></span>
      <button onclick="savePlanProgress()">Save Progress</button>
      <button class="ghost" onclick="sharePlanReport()">Share Report</button>
      <span id="planStatus" class="sub"></span>
    </div>\`;
  updatePlanCounts();
}
function tickChanged(cb) {
  const row = document.getElementById("row-" + cb.dataset.taskId);
  if (row) row.classList.toggle("done-row", cb.checked);
  updatePlanCounts();
}
function updatePlanCounts() {
  const all = document.querySelectorAll(".tick-cb");
  const done = [...all].filter(c => c.checked).length;
  const el = $("planCounts");
  if (el) el.innerHTML = \`<span class="count-done">✓ \${done} Done</span> · <span class="count-notdone">✗ \${all.length - done} Not Done</span>\`;
}
async function savePlanProgress() {
  if (!currentPlan) return;
  const all = document.querySelectorAll(".tick-cb");
  const doneIds = [], notDoneIds = [];
  all.forEach(cb => { (cb.checked ? doneIds : notDoneIds).push(cb.dataset.taskId); });
  $("planStatus").textContent = "Saving…";
  const r = await api("/api/plan/progress", { method: "POST", body: JSON.stringify({ date: currentPlan.date, doneIds, notDoneIds }) });
  $("planStatus").textContent = r.error ? r.error : \`Saved — \${doneIds.length} done, \${notDoneIds.length} not done.\`;
}
async function sharePlanReport() {
  if (!currentPlan) return;
  const all = document.querySelectorAll(".tick-cb");
  const hasUnsaved = !currentPlan.progress || [...all].some(cb => {
    const wasDone = (currentPlan.progress?.doneIds || []).includes(cb.dataset.taskId);
    return cb.checked !== wasDone;
  });
  if (hasUnsaved) {
    $("planStatus").textContent = "Saving progress first…";
    const doneIds = [], notDoneIds = [];
    all.forEach(cb => { (cb.checked ? doneIds : notDoneIds).push(cb.dataset.taskId); });
    await api("/api/plan/progress", { method: "POST", body: JSON.stringify({ date: currentPlan.date, doneIds, notDoneIds }) });
  }
  $("planStatus").textContent = "Sending report…";
  const r = await api("/api/plan/share", { method: "POST", body: JSON.stringify({ date: currentPlan.date }) });
  if (r.error) { $("planStatus").textContent = r.error; return; }
  $("planStatus").textContent =
    "Email: " + (r.email.ok ? "sent ✓" : r.email.skipped ? "skipped" : "failed — " + r.email.detail) +
    " · WhatsApp: " + (r.whatsapp.ok ? "sent ✓" : r.whatsapp.skipped ? "skipped" : "failed — " + r.whatsapp.detail);
}

// --- TTS Setup ---
async function loadSetup() {
  const r = await api("/api/settings");
  $("setVoice").innerHTML = r.voices.map(v => \`<option value="\${v.id}" \${v.id === r.settings.voice ? "selected" : ""}>\${esc(v.label)}</option>\`).join("");
  $("setModel").innerHTML = r.models.map(m => \`<option value="\${m}" \${m === r.settings.translateModel ? "selected" : ""}>\${m}</option>\`).join("");
  $("setEmail").value = r.settings.toEmail;
  $("setPhone").value = r.settings.toPhone;
  $("setTime").value = r.settings.localSendTime;
  if (r.readOnly) {
    $("setSave").classList.add("hidden");
    $("setStatus").textContent = "View-only online — change setup from the local console (or edit settings.json) and push; the nightly run and this site follow it.";
    for (const id of ["setVoice","setModel","setEmail","setPhone","setTime"]) $(id).disabled = true;
  }
}
async function saveSetup() {
  $("setStatus").textContent = "Saving…";
  const r = await api("/api/settings", { method: "POST", body: JSON.stringify({
    voice: $("setVoice").value, translateModel: $("setModel").value,
    toEmail: $("setEmail").value, toPhone: $("setPhone").value, localSendTime: $("setTime").value,
  })});
  $("setStatus").textContent = r.error ? r.error : "Saved — next generation uses this setup. Push to GitHub to apply it to the nightly cloud run too.";
}

api("/api/me").then(m => { if (m.readOnly) $("genCard").classList.add("hidden"); show(m.signedIn ? "app" : "login"); if (m.signedIn) refresh(); });
</script></body></html>`;
