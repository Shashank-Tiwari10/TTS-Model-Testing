// Local entrypoint: runs the console on port 3600 plus the optional Mon–Sat
// auto-scheduler. The Vercel entrypoint (api/index.js) uses createApp() alone.
//   npm run brief:server
import "./env.js";
import { createApp } from "./app.js";
import { istDateParts } from "./plan.js";
import { generateBrief } from "./generate.js";
import { deliverBrief } from "./notify.js";
import { getSettings } from "./settings.js";

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

createApp().listen(PORT, () => {
  console.log(`Zahab Daily Brief console → http://localhost:${PORT}`);
  console.log(`Login: ${ADMIN_EMAIL} / (password from .env ADMIN_PASSWORD)`);
});
