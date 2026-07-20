import { readFile } from "fs/promises";
import { getMime, fileToBlob } from "./util.js";

const API_KEY = process.env.SARVAM_API_KEY;
const BASE_URL = "https://api.sarvam.ai";
const MODEL = "saaras:v3";
const BATCH_POLL_INTERVAL_MS = 3000;
const BATCH_TIMEOUT_MS = 10 * 60 * 1000;

const LANGUAGES = [
  "unknown", "hi-IN", "en-IN", "bn-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "mr-IN", "gu-IN", "pa-IN", "od-IN",
  "as-IN", "brx-IN", "doi-IN", "kok-IN", "ks-IN", "mai-IN", "mni-IN", "ne-IN", "sa-IN", "sat-IN", "sd-IN", "ur-IN",
];

export function getConfig() {
  return {
    key: "sarvam",
    label: "Sarvam AI (Saaras v3)",
    configured: Boolean(API_KEY),
    models: [MODEL],
    capabilities: { transcribe: true, diarize: true, translate: true, timestamps: true },
    languages: LANGUAGES,
    notes: "Saaras v3 supports 22 Indian languages, code-mixed speech, and English. Diarization uses Sarvam Batch STT, so it can take a few minutes and has separate pricing.",
  };
}

function requireKey() {
  if (!API_KEY) throw new Error("SARVAM_API_KEY not set");
}

function apiHeaders() {
  return { "api-subscription-key": API_KEY, "Content-Type": "application/json" };
}

function safeFileName(name) {
  return (name || "audio.wav").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPresignedUrl(collection, fileName, type) {
  let entry = collection?.[fileName];
  if (!entry && Array.isArray(collection)) {
    entry = collection.find((item) => item?.file_name === fileName || item?.name === fileName) || collection[0];
  }
  if (!entry && collection && typeof collection === "object") {
    const values = Object.values(collection);
    if (values.length === 1) entry = values[0];
  }
  if (!entry && collection && typeof collection === "string") entry = collection;
  if (typeof entry === "string") return { url: entry, headers: {} };
  const url = entry?.url || entry?.[`${type}_url`] || entry?.file_url || entry?.presigned_url;
  if (!url) {
    const shape = Array.isArray(collection)
      ? `array(${collection.length})`
      : collection && typeof collection === "object"
        ? `keys: ${Object.keys(collection).join(", ") || "none"}`
        : typeof collection;
    const entryShape = entry && typeof entry === "object" ? `; entry keys: ${Object.keys(entry).join(", ") || "none"}` : "";
    throw new Error(`Sarvam batch API did not return a ${type} URL for ${fileName} (${shape}${entryShape})`);
  }
  return { url, headers: entry.headers || entry.file_metadata?.headers || {} };
}

async function apiJson(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...apiHeaders(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sarvam Batch STT failed (${res.status}): ${body.slice(0, 400)}`);
  }
  return res.json();
}

async function transcribeRest({ filePath, originalName, mode, language, withTimestamps }) {
  const blob = await fileToBlob(filePath, originalName);
  const form = new FormData();
  form.append("file", blob, originalName || "audio.wav");
  form.append("model", MODEL);
  form.append("mode", mode === "translate" ? "translate" : "transcribe");
  if (language && language !== "auto") form.append("language_code", language);
  if (withTimestamps) form.append("with_timestamps", "true");

  const res = await fetch(`${BASE_URL}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": API_KEY },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sarvam STT failed (${res.status}): ${body.slice(0, 400)}`);
  }
  return res.json();
}

async function transcribeBatch({ filePath, originalName, mode, language, withDiarization, maxSpeakers }) {
  const needsDiarization = mode === "diarize" || (mode === "translate" && withDiarization);
  const jobParameters = {
    model: MODEL,
    // Codemix is Sarvam's v3 output mode for natural Hindi-English conversations.
    mode: mode === "translate" ? "translate" : mode === "diarize" ? "codemix" : "transcribe",
    language_code: language && language !== "auto" ? language : "unknown",
    with_diarization: needsDiarization,
  };
  const speakerCount = Number(maxSpeakers);
  if (needsDiarization && Number.isInteger(speakerCount) && speakerCount >= 1 && speakerCount <= 8) {
    jobParameters.num_speakers = speakerCount;
  }

  const job = await apiJson("/speech-to-text/job/v1", {
    method: "POST",
    body: JSON.stringify({ job_parameters: jobParameters }),
  });
  if (!job.job_id) throw new Error("Sarvam Batch STT did not return a job ID");

  const fileName = safeFileName(originalName);
  const upload = await apiJson("/speech-to-text/job/v1/upload-files", {
    method: "POST",
    body: JSON.stringify({ job_id: job.job_id, files: [fileName] }),
  });
  const uploadTarget = getPresignedUrl(upload.upload_urls, fileName, "upload");
  const audio = await readFile(filePath);
  const uploadRes = await fetch(uploadTarget.url, {
    method: "PUT",
    headers: { "Content-Type": getMime(fileName), "x-ms-blob-type": "BlockBlob", ...uploadTarget.headers },
    body: audio,
  });
  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    throw new Error(`Sarvam Batch STT audio upload failed (${uploadRes.status}): ${body.slice(0, 300)}`);
  }

  await apiJson(`/speech-to-text/job/v1/${job.job_id}/start`, { method: "POST", body: "{}" });

  const deadline = Date.now() + BATCH_TIMEOUT_MS;
  let status;
  while (Date.now() < deadline) {
    await wait(BATCH_POLL_INTERVAL_MS);
    status = await apiJson(`/speech-to-text/job/v1/${job.job_id}/status`);
    if (status.job_state === "Completed" || status.job_state === "PartiallyCompleted") break;
    if (status.job_state === "Failed") throw new Error(`Sarvam Batch STT job failed: ${status.error_message || "Unknown error"}`);
  }
  if (!status || (status.job_state !== "Completed" && status.job_state !== "PartiallyCompleted")) {
    throw new Error("Sarvam Batch STT timed out while waiting for the transcription job");
  }

  const outputName = status.job_details
    ?.flatMap((detail) => detail.outputs || [])
    ?.find((output) => output.file_name)?.file_name;
  if (!outputName) throw new Error("Sarvam Batch STT completed without an output file");

  const download = await apiJson("/speech-to-text/job/v1/download-files", {
    method: "POST",
    body: JSON.stringify({ job_id: job.job_id, files: [outputName] }),
  });
  const downloadTarget = getPresignedUrl(download.download_urls, outputName, "download");
  const outputRes = await fetch(downloadTarget.url, { headers: downloadTarget.headers });
  if (!outputRes.ok) throw new Error(`Sarvam Batch STT result download failed (${outputRes.status})`);
  return outputRes.json();
}

function toSegments(data) {
  const diarizedEntries = data.diarized_transcript?.entries;
  if (Array.isArray(diarizedEntries) && diarizedEntries.length > 0) {
    return diarizedEntries.map((entry) => ({
      speaker: entry.speaker_id ?? null,
      start: entry.start_time_seconds ?? null,
      end: entry.end_time_seconds ?? null,
      text: entry.transcript || "",
    })).sort((a, b) => (a.start ?? Number.MAX_SAFE_INTEGER) - (b.start ?? Number.MAX_SAFE_INTEGER));
  }

  const timestamps = data.timestamps;
  const chunks = timestamps?.chunks || timestamps?.words;
  if (Array.isArray(chunks) && chunks.length > 0) {
    return chunks.map((text, index) => ({
      start: timestamps.start_time_seconds?.[index] ?? null,
      end: timestamps.end_time_seconds?.[index] ?? null,
      text,
    }));
  }
  return null;
}

export async function transcribe({ filePath, originalName, mode = "transcribe", language = "unknown", withTimestamps = false, withDiarization = false, maxSpeakers }) {
  requireKey();
  // Saaras REST is intended for short clips. Translation often receives whole
  // recordings, so route it through Batch too; otherwise Azure's gateway can
  // reject a large upload before Saaras sees it.
  const useBatch = mode === "diarize" || mode === "translate";
  const data = useBatch
    ? await transcribeBatch({ filePath, originalName, mode, language, withDiarization, maxSpeakers })
    : await transcribeRest({ filePath, originalName, mode, language, withTimestamps });

  const segments = toSegments(data);
  const rawTranscript = data.transcript || "";
  const transcript = (mode === "diarize" || withDiarization) && segments?.length
    ? segments.map((segment) => `Speaker ${segment.speaker ?? "?"}: ${segment.text}`).join("\n")
    : rawTranscript;

  return {
    provider: "sarvam",
    model: MODEL + (useBatch ? ` (Batch ${mode})` : ""),
    mode,
    transcript,
    rawTranscript,
    detectedLanguage: data.language_code || language,
    segments,
  };
}
