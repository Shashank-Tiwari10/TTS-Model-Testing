// Delivery for the daily Zahab brief:
//  - Email (nodemailer / SMTP): Hindi + English text with the Swara voice note attached.
//  - WhatsApp (CallMeBot free API): text only — each recipient registers once by messaging
//    +34 644 37 67 94 "I allow callmebot to send me messages" to get their API key.
// Both read credentials from .env / settings.json; missing credentials skip gracefully.
import nodemailer from "nodemailer";
import axios from "axios";
import { markSent } from "./generate.js";
import { getSettings } from "./settings.js";

function allEmails() {
  const s = getSettings();
  return [s.toEmail, s.toEmail2].filter(Boolean).join(", ");
}
function allRecipients() {
  const s = getSettings();
  return [
    { phone: s.toPhone, apiKey: s.waApiKey },
    { phone: s.toPhone2, apiKey: s.waApiKey2 },
  ].filter(r => r.phone && r.apiKey);
}
function makeTransporter() {
  const { SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "465"),
    secure: (process.env.SMTP_PORT || "465") === "465",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}
async function sendWhatsAppTo(phone, apiKey, body) {
  if (!phone || !apiKey) {
    return { ok: false, skipped: true, detail: `No CallMeBot API key for ${phone || "unknown"} — register by messaging +34 644 37 67 94` };
  }
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(body.slice(0, 1500))}&apikey=${encodeURIComponent(apiKey)}`;
    const resp = await axios.get(url, { timeout: 15000 });
    if (resp.status === 200) {
      return { ok: true, detail: `sent to ${phone} via CallMeBot` };
    }
    return { ok: false, detail: `CallMeBot returned ${resp.status}` };
  } catch (err) {
    return { ok: false, detail: err.response?.data || err.message };
  }
}

export async function sendEmail(brief) {
  const toAll = allEmails();
  const transporter = makeTransporter();
  if (!transporter) return { ok: false, skipped: true, detail: "SMTP_USER / SMTP_PASS not set in .env" };
  const subject = `Zahab House Cleaning Brief — ${brief.date} (Day ${brief.day}, ${brief.weekday})`;
  const html = `
    <div style="font-family:Georgia,serif;max-width:640px;margin:auto;color:#172554">
      <h2 style="font-weight:400">${brief.clientName} House · Daily Cleaning Brief</h2>
      <p style="color:#78716c">${brief.weekday}, ${brief.date} · Day ${brief.day} of 78 · Week ${brief.week} · ${brief.totalTasks} tasks · ~${brief.totalMinutes} min<br>
      Voice note attached (Azure ${brief.voice}). Translation: OpenAI ${brief.translateModel}.</p>
      <h3 style="border-bottom:1px solid #e7e5e4;padding-bottom:4px">Voice Note Script (Hindi)</h3>
      <p style="white-space:pre-wrap;line-height:1.6">${escapeHtml(brief.hindiRoman)}</p>
      ${brief.hindiDevanagari ? `<h3 style="border-bottom:1px solid #e7e5e4;padding-bottom:4px">देवनागरी</h3><p style="white-space:pre-wrap;line-height:1.7">${escapeHtml(brief.hindiDevanagari)}</p>` : ""}
      <h3 style="border-bottom:1px solid #e7e5e4;padding-bottom:4px">English Translation</h3>
      <p style="white-space:pre-wrap;line-height:1.6">${escapeHtml(brief.english)}</p>
    </div>`;
  try {
    const info = await transporter.sendMail({
      from: `"VarMC Daily Brief" <${process.env.SMTP_USER}>`,
      to: toAll,
      subject,
      html,
      attachments: [{ filename: `ZahabBrief_${brief.date}_Day${brief.day}.mp3`, path: brief.audioPath }],
    });
    return { ok: true, detail: `sent to ${toAll} (${info.messageId})` };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

export async function sendWhatsApp(brief) {
  const recipients = allRecipients();
  if (!recipients.length) return { ok: false, skipped: true, detail: "No phone+apikey pairs configured — register with CallMeBot first" };
  const body =
    `*${brief.clientName} House — Cleaning Brief*\n${brief.weekday}, ${brief.date} · Day ${brief.day} · ${brief.totalTasks} tasks\n\n` +
    `${brief.hindiRoman}\n\n— Voice note & English translation sent by email.`;
  const results = await Promise.all(recipients.map(r => sendWhatsAppTo(r.phone, r.apiKey, body)));
  const detail = recipients.map((r, i) => `${r.phone}: ${results[i].ok ? "sent" : results[i].detail}`).join("; ");
  return { ok: results.some(r => r.ok), detail };
}

export async function deliverBrief(brief) {
  const toAll = allEmails();
  const recipients = allRecipients();
  const email = await sendEmail(brief);
  const whatsapp = await sendWhatsApp(brief);
  const meta = markSent(brief.id, {
    email: { ...email, at: new Date().toISOString(), to: toAll },
    whatsapp: { ...whatsapp, at: new Date().toISOString(), to: recipients.map(r => r.phone).join(", ") },
  });
  return { email, whatsapp, meta };
}

export async function sendWorkReport({ date, weekday, day, week, clientName, done, notDone, totalMinutes }) {
  const toAll = allEmails();
  const transporter = makeTransporter();
  if (!transporter) return { ok: false, skipped: true, detail: "SMTP_USER / SMTP_PASS not set in .env" };
  const thStyle = 'text-align:left;padding:8px 10px';
  const tdStyle = 'padding:6px 10px';
  const doneRows = done.map(t => `<tr style="background:#f0fdf4"><td style="${tdStyle}">${escapeHtml(t.id || "")}</td><td style="${tdStyle}">${escapeHtml(t.spaceName)}</td><td style="${tdStyle}">${escapeHtml(t.object)}</td><td style="${tdStyle}">${escapeHtml(t.work)}</td><td style="${tdStyle}">${t.timeMinutes} min</td><td style="${tdStyle};color:#16a34a">✓ Done</td></tr>`).join("");
  const notDoneRows = notDone.map(t => `<tr style="background:#fef2f2"><td style="${tdStyle}">${escapeHtml(t.id || "")}</td><td style="${tdStyle}">${escapeHtml(t.spaceName)}</td><td style="${tdStyle}">${escapeHtml(t.object)}</td><td style="${tdStyle}">${escapeHtml(t.work)}</td><td style="${tdStyle}">${t.timeMinutes} min</td><td style="${tdStyle};color:#dc2626">✗ Not Done</td></tr>`).join("");
  const pct = (done.length + notDone.length) ? Math.round(done.length / (done.length + notDone.length) * 100) : 0;
  const subject = `Zahab House — Work Report · ${weekday}, ${date} (Day ${day}) · ${pct}% Done`;
  const html = `
    <div style="font-family:Georgia,serif;max-width:700px;margin:auto;color:#172554">
      <h1 style="font-weight:400;font-size:24px;margin-bottom:4px">${escapeHtml(clientName)} House · Daily Work Report</h1>
      <h2 style="font-weight:600;font-size:20px;color:#172554;margin-bottom:8px">${weekday}, ${date}</h2>
      <p style="color:#78716c;margin-bottom:12px">Day ${day} of 78 · Week ${week} · ~${totalMinutes} min total · Report generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
      <p><span style="background:#dcfce7;color:#14532d;padding:5px 14px;border-radius:999px;font-size:14px;font-weight:600">${done.length} Done (${pct}%)</span>
         <span style="background:#fee2e2;color:#991b1b;padding:5px 14px;border-radius:999px;font-size:14px;font-weight:600;margin-left:8px">${notDone.length} Not Done</span></p>
      ${done.length ? `<h3 style="border-bottom:1px solid #e7e5e4;padding-bottom:4px;margin-top:24px">✓ Work Done (${done.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="background:#f5f5f4"><th style="${thStyle}">ID</th><th style="${thStyle}">Space</th><th style="${thStyle}">Object</th><th style="${thStyle}">Work</th><th style="${thStyle}">Time</th><th style="${thStyle}">Status</th></tr>${doneRows}</table>` : ""}
      ${notDone.length ? `<h3 style="border-bottom:1px solid #e7e5e4;padding-bottom:4px;margin-top:24px">✗ Work Not Done (${notDone.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="background:#f5f5f4"><th style="${thStyle}">ID</th><th style="${thStyle}">Space</th><th style="${thStyle}">Object</th><th style="${thStyle}">Work</th><th style="${thStyle}">Time</th><th style="${thStyle}">Status</th></tr>${notDoneRows}</table>` : ""}
    </div>`;
  try {
    const info = await transporter.sendMail({
      from: `"VarMC Daily Brief" <${process.env.SMTP_USER}>`,
      to: toAll,
      subject,
      html,
    });
    return { ok: true, detail: `sent to ${toAll} (${info.messageId})` };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

export async function sendWorkReportWhatsApp({ date, weekday, day, clientName, done, notDone }) {
  const recipients = allRecipients();
  if (!recipients.length) return { ok: false, skipped: true, detail: "No phone+apikey pairs configured — register with CallMeBot first" };
  const waPct = (done.length + notDone.length) ? Math.round(done.length / (done.length + notDone.length) * 100) : 0;
  const doneList = done.length ? done.map(t => `  ✓ ${t.spaceName} — ${t.object}: ${t.work}`).join("\n") : "  (none)";
  const notDoneList = notDone.length ? notDone.map(t => `  ✗ ${t.spaceName} — ${t.object}: ${t.work}`).join("\n") : "  (none)";
  const body = `*${clientName} House — Work Report*\n*${weekday}, ${date}* · Day ${day} · ${waPct}% Done\n\n*Done (${done.length}):*\n${doneList}\n\n*Not Done (${notDone.length}):*\n${notDoneList}`;
  const results = await Promise.all(recipients.map(r => sendWhatsAppTo(r.phone, r.apiKey, body)));
  const detail = recipients.map((r, i) => `${r.phone}: ${results[i].ok ? "sent" : results[i].detail}`).join("; ");
  return { ok: results.some(r => r.ok), detail };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
