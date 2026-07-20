// One-shot CLI: generate today's Zahab brief (IST) and deliver it.
//   npm run brief:today                    → today (skips Sundays)
//   npm run brief:today -- --date=2026-07-22
//   npm run brief:today -- --no-send       → generate only
//   npm run brief:today -- --force         → regenerate even if it exists
// Schedule daily on Windows (07:00 IST example):
//   schtasks /Create /SC DAILY /ST 07:00 /TN "ZahabDailyBrief" /TR "cmd /c cd /d \"E:\VarMC.ai\App_Development\TTS model testing\" && npm run brief:today"
import dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".env") });
import { istDateParts } from "./plan.js";
import { generateBrief } from "./generate.js";
import { deliverBrief } from "./notify.js";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const date = typeof args.date === "string" ? args.date : istDateParts().iso;

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
