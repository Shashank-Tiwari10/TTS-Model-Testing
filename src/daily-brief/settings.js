// TTS setup for the Zahab daily brief, editable from the Behalf console.
// Precedence: settings.json (console-managed, committed) > .env > hardcoded defaults.
// The nightly GitHub Action checks out the repo, so a saved + pushed settings.json
// changes the cloud runs too. On Vercel the filesystem is read-only — setup is view-only.
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SETTINGS_PATH = join(__dirname, "settings.json");

export const AZURE_VOICES = [
  { id: "hi-IN-SwaraNeural", label: "Swara — Female, Hindi (finalized)" },
  { id: "hi-IN-MadhurNeural", label: "Madhur — Male, Hindi" },
  { id: "en-IN-NeerjaNeural", label: "Neerja — Female, Indian English" },
  { id: "en-IN-PrabhatNeural", label: "Prabhat — Male, Indian English" },
];
export const TRANSLATE_MODELS = ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-4o", "gpt-4o-mini"];

function defaults() {
  return {
    voice: process.env.BRIEF_VOICE || "hi-IN-SwaraNeural",
    translateModel: process.env.BRIEF_TRANSLATE_MODEL || "gpt-5.6-terra",
    toEmail: process.env.BRIEF_TO_EMAIL || "mainshashanktiwari14@gmail.com",
    toPhone: process.env.BRIEF_TO_PHONE || "+919569598949",
    toEmail2: process.env.BRIEF_TO_EMAIL2 || "gajrajbudhprakash@gmail.com",
    toPhone2: process.env.BRIEF_TO_PHONE2 || "+916375320221",
    waApiKey: process.env.BRIEF_WA_APIKEY || "",
    waApiKey2: process.env.BRIEF_WA_APIKEY2 || "",
    localSendTime: process.env.BRIEF_SEND_TIME || "06:30",
  };
}

export function getSettings() {
  let file = {};
  try {
    if (existsSync(SETTINGS_PATH)) file = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
  } catch {}
  return { ...defaults(), ...file };
}

export function saveSettings(patch) {
  const allowed = ["voice", "translateModel", "toEmail", "toPhone", "waApiKey", "toEmail2", "toPhone2", "waApiKey2", "localSendTime"];
  const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k, v]) => allowed.includes(k) && typeof v === "string" && v.trim()));
  const next = { ...getSettings(), ...clean };
  writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
  return next;
}
