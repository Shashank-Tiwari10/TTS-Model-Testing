// Builds one day's brief for the Zahab client: English voice-message script (existing
// command-generator), Khadiboli Roman + Devanagari Hindi (OpenAI), and the voice note
// (Azure Neural TTS, hi-IN-SwaraNeural — the finalized "Swara" voice).
// Output: src/daily-brief/briefs/<date>_day-<NN>/ {english.txt, hindi-roman.txt,
// hindi-devanagari.txt, brief.mp3, meta.json}
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { generateEnglishScript } from "../voice-command/command-generator.js";
import { translateToKhadiboliRoman, translateToDevanagari } from "../voice-command/translator.js";
import * as azure from "../providers/azure-tts.js";
import { scheduleForDate } from "./plan.js";
import { getSettings } from "./settings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const BRIEFS_DIR = join(__dirname, "briefs");

export function briefId(sched) {
  return `${sched.date}_day-${String(sched.day).padStart(2, "0")}`;
}

// Section markers like "--- DRY WORK ---" are internal; never spoken or emailed.
export function stripMarkers(script) {
  return script
    .split("\n")
    .filter((l) => !l.trim().startsWith("---"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function chunkForTTS(text, maxChars = 800) {
  const lines = text.split("\n").filter((l) => l.trim() && !l.startsWith("---"));
  const chunks = [];
  let current = [];
  let len = 0;
  for (const line of lines) {
    if (len + line.length > maxChars && current.length) {
      chunks.push(current.join("\n"));
      current = [];
      len = 0;
    }
    current.push(line);
    len += line.length + 1;
  }
  if (current.length) chunks.push(current.join("\n"));
  return chunks;
}

async function translateWithFallback(englishScript, preferred) {
  // "Latest OpenAI model" per client request, with a safe fallback chain.
  const models = [...new Set([preferred, "gpt-4o"])];
  let lastErr;
  for (const model of models) {
    try {
      const roman = await translateToKhadiboliRoman(englishScript, model);
      return { roman, model };
    } catch (err) {
      lastErr = err;
      console.warn(`[brief] translation with ${model} failed (${err.message}) — trying next`);
    }
  }
  throw lastErr;
}

export async function generateBrief(isoDate, { force = false } = {}) {
  const sched = scheduleForDate(isoDate);
  if (sched.off) return { off: true, date: isoDate, reason: sched.reason };

  const id = briefId(sched);
  const dir = join(BRIEFS_DIR, id);
  if (!force && existsSync(join(dir, "meta.json"))) return loadBrief(id);

  console.log(`[brief] ${id}: ${sched.tasks.length} tasks (~${sched.totalMinutes} min), weekday ${sched.weekday}, cycle ${sched.cycle}`);

  const settings = getSettings();
  const VOICE = settings.voice;
  const dayInfo = { day: sched.day, weekday: sched.weekday, week: sched.week };
  const english = generateEnglishScript(sched.tasks, dayInfo);

  const { roman, model: translateModel } = await translateWithFallback(english.script, settings.translateModel);
  let devanagari = "";
  try {
    devanagari = await translateToDevanagari(roman, translateModel);
  } catch (err) {
    console.warn(`[brief] devanagari step failed, continuing without it: ${err.message}`);
  }

  // Voice note — Azure Swara, chunked like the tested voice-command pipeline.
  const chunks = chunkForTTS(roman);
  const buffers = [];
  for (let i = 0; i < chunks.length; i++) {
    console.log(`[brief] synthesizing chunk ${i + 1}/${chunks.length} with ${VOICE}...`);
    const r = await azure.synthesize({ text: chunks[i], voice: VOICE });
    buffers.push(r.audio);
  }
  const audio = Buffer.concat(buffers);

  mkdirSync(dir, { recursive: true });
  const englishClean = stripMarkers(english.script);
  const romanClean = stripMarkers(roman);
  writeFileSync(join(dir, "english.txt"), englishClean);
  writeFileSync(join(dir, "hindi-roman.txt"), romanClean);
  if (devanagari) writeFileSync(join(dir, "hindi-devanagari.txt"), stripMarkers(devanagari));
  writeFileSync(join(dir, "brief.mp3"), audio);
  const meta = {
    id,
    client: "zahab_rishabh",
    clientName: sched.clientName,
    date: sched.date,
    day: sched.day,
    week: sched.week,
    weekday: sched.weekday,
    cycle: sched.cycle,
    totalTasks: sched.tasks.length,
    totalMinutes: sched.totalMinutes,
    voice: VOICE,
    translateModel,
    audioBytes: audio.length,
    generatedAt: new Date().toISOString(),
    sent: null,
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  console.log(`[brief] ${id} done — audio ${Math.round(audio.length / 1024)} KB`);
  return loadBrief(id);
}

export function loadBrief(id) {
  const dir = join(BRIEFS_DIR, id);
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
  return {
    ...meta,
    english: read("english.txt"),
    hindiRoman: read("hindi-roman.txt"),
    hindiDevanagari: read("hindi-devanagari.txt"),
    audioPath: join(dir, "brief.mp3"),
  };
}

export function listBriefs() {
  if (!existsSync(BRIEFS_DIR)) return [];
  return readdirSync(BRIEFS_DIR)
    .filter((d) => existsSync(join(BRIEFS_DIR, d, "meta.json")))
    .sort()
    .reverse()
    .map((d) => JSON.parse(readFileSync(join(BRIEFS_DIR, d, "meta.json"), "utf8")));
}

export function markSent(id, sent) {
  const metaPath = join(BRIEFS_DIR, id, "meta.json");
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  meta.sent = { ...(meta.sent || {}), ...sent };
  try {
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch {
    // Read-only filesystem (Vercel): the send still happened; status just isn't persisted.
  }
  return meta;
}
