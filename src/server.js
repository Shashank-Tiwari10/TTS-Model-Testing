import "dotenv/config";
import express from "express";
import { createServer } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { dirname, join, relative, sep } from "path";
import { mkdir, writeFile, readdir, unlink, appendFile } from "fs/promises";
import multer from "multer";
import { parseExcel, getTasksForDay, getDayInfo } from "./voice-command/excel-parser.js";
import { generateEnglishScript } from "./voice-command/command-generator.js";
import { translateToKhadiboliRoman, translateToDevanagari, TONE_PROFILES, getSuggestedVoice } from "./voice-command/translator.js";
import * as sarvamSTT from "./stt/sarvam-stt.js";
import * as openaiSTT from "./stt/openai-stt.js";
import * as elevenlabsSTT from "./stt/elevenlabs-stt.js";
import * as azureSTT from "./stt/azure-stt.js";
import { formatSegments } from "./stt/util.js";
import { LIVE_PROVIDERS, getLiveProviderList } from "./stt/live-providers.js";

import * as openaiTTS from "./providers/openai-tts.js";
import * as elevenlabsTTS from "./providers/elevenlabs-tts.js";
import * as googleTTS from "./providers/google-tts.js";
import * as geminiTTS from "./providers/gemini-tts.js";
import * as azureTTS from "./providers/azure-tts.js";
import * as sarvamTTS from "./providers/sarvam-tts.js";
import * as ai4bharatTTS from "./providers/ai4bharat-tts.js";
import * as bharatgenTTS from "./providers/bharatgen-tts.js";
import * as gnaniTTS from "./providers/gnani-tts.js";
import * as knowlezTTS from "./providers/knowlez-tts.js";
import * as awsPollyTTS from "./providers/aws-polly-tts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3500;

const app = express();
const httpServer = createServer(app);
const liveSttWss = new WebSocketServer({ noServer: true });
app.use(express.json({ limit: "5mb" }));
app.use(express.static(join(__dirname, "public")));

const outputDir = join(__dirname, "..", "TTS Voice");
await mkdir(outputDir, { recursive: true });
app.use("/output", express.static(outputDir));

const uploadDir = join(__dirname, "..", "uploads");
await mkdir(uploadDir, { recursive: true });
const maxSttUploadMb = Number(process.env.MAX_STT_UPLOAD_MB || 250);
const upload = multer({ dest: uploadDir, limits: { fileSize: maxSttUploadMb * 1024 * 1024 } });

let cachedExcelData = null;

const logDir = join(__dirname, "..", "..", "Training Module", "pipeline-logs");
await mkdir(logDir, { recursive: true });

async function logPipeline(dayNumber, tag, content, meta = {}) {
  const ts = new Date().toISOString();
  const dayPad = String(dayNumber).padStart(2, "0");
  const logFile = join(logDir, `Day${dayPad}_pipeline.log`);
  const metaStr = Object.entries(meta).map(([k, v]) => `${k}=${v}`).join(", ");
  const header = `\n${"=".repeat(60)}\n[${ts}] TAG: ${tag}${metaStr ? ` | ${metaStr}` : ""}\n${"=".repeat(60)}\n`;
  await appendFile(logFile, header + content + "\n");
  console.log(`[pipeline-log] Day${dayPad} → ${tag} (${content.length} chars) saved`);
}

const providers = {
  sarvam: sarvamTTS,
  openai: openaiTTS,
  elevenlabs: elevenlabsTTS,
  google: googleTTS,
  gemini: geminiTTS,
  azure: azureTTS,
  ai4bharat: ai4bharatTTS,
  bharatgen: bharatgenTTS,
  gnani: gnaniTTS,
  knowlez: knowlezTTS,
  aws: awsPollyTTS,
};

const providerRuntimeStatus = {};

app.get("/api/providers", (_req, res) => {
  const configs = {};
  for (const [key, provider] of Object.entries(providers)) {
    configs[key] = provider.getConfig();
    if (providerRuntimeStatus[key]) {
      configs[key].configured = false;
      configs[key].runtimeError = providerRuntimeStatus[key];
      configs[key].configNote = providerRuntimeStatus[key];
    }
  }
  res.json(configs);
});

app.get("/api/elevenlabs/voices", async (_req, res) => {
  try {
    const voices = await elevenlabsTTS.listVoices();
    res.json(voices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/synthesize", async (req, res) => {
  const { provider, text, ...params } = req.body;
  console.log(`\n[synthesize] ➜ INPUT: provider=${provider}, voice=${params.voice || "default"}, model=${params.model || "default"}, text="${text?.slice(0, 100)}${text?.length > 100 ? "..." : ""}" (${text?.length || 0} chars)`);

  if (!provider || !text) {
    console.log(`[synthesize] ✗ Missing required fields`);
    return res.status(400).json({ error: "provider and text are required" });
  }

  const providerModule = providers[provider];
  if (!providerModule) {
    console.log(`[synthesize] ✗ Unknown provider: ${provider}`);
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  try {
    const start = Date.now();
    const result = await providerModule.synthesize({ text, ...params });
    const elapsed = Date.now() - start;

    const version = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
    const modelName = result.model || params.model || "default";
    const modelFolder = sanitizeFilenamePart(modelName);
    const filename = buildAudioFilename({
      provider: result.provider || provider,
      model: modelName,
      voice: result.voice || params.voice || "default",
      version,
      format: result.format,
    });
    const relativeFile = `${modelFolder}/${filename}`;
    const modelDir = join(outputDir, modelFolder);
    const filepath = join(modelDir, filename);
    await mkdir(modelDir, { recursive: true });
    await writeFile(filepath, result.audio);

    console.log(`[synthesize] ✓ OUTPUT: file=${filename}, size=${result.audio.length} bytes, format=${result.format}, voice=${result.voice}, latency=${elapsed}ms`);

    res.json({
      success: true,
      file: `/output/${encodePath(relativeFile)}`,
      provider: result.provider,
      model: result.model,
      voice: result.voice,
      format: result.format,
      size: result.audio.length,
      latencyMs: elapsed,
    });
  } catch (err) {
    const error = describeProviderError(provider, err);
    if (error.statusCode === 402) {
      providerRuntimeStatus[provider] = error.message;
    }
    console.error(`[synthesize] ✗ ERROR [${provider}]: ${error.message}`);
    console.error(`[synthesize]   Stack: ${err.stack}`);
    res.status(error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500).json({ error: error.message });
  }
});

app.post("/api/synthesize/raw", async (req, res) => {
  const { provider, text, ...params } = req.body;

  if (!provider || !text) {
    return res.status(400).json({ error: "provider and text are required" });
  }

  const providerModule = providers[provider];
  if (!providerModule) {
    return res.status(400).json({ error: `Unknown provider: ${provider}` });
  }

  try {
    const result = await providerModule.synthesize({ text, ...params });
    res.set("Content-Type", result.contentType);
    res.set("Content-Disposition", `attachment; filename="${provider}_output.${result.format}"`);
    res.send(result.audio);
  } catch (err) {
    const error = describeProviderError(provider, err);
    res.status(error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500).json({ error: error.message });
  }
});

function describeProviderError(provider, err) {
  const statusCode = err.response?.status || 500;
  const data = err.response?.data;
  const upstreamMessage =
    data?.error?.message ||
    data?.message ||
    data?.error ||
    (typeof data === "string" ? data : "") ||
    err.message;

  if (provider === "sarvam" && statusCode === 402) {
    return {
      statusCode,
      message: "Sarvam AI has no credits available. Add credits in Sarvam or choose another configured provider such as OpenAI, Azure, Gnani, Google, or Knowlez.",
    };
  }

  return {
    statusCode,
    message: upstreamMessage || err.message || "Synthesis failed",
  };
}

app.get("/api/history", async (_req, res) => {
  try {
    const files = await listAudioFiles(outputDir);
    const audioFiles = files
      .map((filePath) => {
        const normalized = filePath.replace(/\\/g, "/");
        const f = normalized.split("/").pop();
        const parts = f.replace(/\.\w+$/, "").split("_");
        return {
          file: `/output/${encodePath(normalized)}`,
          provider: parts[3] || parts[0],
          timestamp: parseHistoryTimestamp(parts),
          filename: normalized,
          modelFolder: normalized.includes("/") ? normalized.split("/")[0] : "",
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp);
    res.json(audioFiles);
  } catch {
    res.json([]);
  }
});

function buildAudioFilename({ provider, model, voice, version, format }) {
  const parts = [
    "TTS",
    model,
    voice,
    provider,
    "InternalVoiceAgent",
    version,
  ];
  return `${parts.map(sanitizeFilenamePart).join("_")}.${sanitizeFilenamePart(format || "mp3")}`;
}

function sanitizeFilenamePart(value) {
  return String(value || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

function parseHistoryTimestamp(parts) {
  const maybeVersion = parts[5] || "";
  const compact = maybeVersion.replace(/\D/g, "");
  if (compact.length >= 14) {
    const y = compact.slice(0, 4);
    const mo = compact.slice(4, 6);
    const d = compact.slice(6, 8);
    const h = compact.slice(8, 10);
    const mi = compact.slice(10, 12);
    const s = compact.slice(12, 14);
    const parsed = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return parseInt(parts[1]) || 0;
}

app.delete("/api/history/:filename", async (req, res) => {
  try {
    await unlink(resolveOutputPath(req.params.filename));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/history/*filename", async (req, res) => {
  try {
    const filename = Array.isArray(req.params.filename) ? req.params.filename.join("/") : req.params.filename;
    await unlink(resolveOutputPath(filename));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function listAudioFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listAudioFiles(fullPath, base));
    } else if (/\.(mp3|wav|ogg|flac|aac|pcm)$/.test(entry.name)) {
      files.push(relative(base, fullPath));
    }
  }
  return files;
}

function encodePath(value) {
  return value.split(/[\\/]/).map(encodeURIComponent).join("/");
}

function resolveOutputPath(filename) {
  const target = join(outputDir, filename);
  const rel = relative(outputDir, target);
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
    throw new Error("Invalid history filename");
  }
  return target;
}

// ============ Voice Command Pipeline Routes ============

app.post("/api/voice-command/upload", upload.single("schedule"), async (req, res) => {
  try {
    console.log(`\n[upload] ➜ INPUT: file=${req.file?.originalname || "none"}, size=${req.file?.size || 0} bytes`);
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const parsed = parseExcel(req.file.path);
    cachedExcelData = { ...parsed, filePath: req.file.path, originalName: req.file.originalname };
    console.log(`[upload] ✓ OUTPUT: ${parsed.tasks.length} tasks, ${parsed.totalDays} days, sheet="${parsed.sheetName}"`);
    res.json({
      success: true,
      fileName: req.file.originalname,
      totalTasks: parsed.tasks.length,
      totalDays: parsed.totalDays,
      sheetName: parsed.sheetName,
    });
  } catch (err) {
    console.error(`[upload] ✗ ERROR: ${err.message}`);
    console.error(`[upload]   Stack: ${err.stack}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/voice-command/day/:dayNumber", (req, res) => {
  try {
    console.log(`\n[day] ➜ INPUT: dayNumber=${req.params.dayNumber}`);
    if (!cachedExcelData) {
      console.log(`[day] ✗ No schedule uploaded`);
      return res.status(400).json({ error: "No schedule uploaded. Please upload an Excel file first." });
    }
    const dayNumber = parseInt(req.params.dayNumber);
    if (isNaN(dayNumber) || dayNumber < 1 || dayNumber > cachedExcelData.totalDays) {
      console.log(`[day] ✗ Invalid day number: ${req.params.dayNumber} (valid: 1-${cachedExcelData.totalDays})`);
      return res.status(400).json({ error: `Invalid day number. Must be 1-${cachedExcelData.totalDays}` });
    }
    const dayTasks = getTasksForDay(cachedExcelData.tasks, dayNumber);
    const dayInfo = getDayInfo(dayNumber);
    const result = generateEnglishScript(dayTasks, dayInfo);
    console.log(`[day] ✓ OUTPUT: day=${dayNumber} (${dayInfo.weekday}), tasks=${result.totalTasks}, phases=${JSON.stringify(result.phases)}, script=${result.script.length} chars`);
    if (cachedExcelData) cachedExcelData.currentDay = dayNumber;
    logPipeline(dayNumber, "ENGLISH_SCRIPT", result.script, { tasks: result.totalTasks, weekday: dayInfo.weekday, phases: JSON.stringify(result.phases) });
    res.json({
      dayInfo,
      totalTasks: result.totalTasks,
      phaseCounts: result.phases,
      englishScript: result.script,
      lines: result.lines,
    });
  } catch (err) {
    console.error(`[day] ✗ ERROR: ${err.message}`);
    console.error(`[day]   Stack: ${err.stack}`);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/voice-command/translate", async (req, res) => {
  try {
    const { text, step, model = "openai", styleInstructions } = req.body;
    console.log(`\n[translate] ➜ INPUT: step=${step}, model=${model}, text="${text?.slice(0, 120)}${text?.length > 120 ? "..." : ""}" (${text?.length || 0} chars)`);
    if (styleInstructions) console.log(`[translate]   Style: "${styleInstructions.slice(0, 100)}${styleInstructions.length > 100 ? "..." : ""}"`);
    if (!text) return res.status(400).json({ error: "text is required" });

    let result;
    if (step === "english-to-roman") {
      result = await translateToKhadiboliRoman(text, model, styleInstructions);
    } else if (step === "roman-to-devanagari") {
      result = await translateToDevanagari(text, model);
    } else {
      console.log(`[translate] ✗ Invalid step: ${step}`);
      return res.status(400).json({ error: "step must be 'english-to-roman' or 'roman-to-devanagari'" });
    }

    console.log(`[translate] ✓ OUTPUT: result="${result?.slice(0, 120)}${result?.length > 120 ? "..." : ""}" (${result?.length || 0} chars)`);

    const dayNum = req.body.dayNumber || cachedExcelData?.currentDay || 0;
    if (step === "english-to-roman") {
      logPipeline(dayNum, "KHADIBOLI_ROMAN", result, { model, style: (styleInstructions || "default").slice(0, 50) });
    } else if (step === "roman-to-devanagari") {
      logPipeline(dayNum, "DEVNAGRI", result, { model });
    }

    res.json({ success: true, result, step, model });
  } catch (err) {
    console.error(`[translate] ✗ ERROR: ${err.message}`);
    console.error(`[translate]   Stack: ${err.stack}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/voice-command/tones", (_req, res) => {
  res.json(TONE_PROFILES);
});

app.post("/api/voice-command/suggest-voice", (req, res) => {
  const { tone, provider, model } = req.body;
  const voice = getSuggestedVoice(tone || "empathy", provider || "sarvam", model);
  console.log(`[suggest-voice] tone=${tone}, provider=${provider}, model=${model} → voice=${voice}`);
  res.json({ tone, provider, model, suggestedVoice: voice });
});

function splitScriptIntoChunks(text, maxChars = 800) {
  const lines = text.split("\n").filter(l => l.trim() && !l.startsWith("---"));
  const chunks = [];
  let current = [];
  let currentLen = 0;

  for (const line of lines) {
    if (currentLen + line.length > maxChars && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += line.length + 1;
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}

app.post("/api/voice-command/generate-audio", async (req, res) => {
  try {
    const { text, provider = "sarvam", voice, model, tone = "empathy", ...extraParams } = req.body;
    console.log(`\n[generate-audio] ➜ INPUT: provider=${provider}, model=${model || "default"}, voice=${voice || "auto"}, tone=${tone}, text=${text?.length || 0} chars`);
    console.log(`[generate-audio]   Text preview: "${text?.slice(0, 150)}${text?.length > 150 ? "..." : ""}"`);
    if (!text) return res.status(400).json({ error: "text is required" });

    const providerModule = providers[provider];
    if (!providerModule) return res.status(400).json({ error: `Unknown provider: ${provider}` });

    const selectedVoice = voice || getSuggestedVoice(tone, provider, model);
    const chunks = splitScriptIntoChunks(text, 800);
    const start = Date.now();

    console.log(`[generate-audio]   Chunked into ${chunks.length} pieces, voice=${selectedVoice}`);
    chunks.forEach((c, i) => console.log(`[generate-audio]   Chunk ${i + 1}: ${c.length} chars — "${c.slice(0, 60)}..."`));

    const audioBuffers = [];
    let lastResult = null;

    for (let i = 0; i < chunks.length; i++) {
      const chunkStart = Date.now();
      console.log(`[generate-audio]   ⏳ Synthesizing chunk ${i + 1}/${chunks.length}...`);
      const result = await providerModule.synthesize({
        text: chunks[i],
        voice: selectedVoice,
        model,
        ...extraParams,
      });
      const chunkMs = Date.now() - chunkStart;
      console.log(`[generate-audio]   ✓ Chunk ${i + 1} done: ${result.audio.length} bytes, ${chunkMs}ms`);
      audioBuffers.push(result.audio);
      lastResult = result;
    }

    const combinedAudio = Buffer.concat(audioBuffers);
    const elapsed = Date.now() - start;

    const fmt = lastResult?.format || "mp3";
    const dayNum = String(extraParams.dayNumber || 0).padStart(2, "0");
    const providerName = sanitizeFilenamePart(provider).replace(/-/g, "");
    const modelName = sanitizeFilenamePart(lastResult?.model || model || "default");
    const toneName = tone.charAt(0).toUpperCase() + tone.slice(1);
    const folderName = `Day${dayNum}_${providerName}_${modelName}_${toneName}`;

    const trainingDir = join(__dirname, "..", "..", "Training Module", folderName);
    await mkdir(trainingDir, { recursive: true });

    const version = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
    const filename = `VoiceCmd_Day${dayNum}_${version}.${fmt}`;
    await writeFile(join(trainingDir, filename), combinedAudio);

    const vcDir = join(outputDir, "voice-commands");
    await mkdir(vcDir, { recursive: true });
    await writeFile(join(vcDir, filename), combinedAudio);

    console.log(`[generate-audio] ✓ OUTPUT: folder=${folderName}, file=${filename}, total=${combinedAudio.length} bytes, chunks=${chunks.length}, latency=${elapsed}ms`);
    console.log(`[generate-audio]   Saved to: Training Module/${folderName}/${filename}`);
    logPipeline(parseInt(extraParams.dayNumber) || 0, "AUDIO_GENERATED", `File: ${filename}\nFolder: ${folderName}\nSize: ${combinedAudio.length} bytes\nChunks: ${chunks.length}\nLatency: ${elapsed}ms`, { provider, model: modelName, voice: lastResult?.voice || selectedVoice, tone });

    res.json({
      success: true,
      file: `/output/voice-commands/${encodeURIComponent(filename)}`,
      folder: folderName,
      savedTo: `Training Module/${folderName}/${filename}`,
      provider: lastResult?.provider || provider,
      model: lastResult?.model || model,
      voice: lastResult?.voice || selectedVoice,
      format: fmt,
      size: combinedAudio.length,
      chunks: chunks.length,
      latencyMs: elapsed,
    });
  } catch (err) {
    console.error(`[generate-audio] ✗ ERROR: ${err.message}`);
    console.error(`[generate-audio]   Stack: ${err.stack}`);
    res.status(500).json({ error: err.message });
  }
});

// ============ End Voice Command Pipeline Routes ============

// ============ Speech-to-Text (STT) Routes ============

const sttProviders = {
  sarvam: sarvamSTT,
  openai: openaiSTT,
  elevenlabs: elevenlabsSTT,
  azure: azureSTT,
};

const sttOutputDir = join(__dirname, "..", "STT Transcripts");
await mkdir(sttOutputDir, { recursive: true });

app.get("/api/stt/live-providers", (_req, res) => {
  res.json(getLiveProviderList());
});

// Save a finished live-transcription session (transcript already carries speaker labels)
app.post("/api/stt/live-save", async (req, res) => {
  try {
    const { provider = "live", model, transcript, language = "auto", durationSeconds } = req.body;
    if (!transcript || !transcript.trim()) return res.status(400).json({ error: "transcript is required" });

    const version = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
    const modelFolder = sanitizeFilenamePart(model || `${provider}-live`);
    const dir = join(sttOutputDir, modelFolder);
    await mkdir(dir, { recursive: true });
    const baseName = `STT_${sanitizeFilenamePart(provider)}_live_${version}`;

    const txtContent = [
      `Provider: ${provider} (LIVE) | Model: ${model || provider} | Mode: live-diarize`,
      `Language: ${language} | Duration: ${durationSeconds || "?"}s | Saved: ${new Date().toISOString()}`,
      ``,
      `--- LIVE TRANSCRIPT (speaker-wise) ---`,
      transcript,
    ].join("\n");
    await writeFile(join(dir, `${baseName}.txt`), txtContent, "utf8");
    await writeFile(join(dir, `${baseName}.json`), JSON.stringify({
      provider, model: model || provider, mode: "live", language,
      durationSeconds, transcript, timestamp: new Date().toISOString(),
    }, null, 2), "utf8");
    await appendFile(join(sttOutputDir, "STT_run_log.txt"),
      `[${new Date().toISOString()}] provider=${provider} model=${model || provider} mode=LIVE lang=${language} chars=${transcript.length} duration=${durationSeconds || "?"}s → ${modelFolder}/${baseName}.txt\n`);

    console.log(`[live-stt] ✓ SAVED: ${modelFolder}/${baseName}.txt (${transcript.length} chars)`);
    res.json({ success: true, savedTo: `STT Transcripts/${modelFolder}/${baseName}.txt` });
  } catch (err) {
    console.error(`[live-stt] ✗ save error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/stt/providers", (_req, res) => {
  const configs = {};
  for (const [key, p] of Object.entries(sttProviders)) configs[key] = p.getConfig();
  res.json(configs);
});

app.post("/api/stt/transcribe", upload.single("audio"), async (req, res) => {
  try {
    const { provider = "sarvam", mode = "transcribe", language = "auto", model, withTimestamps, withDiarization, maxSpeakers } = req.body;
    console.log(`\n[stt] ➜ INPUT: provider=${provider}, mode=${mode}, language=${language}, model=${model || "default"}, file=${req.file?.originalname || "none"} (${req.file?.size || 0} bytes)`);

    if (!req.file) return res.status(400).json({ error: "No audio file uploaded" });
    const providerModule = sttProviders[provider];
    if (!providerModule) return res.status(400).json({ error: `Unknown STT provider: ${provider}` });

    const caps = providerModule.getConfig().capabilities;
    if (mode === "diarize" && !caps.diarize) return res.status(400).json({ error: `${provider} does not support diarization. Use ElevenLabs or Azure.` });
    if (mode === "translate" && !caps.translate) return res.status(400).json({ error: `${provider} does not support speech translation. Use Sarvam or OpenAI.` });

    const start = Date.now();
    const result = await providerModule.transcribe({
      filePath: req.file.path,
      originalName: req.file.originalname,
      mode,
      language,
      model: model || undefined,
      withTimestamps: withTimestamps === "true" || withTimestamps === true,
      withDiarization: withDiarization === "true" || withDiarization === true,
      maxSpeakers,
    });
    const elapsed = Date.now() - start;

    const segmentText = formatSegments(result.segments);
    const version = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
    const modelFolder = sanitizeFilenamePart(result.model || "default");
    const sttModelDir = join(sttOutputDir, modelFolder);
    await mkdir(sttModelDir, { recursive: true });
    const baseName = `STT_${provider}_${mode}_${version}`;
    const txtContent = [
      `Provider: ${result.provider} | Model: ${result.model} | Mode: ${mode}`,
      `File: ${req.file.originalname} | Language: ${result.detectedLanguage} | Latency: ${elapsed}ms`,
      ``,
      `--- TRANSCRIPT ---`,
      result.transcript,
      ...(segmentText ? [``, `--- SEGMENTS ---`, segmentText] : []),
    ].join("\n");
    await writeFile(join(sttModelDir, `${baseName}.txt`), txtContent, "utf8");
    await writeFile(join(sttModelDir, `${baseName}.json`), JSON.stringify({
      ...result,
      fileName: req.file.originalname,
      fileSizeBytes: req.file.size,
      latencyMs: elapsed,
      timestamp: new Date().toISOString(),
    }, null, 2), "utf8");
    await appendFile(join(sttOutputDir, "STT_run_log.txt"),
      `[${new Date().toISOString()}] provider=${provider} model=${result.model} mode=${mode} file="${req.file.originalname}" lang=${result.detectedLanguage} chars=${result.transcript.length} segments=${result.segments?.length || 0} latency=${elapsed}ms → ${modelFolder}/${baseName}.txt\n`);

    console.log(`[stt] ✓ OUTPUT: ${result.transcript.length} chars, lang=${result.detectedLanguage}, segments=${result.segments?.length || 0}, latency=${elapsed}ms`);
    console.log(`[stt]   Saved: STT Transcripts/${modelFolder}/${baseName}.txt + .json (log: STT_run_log.txt)`);

    res.json({
      success: true,
      ...result,
      segmentText,
      savedTo: `STT Transcripts/${modelFolder}/${baseName}.txt`,
      fileName: req.file.originalname,
      latencyMs: elapsed,
    });
  } catch (err) {
    console.error(`[stt] ✗ ERROR: ${err.message}`);
    console.error(`[stt]   Stack: ${err.stack}`);
    appendFile(join(sttOutputDir, "STT_run_log.txt"),
      `[${new Date().toISOString()}] provider=${req.body.provider} mode=${req.body.mode} file="${req.file?.originalname}" ✗ ERROR: ${err.message}\n`).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `Audio file is too large. The current STT upload limit is ${maxSttUploadMb} MB.` });
  }
  next(err);
});

// ============ End STT Routes ============

// Keep the provider key on the server. The browser sends raw PCM to this local
// proxy; the proxy is the only component that talks to the provider WebSockets.
liveSttWss.on("connection", (client) => {
  let sarvamSocket = null;
  let liveSession = null; // adapter-based providers (deepgram, speechmatics, gladia, azurelive, assemblyai)

  const stopProvider = () => {
    if (sarvamSocket && sarvamSocket.readyState === WebSocket.OPEN) sarvamSocket.close();
    sarvamSocket = null;
    if (liveSession) { try { liveSession.close(); } catch {} liveSession = null; }
  };

  client.on("message", async (message, isBinary) => {
    if (!isBinary) {
      let command;
      try { command = JSON.parse(message.toString()); } catch { return; }
      if (command.type === "start" && LIVE_PROVIDERS[command.provider]) {
        stopProvider();
        const def = LIVE_PROVIDERS[command.provider];
        console.log(`[live-stt] ➜ START provider=${command.provider}, language=${command.language || "auto"}`);
        if (!process.env[def.envKey]) {
          client.send(JSON.stringify({ type: "error", error: `${def.envKey} is not configured in .env` }));
          return;
        }
        const callbacks = {
          onReady: () => client.readyState === WebSocket.OPEN && client.send(JSON.stringify({ type: "ready" })),
          onTranscript: (t) => client.readyState === WebSocket.OPEN && client.send(JSON.stringify({ type: "transcript", transcript: t.text, speaker: t.speaker, final: t.final })),
          onError: (err) => {
            console.error(`[live-stt] ✗ ${command.provider}: ${err}`);
            client.readyState === WebSocket.OPEN && client.send(JSON.stringify({ type: "error", error: err }));
          },
          onClose: () => client.readyState === WebSocket.OPEN && client.send(JSON.stringify({ type: "provider_closed" })),
        };
        try {
          liveSession = await def.create({ language: command.language }, callbacks);
        } catch (err) {
          console.error(`[live-stt] ✗ start failed: ${err.message}`);
          client.send(JSON.stringify({ type: "error", error: err.message }));
        }
        return;
      }
      if (command.type === "flush" && liveSession) { liveSession.flush(); return; }
      if (command.type === "start") {
        const provider = command.provider === "openai" ? "openai" : "sarvam";
        if (provider === "sarvam" && !process.env.SARVAM_API_KEY) {
          client.send(JSON.stringify({ type: "error", error: "SARVAM_API_KEY is not configured" }));
          client.close();
          return;
        }
        if (provider === "openai" && !process.env.OPENAI_API_KEY) {
          client.send(JSON.stringify({ type: "error", error: "OPENAI_API_KEY is not configured" }));
          client.close();
          return;
        }
        stopProvider();
        const language = command.language && command.language !== "auto" ? command.language : "unknown";
        if (provider === "sarvam") {
          const mode = command.mode === "translate" ? "translate" : "transcribe";
          const query = new URLSearchParams({
            "language-code": language, model: "saaras:v3", mode,
            sample_rate: "16000", input_audio_codec: "pcm_s16le",
            high_vad_sensitivity: "true", vad_signals: "true", flush_signal: "true",
          });
          sarvamSocket = new WebSocket(`wss://api.sarvam.ai/speech-to-text/ws?${query}`, {
            headers: { "api-subscription-key": process.env.SARVAM_API_KEY },
          });
          sarvamSocket.on("open", () => client.readyState === WebSocket.OPEN && client.send(JSON.stringify({ type: "ready" })));
        } else {
          sarvamSocket = new WebSocket("wss://api.openai.com/v1/realtime?model=gpt-realtime", {
            headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          });
          sarvamSocket.on("open", () => sarvamSocket.send(JSON.stringify({
            type: "session.update",
            session: { type: "realtime", audio: { input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { model: "gpt-realtime-whisper", language: language === "unknown" ? undefined : language.split("-")[0] } } } },
          })));
        }
        sarvamSocket.on("message", (data) => client.readyState === WebSocket.OPEN && client.send(data.toString()));
        sarvamSocket.on("error", (error) => client.readyState === WebSocket.OPEN && client.send(JSON.stringify({ type: "error", error: `Sarvam live STT: ${error.message}` })));
        sarvamSocket.on("close", () => client.readyState === WebSocket.OPEN && client.send(JSON.stringify({ type: "provider_closed" })));
      } else if (command.type === "flush" && sarvamSocket?.readyState === WebSocket.OPEN) {
        sarvamSocket.send(JSON.stringify(command.provider === "openai" ? { type: "input_audio_buffer.commit" } : { type: "flush" }));
      }
      return;
    }

    if (liveSession) {
      liveSession.sendAudio(Buffer.from(message));
      return;
    }
    if (sarvamSocket?.readyState === WebSocket.OPEN) {
      const base64 = Buffer.from(message).toString("base64");
      const provider = sarvamSocket.url.includes("api.openai.com") ? "openai" : "sarvam";
      sarvamSocket.send(JSON.stringify(provider === "openai"
        ? { type: "input_audio_buffer.append", audio: base64 }
        : { audio: { data: base64, sample_rate: 16000, encoding: "pcm_s16le" } }));
    }
  });
  client.on("close", stopProvider);
  client.on("error", stopProvider);
});

httpServer.on("upgrade", (request, socket, head) => {
  if (new URL(request.url, `http://${request.headers.host}`).pathname !== "/api/stt/live") {
    socket.destroy();
    return;
  }
  liveSttWss.handleUpgrade(request, socket, head, (client) => liveSttWss.emit("connection", client, request));
});

httpServer.listen(PORT, () => {
  console.log(`\n  TTS Model Tester running at http://localhost:${PORT}\n`);
  const configs = Object.values(providers).map((p) => p.getConfig());
  for (const c of configs) {
    console.log(`  ${c.configured ? "✓" : "✗"} ${c.label} — ${c.configured ? "API key found" : "not configured"}`);
  }
  console.log();
});
