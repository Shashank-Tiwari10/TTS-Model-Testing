// Delivery for the daily Zahab brief:
//  - Email (nodemailer / SMTP): Hindi + English text with the Swara voice note attached.
//  - WhatsApp (optional, Twilio REST via axios): text only — Twilio needs a public media
//    URL for audio, so the voice note travels by email; WhatsApp carries the text brief.
// Both read credentials from .env; missing credentials skip that channel gracefully.
import nodemailer from "nodemailer";
import axios from "axios";
import { markSent } from "./generate.js";
import { getSettings } from "./settings.js";

export async function sendEmail(brief) {
  const TO_EMAIL = getSettings().toEmail;
  const { SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) {
    return { ok: false, skipped: true, detail: "SMTP_USER / SMTP_PASS not set in .env" };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "465"),
    secure: (process.env.SMTP_PORT || "465") === "465",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
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
      from: `"VarMC Daily Brief" <${SMTP_USER}>`,
      to: TO_EMAIL,
      subject,
      html,
      attachments: [{ filename: `ZahabBrief_${brief.date}_Day${brief.day}.mp3`, path: brief.audioPath }],
    });
    return { ok: true, detail: `sent to ${TO_EMAIL} (${info.messageId})` };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

export async function sendWhatsApp(brief) {
  const TO_PHONE = getSettings().toPhone;
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) {
    return { ok: false, skipped: true, detail: "Twilio credentials not set in .env — WhatsApp skipped" };
  }
  const body =
    `*${brief.clientName} House — Cleaning Brief*\n${brief.weekday}, ${brief.date} · Day ${brief.day} · ${brief.totalTasks} tasks\n\n` +
    `${brief.hindiRoman}\n\n— Voice note & English translation sent by email.`;
  try {
    const resp = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      new URLSearchParams({
        From: `whatsapp:${TWILIO_WHATSAPP_FROM}`,
        To: `whatsapp:${TO_PHONE}`,
        Body: body.slice(0, 1500),
      }),
      { auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN } }
    );
    return { ok: true, detail: `sent to ${TO_PHONE} (${resp.data.sid})` };
  } catch (err) {
    return { ok: false, detail: err.response?.data?.message || err.message };
  }
}

export async function deliverBrief(brief) {
  const { toEmail, toPhone } = getSettings();
  const email = await sendEmail(brief);
  const whatsapp = await sendWhatsApp(brief);
  const meta = markSent(brief.id, {
    email: { ...email, at: new Date().toISOString(), to: toEmail },
    whatsapp: { ...whatsapp, at: new Date().toISOString(), to: toPhone },
  });
  return { email, whatsapp, meta };
}

export async function sendWorkReport({ date, weekday, day, week, clientName, done, notDone, totalMinutes }) {
  const TO_EMAIL = getSettings().toEmail;
  const { SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) {
    return { ok: false, skipped: true, detail: "SMTP_USER / SMTP_PASS not set in .env" };
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "465"),
    secure: (process.env.SMTP_PORT || "465") === "465",
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const doneRows = done.map(t => `<tr style="background:#f0fdf4"><td style="padding:6px 10px">${escapeHtml(t.spaceName)}</td><td style="padding:6px 10px">${escapeHtml(t.object)}</td><td style="padding:6px 10px">${escapeHtml(t.work)}</td><td style="padding:6px 10px">${t.timeMinutes} min</td><td style="padding:6px 10px;color:#16a34a">✓ Done</td></tr>`).join("");
  const notDoneRows = notDone.map(t => `<tr style="background:#fef2f2"><td style="padding:6px 10px">${escapeHtml(t.spaceName)}</td><td style="padding:6px 10px">${escapeHtml(t.object)}</td><td style="padding:6px 10px">${escapeHtml(t.work)}</td><td style="padding:6px 10px">${t.timeMinutes} min</td><td style="padding:6px 10px;color:#dc2626">✗ Not Done</td></tr>`).join("");
  const subject = `Zahab House — Work Report · ${weekday}, ${date} (Day ${day})`;
  const html = `
    <div style="font-family:Georgia,serif;max-width:700px;margin:auto;color:#172554">
      <h2 style="font-weight:400">${escapeHtml(clientName)} House · Daily Work Report</h2>
      <p style="color:#78716c">${weekday}, ${date} · Day ${day} of 78 · Week ${week} · ~${totalMinutes} min total</p>
      <p><span style="background:#dcfce7;color:#14532d;padding:3px 10px;border-radius:999px;font-size:13px">${done.length} Done</span>
         <span style="background:#fee2e2;color:#991b1b;padding:3px 10px;border-radius:999px;font-size:13px;margin-left:6px">${notDone.length} Not Done</span></p>
      ${done.length ? `<h3 style="border-bottom:1px solid #e7e5e4;padding-bottom:4px;margin-top:20px">✓ Work Done (${done.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="background:#f5f5f4"><th style="text-align:left;padding:8px 10px">Space</th><th style="text-align:left;padding:8px 10px">Object</th><th style="text-align:left;padding:8px 10px">Work</th><th style="text-align:left;padding:8px 10px">Time</th><th style="text-align:left;padding:8px 10px">Status</th></tr>${doneRows}</table>` : ""}
      ${notDone.length ? `<h3 style="border-bottom:1px solid #e7e5e4;padding-bottom:4px;margin-top:20px">✗ Work Not Done (${notDone.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="background:#f5f5f4"><th style="text-align:left;padding:8px 10px">Space</th><th style="text-align:left;padding:8px 10px">Object</th><th style="text-align:left;padding:8px 10px">Work</th><th style="text-align:left;padding:8px 10px">Time</th><th style="text-align:left;padding:8px 10px">Status</th></tr>${notDoneRows}</table>` : ""}
    </div>`;
  try {
    const info = await transporter.sendMail({
      from: `"VarMC Daily Brief" <${SMTP_USER}>`,
      to: TO_EMAIL,
      subject,
      html,
    });
    return { ok: true, detail: `sent to ${TO_EMAIL} (${info.messageId})` };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}

export async function sendWorkReportWhatsApp({ date, weekday, day, clientName, done, notDone }) {
  const TO_PHONE = getSettings().toPhone;
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM) {
    return { ok: false, skipped: true, detail: "Twilio credentials not set in .env — WhatsApp skipped" };
  }
  const doneList = done.length ? done.map(t => `  ✓ ${t.spaceName} — ${t.object}: ${t.work}`).join("\n") : "  (none)";
  const notDoneList = notDone.length ? notDone.map(t => `  ✗ ${t.spaceName} — ${t.object}: ${t.work}`).join("\n") : "  (none)";
  const body = `*${clientName} House — Work Report*\n${weekday}, ${date} · Day ${day}\n\n*Done (${done.length}):*\n${doneList}\n\n*Not Done (${notDone.length}):*\n${notDoneList}`;
  try {
    const resp = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      new URLSearchParams({
        From: `whatsapp:${TWILIO_WHATSAPP_FROM}`,
        To: `whatsapp:${TO_PHONE}`,
        Body: body.slice(0, 1500),
      }),
      { auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN } }
    );
    return { ok: true, detail: `sent to ${TO_PHONE} (${resp.data.sid})` };
  } catch (err) {
    return { ok: false, detail: err.response?.data?.message || err.message };
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
