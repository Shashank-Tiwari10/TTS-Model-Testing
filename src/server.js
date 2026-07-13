import "dotenv/config";
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join, relative, sep } from "path";
import { mkdir, writeFile, readdir, unlink } from "fs/promises";

import * as openaiTTS from "./providers/openai-tts.js";
import * as elevenlabsTTS from "./providers/elevenlabs-tts.js";
import * as googleTTS from "./providers/google-tts.js";
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
app.use(express.json({ limit: "5mb" }));
app.use(express.static(join(__dirname, "public")));

const outputDir = join(__dirname, "..", "TTS Voice");
await mkdir(outputDir, { recursive: true });
app.use("/output", express.static(outputDir));

const providers = {
  sarvam: sarvamTTS,
  openai: openaiTTS,
  elevenlabs: elevenlabsTTS,
  google: googleTTS,
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

  if (!provider || !text) {
    return res.status(400).json({ error: "provider and text are required" });
  }

  const providerModule = providers[provider];
  if (!providerModule) {
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
    console.error(`[${provider}] Synthesis error:`, error.message);
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

app.listen(PORT, () => {
  console.log(`\n  TTS Model Tester running at http://localhost:${PORT}\n`);
  const configs = Object.values(providers).map((p) => p.getConfig());
  for (const c of configs) {
    console.log(`  ${c.configured ? "✓" : "✗"} ${c.label} — ${c.configured ? "API key found" : "not configured"}`);
  }
  console.log();
});
