// Zahab Daily Brief admin console — Express app, shared by:
//   - local:  src/daily-brief/server.js  (node, port 3600, full features)
//   - online: api/index.js on Vercel     (serverless, read-only briefs from the repo)
// Login: ADMIN_EMAIL / ADMIN_PASSWORD (defaults shashank@admin.com / royal2026).
// Auth cookie is a stateless HMAC of the admin credentials — serverless instances
// share no memory, so a session store cannot work there.
import "./env.js";
import express from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { istDateParts, scheduleForDate, allTasksWithIds, taskSchedule, dateForDay, loadPlan } from "./plan.js";
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

function saveProgress(date, doneIds, notDoneIds, extraDone) {
  mkdirSync(PROGRESS_DIR, { recursive: true });
  const data = { date, doneIds, notDoneIds, extraDone: extraDone || [], savedAt: new Date().toISOString() };
  writeFileSync(join(PROGRESS_DIR, `${date}.json`), JSON.stringify(data, null, 2));
  return data;
}

function loadAllProgress() {
  if (!existsSync(PROGRESS_DIR)) return {};
  const files = readdirSync(PROGRESS_DIR).filter(f => f.endsWith(".json"));
  const all = {};
  for (const f of files) {
    try { all[f.replace(".json", "")] = JSON.parse(readFileSync(join(PROGRESS_DIR, f), "utf8")); } catch {}
  }
  return all;
}

const ADMINS = [
  { email: (process.env.ADMIN_EMAIL || "shashank@admin.com").toLowerCase(), password: process.env.ADMIN_PASSWORD || "royal2026" },
  { email: "gajraj@admin.com", password: "royal2026" },
];
const READ_ONLY = Boolean(process.env.VERCEL);

function sessionToken(email, password) {
  return createHmac("sha256", `${email}|${password}`).update("zahab-brief-admin").digest("hex");
}
function matchAdmin(email, password) {
  const e = String(email).trim().toLowerCase();
  return ADMINS.find(a => a.email === e && a.password === password);
}
function isAuthed(req) {
  const m = /brief_session=([a-f0-9]{64})/.exec(req.headers.cookie || "");
  if (!m) return false;
  const got = Buffer.from(m[1], "hex");
  return ADMINS.some(a => {
    const want = Buffer.from(sessionToken(a.email, a.password), "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  });
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
    const admin = matchAdmin(email, password);
    if (admin) {
      res.setHeader("Set-Cookie", `brief_session=${sessionToken(admin.email, admin.password)}; HttpOnly; Path=/; Max-Age=604800`);
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
    res.json({ ...sched, progress: prog ? { doneIds: prog.doneIds, notDoneIds: prog.notDoneIds, extraDone: prog.extraDone || [], savedAt: prog.savedAt } : null });
  });

  // Load saved progress (tick marks) for a date.
  app.get("/api/plan/progress", requireAuth, (req, res) => {
    const date = String(req.query.date || istDateParts().iso);
    const prog = loadProgress(date);
    res.json(prog || { date, doneIds: [], notDoneIds: [] });
  });

  // Save work progress: split tasks into done / not-done + optional extra tasks.
  app.post("/api/plan/progress", requireAuth, (req, res) => {
    if (READ_ONLY) return res.status(400).json({ error: "Progress tracking is not available online. Use the local console." });
    const { date, doneIds, notDoneIds, extraDone } = req.body || {};
    if (!date || !Array.isArray(doneIds) || !Array.isArray(notDoneIds)) {
      return res.status(400).json({ error: "date, doneIds[], and notDoneIds[] are required" });
    }
    res.json({ ok: true, progress: saveProgress(date, doneIds, notDoneIds, extraDone) });
  });

  // Share work report via email + WhatsApp. Accepts doneIds/notDoneIds inline to avoid race conditions.
  app.post("/api/plan/share", requireAuth, async (req, res) => {
    const { date, doneIds, notDoneIds, extraDone } = req.body || {};
    if (!date) return res.status(400).json({ error: "date is required" });
    if (Array.isArray(doneIds) && Array.isArray(notDoneIds) && !READ_ONLY) {
      saveProgress(date, doneIds, notDoneIds, extraDone);
    }
    const sched = scheduleForDate(date);
    if (sched.off) return res.status(400).json({ error: sched.reason });
    const taskMap = new Map(sched.tasks.map(t => [t.id, t]));
    const useDoneIds = doneIds || [];
    const useNotDoneIds = notDoneIds || [];
    const done = useDoneIds.map(id => taskMap.get(id)).filter(Boolean);
    const notDone = useNotDoneIds.map(id => taskMap.get(id)).filter(Boolean);
    const report = { date, weekday: sched.weekday, day: sched.day, week: sched.week, clientName: sched.clientName, done, notDone, totalMinutes: sched.totalMinutes };
    const email = await sendWorkReport(report);
    const whatsapp = await sendWorkReportWhatsApp(report);
    res.json({ email, whatsapp });
  });

  // Tracking: per-task compliance across all recorded days.
  app.get("/api/tracking", requireAuth, (_req, res) => {
    const tasks = allTasksWithIds();
    const sched = taskSchedule();
    const allProg = loadAllProgress();
    const plan = loadPlan();
    const anchor = plan.quarterAnchor;
    const todayIso = istDateParts().iso;
    const result = tasks.map(t => {
      const assignments = (sched.get(t.id) || []).filter(a => a.date <= todayIso);
      let doneCount = 0, doneOnDates = [];
      for (const a of assignments) {
        const prog = allProg[a.date];
        if (prog && prog.doneIds?.includes(t.id)) { doneCount++; doneOnDates.push(a.date); }
      }
      for (const [date, prog] of Object.entries(allProg)) {
        if (prog.extraDone?.includes(t.id) && !doneOnDates.includes(date)) {
          doneCount++; doneOnDates.push(date);
        }
      }
      const scheduled = assignments.length;
      const compliance = scheduled ? Math.round(doneCount / scheduled * 100) : null;
      const lastDone = doneOnDates.sort().pop() || null;
      return { id: t.id, spaceName: t.spaceName, object: t.object, work: t.work, freq: t.freq, phase: t.phase,
               scheduled, doneCount, compliance, lastDone, status: compliance === null ? "upcoming" : compliance >= 80 ? "on-track" : compliance >= 50 ? "partial" : "behind" };
    });
    res.json({ anchor, today: todayIso, tasks: result });
  });

  // All tasks (for extra-task picker).
  app.get("/api/plan/all-tasks", requireAuth, (_req, res) => {
    const tasks = allTasksWithIds();
    res.json(tasks.map(t => ({ id: t.id, spaceName: t.spaceName, object: t.object, work: t.work, freq: t.freq, phase: t.phase, timeMinutes: t.timeMinutes })));
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
  .seg-charts { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 18px; }
  .seg-chart { flex: 1; min-width: 260px; }
  .seg-label { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #78716c; margin-bottom: 6px; }
  .seg-bar-bg { height: 28px; background: #fee2e2; border-radius: 999px; overflow: hidden; position: relative; }
  .seg-bar-fill { height: 100%; background: #bbf7d0; border-radius: 999px 0 0 999px; transition: width .3s ease; }
  .seg-bar-fill.full { border-radius: 999px; }
  .seg-nums { font-size: 13px; margin-top: 5px; }
  .seg-nums .done { color: #16a34a; font-weight: 600; } .seg-nums .notdone { color: #dc2626; font-weight: 600; }
  .seg-pct { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 11px; font-weight: 700; color: #172554; }
  .extra-section { margin-top: 18px; padding-top: 14px; border-top: 1px solid #e7e5e4; }
  .extra-section h3 { font-weight: 400; font-size: 15px; margin-bottom: 8px; }
  .extra-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .extra-pill { font-size: 12px; padding: 4px 10px; border-radius: 999px; background: #ede9fe; color: #5b21b6; cursor: pointer; }
  .extra-pill.active { background: #c4b5fd; }
  .extra-search { width: 100%; padding: 8px 12px; border: 1px solid #d6d3d1; border-radius: 10px; font-size: 13px; margin-top: 6px; }
  .extra-list { max-height: 200px; overflow-y: auto; margin-top: 6px; border: 1px solid #e7e5e4; border-radius: 10px; }
  .extra-item { padding: 6px 12px; font-size: 12px; cursor: pointer; border-bottom: 1px solid #f5f5f4; display: flex; justify-content: space-between; }
  .extra-item:hover { background: #fafaf9; }
  .extra-item.picked { background: #f0fdf4; }
  .track-status { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
  .track-status.on-track { background: #16a34a; } .track-status.partial { background: #f59e0b; }
  .track-status.behind { background: #dc2626; } .track-status.upcoming { background: #d6d3d1; }
  .track-bar { height: 8px; background: #fee2e2; border-radius: 999px; overflow: hidden; width: 80px; display: inline-block; vertical-align: middle; }
  .track-fill { height: 100%; background: #bbf7d0; border-radius: 999px; }
  .freq-group { margin-bottom: 20px; }
  .freq-group h3 { font-weight: 400; font-size: 15px; margin-bottom: 6px; border-bottom: 1px solid #e7e5e4; padding-bottom: 4px; }
  table.track { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.track th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #78716c; padding: 6px 8px; border-bottom: 1px solid #e7e5e4; }
  table.track td { padding: 5px 8px; border-bottom: 1px solid #f5f5f4; }
  .track-summary { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
  .track-stat { text-align: center; }
  .track-stat .num { font-size: 28px; font-weight: 600; } .track-stat .lbl { font-size: 11px; color: #78716c; text-transform: uppercase; letter-spacing: .08em; }
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
      <button class="tab" id="tab-tracking" onclick="switchTab('tracking')">Tracking</button>
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

    <div id="view-tracking" class="hidden">
      <div class="card">
        <h2>Work Tracking — Frequency Compliance</h2>
        <div class="sub">Shows whether each task was completed on its assigned days. Tasks done on other days (via "Add Extra Task") count toward compliance.</div>
        <div id="trackContent" style="margin-top:16px"><div class="sub">Loading…</div></div>
      </div>
    </div>

    <div id="view-setup" class="hidden">
      <div class="card">
        <h2>TTS Setup — Zahab's daily brief pipeline</h2>
        <div class="sub">These settings drive every generation: the working plan for the day is scripted in English, translated by the OpenAI model below, and spoken by the Azure voice below. Saved settings are used by the local console and, once pushed, by the nightly 8 PM IST GitHub run.</div>
        <label>Azure Voice (voice note)</label><select id="setVoice"></select>
        <label>OpenAI Translation Model</label><select id="setModel"></select>
        <h2 style="margin-top:20px">Recipients</h2>
        <div class="sub">Briefs and work reports are sent to all recipients below. WhatsApp uses CallMeBot — each recipient must register once: add +34 644 37 67 94 to contacts, send "I allow callmebot to send me messages", then paste the API key here.</div>
        <label>Recipient 1 — Email</label><input id="setEmail" type="email">
        <label>Recipient 1 — WhatsApp Number</label><input id="setPhone" type="text">
        <label>Recipient 1 — CallMeBot API Key</label><input id="setWaKey" type="text" placeholder="Get from CallMeBot after registration">
        <label>Recipient 2 — Email</label><input id="setEmail2" type="email">
        <label>Recipient 2 — WhatsApp Number</label><input id="setPhone2" type="text">
        <label>Recipient 2 — CallMeBot API Key</label><input id="setWaKey2" type="text" placeholder="Get from CallMeBot after registration">
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
  for (const t of ["briefs","plan","tracking","setup"]) {
    $("view-" + t).classList.toggle("hidden", t !== name);
    $("tab-" + t).classList.toggle("active", t === name);
  }
  if (name === "plan" && !$("planDate").value) { $("planDate").value = new Date().toISOString().slice(0,10); loadPlan(); }
  if (name === "tracking") loadTracking();
  if (name === "setup") loadSetup();
}

// --- Daily Working Plan (Zahab client only) ---
let currentPlan = null;
let isReadOnly = false;
let currentExtraDone = new Set();
let allTasksCache = null;
function lsKey(date) { return "zahab_progress_" + date; }
function lsSave(date, doneIds, notDoneIds, extraDone) {
  localStorage.setItem(lsKey(date), JSON.stringify({ date, doneIds, notDoneIds, extraDone: extraDone || [], savedAt: new Date().toISOString() }));
}
function lsLoad(date) {
  try { return JSON.parse(localStorage.getItem(lsKey(date))); } catch { return null; }
}
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
  const localProg = isReadOnly ? lsLoad(p.date) : null;
  const progSource = localProg || p.progress;
  const doneSet = new Set((progSource?.doneIds || []).map(String));
  currentExtraDone = new Set((progSource?.extraDone || []).map(String));
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
    <div id="segCharts" class="seg-charts"></div>
    <div class="extra-section">
      <h3>Extra Tasks Done Today (not assigned for this day)</h3>
      <div class="sub">Tick tasks from other days that were completed today — they count toward tracking compliance.</div>
      <input class="extra-search" id="extraSearch" placeholder="Search by space, object, or work…" oninput="filterExtraTasks()">
      <div id="extraList" class="extra-list hidden"></div>
      <div id="extraPicked" class="extra-pills"></div>
    </div>
    <div class="plan-actions">
      <span id="planCounts"></span>
      <button onclick="savePlanProgress()">Save Progress</button>
      <button class="ghost" onclick="sharePlanReport()">Share Report</button>
      <span id="planStatus" class="sub"></span>
    </div>\`;
  updatePlanCounts();
  loadExtraTasks().then(() => renderExtraPicked());
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
  renderSegCharts();
}
function renderSegCharts() {
  if (!currentPlan) return;
  const cbs = document.querySelectorAll(".tick-cb");
  const taskMap = new Map(currentPlan.tasks.map(t => [String(t.id), t]));
  let r = { done: 0, total: 0 }, d = { done: 0, total: 0 };
  cbs.forEach(cb => {
    const t = taskMap.get(cb.dataset.taskId);
    if (!t) return;
    const bucket = (t.freq <= 6) ? r : d;
    bucket.total++;
    if (cb.checked) bucket.done++;
  });
  function bar(label, b) {
    const pct = b.total ? Math.round(b.done / b.total * 100) : 0;
    return \`<div class="seg-chart">
      <div class="seg-label">\${label}</div>
      <div class="seg-bar-bg"><div class="seg-bar-fill \${pct===100?'full':''}" style="width:\${pct}%"></div><span class="seg-pct">\${pct}%</span></div>
      <div class="seg-nums"><span class="done">✓ \${b.done}</span> / \${b.total} done · <span class="notdone">✗ \${b.total - b.done} missed</span></div>
    </div>\`;
  }
  const el = $("segCharts");
  if (el) el.innerHTML = bar("Routine (daily – every 6 days)", r) + bar("Deep Clean (every 12+ days)", d);
}
function gatherProgress() {
  const all = document.querySelectorAll(".tick-cb");
  const doneIds = [], notDoneIds = [];
  all.forEach(cb => { (cb.checked ? doneIds : notDoneIds).push(cb.dataset.taskId); });
  return { doneIds, notDoneIds, extraDone: [...currentExtraDone] };
}
async function savePlanProgress() {
  if (!currentPlan) return;
  const { doneIds, notDoneIds, extraDone } = gatherProgress();
  $("planStatus").textContent = "Saving…";
  if (isReadOnly) {
    lsSave(currentPlan.date, doneIds, notDoneIds, extraDone);
    $("planStatus").textContent = \`Saved locally — \${doneIds.length} done, \${notDoneIds.length} not done\${extraDone.length ? ", " + extraDone.length + " extra" : ""}.\`;
  } else {
    const r = await api("/api/plan/progress", { method: "POST", body: JSON.stringify({ date: currentPlan.date, doneIds, notDoneIds, extraDone }) });
    $("planStatus").textContent = r.error ? r.error : \`Saved — \${doneIds.length} done, \${notDoneIds.length} not done\${extraDone.length ? ", " + extraDone.length + " extra" : ""}.\`;
  }
}
async function sharePlanReport() {
  if (!currentPlan) return;
  const { doneIds, notDoneIds, extraDone } = gatherProgress();
  $("planStatus").textContent = "Saving & sending report…";
  const r = await api("/api/plan/share", { method: "POST", body: JSON.stringify({ date: currentPlan.date, doneIds, notDoneIds, extraDone }) });
  if (r.error) { $("planStatus").textContent = r.error; return; }
  currentPlan.progress = { doneIds, notDoneIds };
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
  $("setWaKey").value = r.settings.waApiKey || "";
  $("setEmail2").value = r.settings.toEmail2 || "";
  $("setPhone2").value = r.settings.toPhone2 || "";
  $("setWaKey2").value = r.settings.waApiKey2 || "";
  $("setTime").value = r.settings.localSendTime;
  if (r.readOnly) {
    $("setSave").classList.add("hidden");
    $("setStatus").textContent = "View-only online — change setup from the local console (or edit settings.json) and push; the nightly run and this site follow it.";
    for (const id of ["setVoice","setModel","setEmail","setPhone","setWaKey","setEmail2","setPhone2","setWaKey2","setTime"]) $(id).disabled = true;
  }
}
async function saveSetup() {
  $("setStatus").textContent = "Saving…";
  const r = await api("/api/settings", { method: "POST", body: JSON.stringify({
    voice: $("setVoice").value, translateModel: $("setModel").value,
    toEmail: $("setEmail").value, toPhone: $("setPhone").value, waApiKey: $("setWaKey").value,
    toEmail2: $("setEmail2").value, toPhone2: $("setPhone2").value, waApiKey2: $("setWaKey2").value,
    localSendTime: $("setTime").value,
  })});
  $("setStatus").textContent = r.error ? r.error : "Saved — next generation uses this setup. Push to GitHub to apply it to the nightly cloud run too.";
}

// --- Extra-task picker ---
async function loadExtraTasks() {
  if (!allTasksCache) allTasksCache = await api("/api/plan/all-tasks");
}
function renderExtraPicked() {
  const el = $("extraPicked");
  if (!el) return;
  if (!currentExtraDone.size) { el.innerHTML = '<span class="sub">No extra tasks added.</span>'; return; }
  el.innerHTML = [...currentExtraDone].map(id => {
    const t = allTasksCache?.find(x => x.id === id);
    const label = t ? \`\${t.spaceName} — \${t.object}: \${t.work}\` : id;
    return \`<span class="extra-pill active" onclick="removeExtra('\${id}')">\${esc(label)} ✕</span>\`;
  }).join("");
}
function removeExtra(id) { currentExtraDone.delete(id); renderExtraPicked(); }
async function filterExtraTasks() {
  await loadExtraTasks();
  const q = ($("extraSearch")?.value || "").toLowerCase().trim();
  const el = $("extraList");
  if (!q || q.length < 2) { el.classList.add("hidden"); return; }
  const assignedIds = new Set((currentPlan?.tasks || []).map(t => t.id));
  const matches = allTasksCache.filter(t => !assignedIds.has(t.id) && !currentExtraDone.has(t.id) &&
    (t.spaceName + " " + t.object + " " + t.work).toLowerCase().includes(q)).slice(0, 15);
  if (!matches.length) { el.innerHTML = '<div class="extra-item">No matching tasks.</div>'; el.classList.remove("hidden"); return; }
  el.innerHTML = matches.map(t =>
    \`<div class="extra-item" onclick="pickExtra('\${t.id}')"><span>\${esc(t.spaceName)} — \${esc(t.object)}: \${esc(t.work)}</span><span class="sub">Every \${t.freq}d · \${t.timeMinutes}m</span></div>\`
  ).join("");
  el.classList.remove("hidden");
}
function pickExtra(id) {
  currentExtraDone.add(id);
  $("extraSearch").value = "";
  $("extraList").classList.add("hidden");
  renderExtraPicked();
}

// --- Tracking page ---
async function loadTracking() {
  $("trackContent").innerHTML = '<div class="sub">Loading tracking data…</div>';
  const data = await api("/api/tracking");
  if (data.error) { $("trackContent").innerHTML = '<div class="err">' + esc(data.error) + '</div>'; return; }
  const tasks = data.tasks.filter(t => t.scheduled > 0);
  const onTrack = tasks.filter(t => t.status === "on-track").length;
  const partial = tasks.filter(t => t.status === "partial").length;
  const behind = tasks.filter(t => t.status === "behind").length;
  const totalSched = tasks.reduce((s, t) => s + t.scheduled, 0);
  const totalDone = tasks.reduce((s, t) => s + t.doneCount, 0);
  const overallPct = totalSched ? Math.round(totalDone / totalSched * 100) : 0;

  const routineTasks = tasks.filter(t => t.freq <= 6);
  const deepTasks = tasks.filter(t => t.freq > 6);
  const rSched = routineTasks.reduce((s, t) => s + t.scheduled, 0);
  const rDone = routineTasks.reduce((s, t) => s + t.doneCount, 0);
  const dSched = deepTasks.reduce((s, t) => s + t.scheduled, 0);
  const dDone = deepTasks.reduce((s, t) => s + t.doneCount, 0);
  const rPct = rSched ? Math.round(rDone / rSched * 100) : 0;
  const dPct = dSched ? Math.round(dDone / dSched * 100) : 0;

  function segBar(label, done, sched, pct) {
    return \`<div class="seg-chart"><div class="seg-label">\${label}</div>
      <div class="seg-bar-bg"><div class="seg-bar-fill \${pct===100?'full':''}" style="width:\${pct}%"></div><span class="seg-pct">\${pct}%</span></div>
      <div class="seg-nums"><span class="done">✓ \${done}</span> / \${sched} instances done</div></div>\`;
  }

  const freqGroups = new Map();
  for (const t of tasks) {
    const key = t.freq <= 6 ? "Routine (daily – every 6 days)" : "Deep Clean (every " + t.freq + " days)";
    if (!freqGroups.has(key)) freqGroups.set(key, []);
    freqGroups.get(key).push(t);
  }

  let groupsHtml = "";
  for (const [label, grp] of freqGroups) {
    const rows = grp.map(t => {
      const pct = t.compliance ?? 0;
      return \`<tr>
        <td><span class="track-status \${t.status}"></span>\${esc(t.spaceName)}</td>
        <td>\${esc(t.object)}</td><td>\${esc(t.work)}</td>
        <td>Every \${t.freq}d</td>
        <td>\${t.doneCount}/\${t.scheduled}</td>
        <td><div class="track-bar"><div class="track-fill" style="width:\${pct}%"></div></div> \${pct}%</td>
        <td>\${t.lastDone || "—"}</td></tr>\`;
    }).join("");
    groupsHtml += \`<div class="freq-group"><h3>\${label} (\${grp.length} tasks)</h3>
      <div style="overflow-x:auto"><table class="track">
        <tr><th>Space</th><th>Object</th><th>Work</th><th>Freq</th><th>Done</th><th>Compliance</th><th>Last Done</th></tr>
        \${rows}</table></div></div>\`;
  }

  $("trackContent").innerHTML = \`
    <div class="track-summary">
      <div class="track-stat"><div class="num" style="color:#172554">\${overallPct}%</div><div class="lbl">Overall</div></div>
      <div class="track-stat"><div class="num" style="color:#16a34a">\${onTrack}</div><div class="lbl">On Track</div></div>
      <div class="track-stat"><div class="num" style="color:#f59e0b">\${partial}</div><div class="lbl">Partial</div></div>
      <div class="track-stat"><div class="num" style="color:#dc2626">\${behind}</div><div class="lbl">Behind</div></div>
    </div>
    <div class="seg-charts" style="margin-bottom:20px">
      \${segBar("Routine (≤ 6 day cycle)", rDone, rSched, rPct)}
      \${segBar("Deep Clean (> 6 day cycle)", dDone, dSched, dPct)}
    </div>
    \${groupsHtml}\`;
}

api("/api/me").then(m => { isReadOnly = !!m.readOnly; if (m.readOnly) $("genCard").classList.add("hidden"); show(m.signedIn ? "app" : "login"); if (m.signedIn) refresh(); });
</script></body></html>`;
