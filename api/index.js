// Vercel serverless entrypoint for the Zahab Daily Brief console.
// Env vars to set on Vercel: ADMIN_EMAIL, ADMIN_PASSWORD (login) and optionally
// SMTP_USER / SMTP_PASS / BRIEF_TO_EMAIL so the online "Send Now" button can email.
// Briefs are read from src/daily-brief/briefs/ — committed nightly by the GitHub Action.
import { createApp } from "../src/daily-brief/app.js";

export default createApp();
