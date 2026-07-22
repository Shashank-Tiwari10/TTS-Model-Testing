// Local entrypoint: runs the console on port 3600 plus the optional Mon–Sat
// auto-scheduler. The Vercel entrypoint (api/index.js) uses createApp() alone.
//   npm run brief:server
import "./env.js";
import { createApp } from "./app.js";
import { istDateParts } from "./plan.js";
import { generateBrief } from "./generate.js";
import { deliverBrief, sendWorkReport, sendWorkReportWhatsApp } from "./notify.js";
import { getSettings } from "./settings.js";
import { scheduleForDate } from "./plan.js";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirnameSrv = dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.BRIEF_PORT || "3600");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "shashank@admin.com";

// Auto-scheduler (BRIEF_AUTO_SEND=true): Mon–Sat at BRIEF_SEND_TIME IST while running.
// Normally OFF — the GitHub Actions workflow (20:00 IST, next-day brief) owns delivery.
const autoSentDates = new Set();
if (String(process.env.BRIEF_AUTO_SEND).toLowerCase() === "true") {
  console.log(`[auto] enabled — will generate+send Mon–Sat at ${getSettings().localSendTime} IST`);
  setInterval(async () => {
    const now = istDateParts();
    if (now.weekday === "Sun" || now.hhmm !== getSettings().localSendTime || autoSentDates.has(now.iso)) return;
    autoSentDates.add(now.iso);
    try {
      const brief = await generateBrief(now.iso);
      if (brief.off) return console.log(`[auto] ${now.iso}: ${brief.reason}`);
      const { email, whatsapp } = await deliverBrief(brief);
      console.log(`[auto] ${brief.id} — email ${email.ok ? "OK" : email.detail}; whatsapp ${whatsapp.ok ? "OK" : whatsapp.detail}`);
    } catch (err) {
      console.error(`[auto] failed: ${err.message}`);
    }
  }, 30000);
}

// Daily work report at 18:00 IST — sends yesterday's progress report.
const reportSentDates = new Set();
setInterval(async () => {
  const now = istDateParts();
  if (now.hhmm !== "18:00" || reportSentDates.has(now.iso)) return;
  reportSentDates.add(now.iso);
  const yesterday = new Date(Date.now() - 86400000);
  const yIso = yesterday.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const progPath = join(__dirnameSrv, "progress", `${yIso}.json`);
  if (!existsSync(progPath)) { console.log(`[report] no progress for ${yIso}, skipping`); return; }
  try {
    const prog = JSON.parse(readFileSync(progPath, "utf8"));
    const sched = scheduleForDate(yIso);
    if (sched.off) { console.log(`[report] ${yIso}: ${sched.reason}`); return; }
    const taskMap = new Map(sched.tasks.map(t => [t.id, t]));
    const done = (prog.doneIds || []).map(id => taskMap.get(id)).filter(Boolean);
    const notDone = (prog.notDoneIds || []).map(id => taskMap.get(id)).filter(Boolean);
    const report = { date: yIso, weekday: sched.weekday, day: sched.day, week: sched.week, clientName: sched.clientName, done, notDone, totalMinutes: sched.totalMinutes };
    const email = await sendWorkReport(report);
    const whatsapp = await sendWorkReportWhatsApp(report);
    console.log(`[report] ${yIso} — email ${email.ok ? "OK" : email.detail}; whatsapp ${whatsapp.ok ? "OK" : whatsapp.detail}`);
  } catch (err) {
    console.error(`[report] failed for ${yIso}: ${err.message}`);
  }
}, 30000);

createApp().listen(PORT, () => {
  console.log(`Zahab Daily Brief console → http://localhost:${PORT}`);
  console.log(`[report] auto work-report enabled — sends yesterday's report at 18:00 IST daily`);
  console.log(`Login: ${ADMIN_EMAIL} / (password from .env ADMIN_PASSWORD)`);
});
