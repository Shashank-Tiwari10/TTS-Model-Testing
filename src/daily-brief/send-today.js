// One-shot CLI: generate a Zahab brief (IST) and deliver it.
//   npm run brief:today                    → today (skips Sundays)
//   npm run brief:today -- --tomorrow      → next day's brief (evening-before delivery)
//   npm run brief:today -- --date=2026-07-22
//   npm run brief:today -- --no-send       → generate only
//   npm run brief:today -- --force         → regenerate even if it exists
// Exit codes: 0 = sent or nothing due; 1 = email delivery FAILED (so CI marks the run red).
// Schedule daily on Windows (07:00 IST example):
//   schtasks /Create /SC DAILY /ST 07:00 /TN "ZahabDailyBrief" /TR "cmd /c cd /d \"E:\VarMC.ai\App_Development\TTS model testing\" && npm run brief:today"
import "./env.js";
import { istDateParts } from "./plan.js";
import { generateBrief } from "./generate.js";
import { deliverBrief } from "./notify.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

function shiftIso(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const date = typeof args.date === "string"
  ? args.date
  : args.tomorrow
    ? shiftIso(istDateParts().iso, 1)
    : istDateParts().iso;

const brief = await generateBrief(date, { force: Boolean(args.force) });
if (brief.off) {
  console.log(`[brief] ${date}: ${brief.reason}. Nothing to send.`);
  process.exit(0);
}
console.log(`[brief] ready: ${brief.id} — ${brief.totalTasks} tasks, audio ${Math.round(brief.audioBytes / 1024)} KB`);

if (args["no-send"]) {
  console.log("[brief] --no-send: skipping delivery.");
  process.exit(0);
}
const { email, whatsapp } = await deliverBrief(brief);
console.log(`[brief] email: ${email.ok ? "OK" : email.skipped ? "SKIPPED" : "FAILED"} — ${email.detail}`);
console.log(`[brief] whatsapp: ${whatsapp.ok ? "OK" : whatsapp.skipped ? "SKIPPED" : "FAILED"} — ${whatsapp.detail}`);
if (!email.ok && !email.skipped) process.exit(1);
