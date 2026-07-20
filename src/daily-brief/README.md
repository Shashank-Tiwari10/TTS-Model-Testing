# Zahab Daily Cleaning Brief

Daily voice-note + translation system for the **Zahab and Rishabh** client only (no other
client is wired in). Every working day (Mon–Sat) it takes that day's tasks from the
13-week cleaning schedule and produces:

- **Hindi voice note** — Azure Neural TTS, voice `hi-IN-SwaraNeural` ("Swara"), in the
  finalized warm owner-to-helper register (see `../voice-command/voice-command-script-SKILL.md`)
- **Hindi text** — Khadiboli Roman + Devanagari, translated by OpenAI
  (`BRIEF_TRANSLATE_MODEL`, default `gpt-5.6-terra`, falls back to `gpt-4o`)
- **English translation** — the structured English voice-message script

and delivers them by **email** to `mainshashanktiwari14@gmail.com` (voice note attached)
and, when Twilio credentials are present, by **WhatsApp** to `+91 95695 98949` (text only —
WhatsApp media needs a public URL, so the audio travels by email).

## Commands

| Command | What it does |
| --- | --- |
| `npm run brief:import` | Re-import the schedule workbook → `zahab-plan.json` (pass a path to use a different file) |
| `npm run brief:today` | Generate **and send** today's brief (add `-- --no-send` to only generate, `-- --date=YYYY-MM-DD` for a specific day) |
| `npm run brief:server` | Admin console at <http://localhost:3600> + auto-scheduler |

## Admin console

`npm run brief:server` → <http://localhost:3600> — login **shashank@admin.com / royal2026**
(`ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`). Lists every brief with the voice-note player,
Hindi (Roman + Devanagari) and English text, delivery status, and Generate / Send buttons.

While the server runs with `BRIEF_AUTO_SEND=true`, it auto-generates and emails the brief
every **Mon–Sat at `BRIEF_SEND_TIME` (default 06:30 IST)**. Sundays are the weekly off — no
brief. Alternative without keeping the server up (Windows Task Scheduler, daily 07:00):

```
schtasks /Create /SC DAILY /ST 07:00 /TN "ZahabDailyBrief" /TR "cmd /c cd /d \"E:\VarMC.ai\App_Development\TTS model testing\" && npm run brief:today"
```

## One-time setup still needed

1. **Email**: create a Gmail **App Password** (Google Account → Security → 2-Step
   Verification → App passwords) for the sending account and fill `SMTP_USER` /
   `SMTP_PASS` in `.env`. Until then email reports "skipped".
2. **WhatsApp (optional)**: fill `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` /
   `TWILIO_WHATSAPP_FROM` in `.env`. Left empty, WhatsApp is skipped gracefully.
3. `AZURE_SPEECH_KEY` / `AZURE_SPEECH_REGION` and `OPENAI_API_KEY` are already used from `.env`.

## How a brief is built

`zahab-plan.json` (imported from *Zahabh & Rishabh House Schedule Work.xlsx* — 538 tasks,
78-day tick grid, Day 1 = Mon 2026-06-01, cycle repeats after Day 78) → today's date (IST)
maps to Day N → `command-generator.js` builds the English script → `translator.js` (OpenAI)
converts to polite Khadiboli Roman + Devanagari → `azure-tts.js` synthesizes the Swara
voice note in chunks → saved under `briefs/<date>_day-<NN>/` → `notify.js` emails it.
