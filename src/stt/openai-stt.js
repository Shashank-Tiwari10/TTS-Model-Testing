import { fileToBlob, toShortLang } from "./util.js";

const API_KEY = process.env.OPENAI_API_KEY;

export function getConfig() {
  return {
    key: "openai",
    label: "OpenAI (Whisper / GPT-4o)",
    configured: Boolean(API_KEY),
    models: ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"],
    capabilities: { transcribe: true, diarize: false, translate: true, timestamps: true },
    languages: ["auto", "hi-IN", "en-IN", "bn-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "mr-IN", "gu-IN", "pa-IN"],
    notes: "whisper-1 supports translation to English and timestamps (verbose_json). gpt-4o-transcribe models are higher accuracy, transcription only.",
  };
}

export async function transcribe({ filePath, originalName, mode = "transcribe", language = "auto", model = "whisper-1", withTimestamps = false }) {
  if (!API_KEY) throw new Error("OPENAI_API_KEY not set");

  const blob = await fileToBlob(filePath, originalName);
  const form = new FormData();
  form.append("file", blob, originalName || "audio.wav");

  let url;
  if (mode === "translate") {
    url = "https://api.openai.com/v1/audio/translations";
    form.append("model", "whisper-1"); // translations endpoint supports whisper-1 only
  } else {
    url = "https://api.openai.com/v1/audio/transcriptions";
    form.append("model", model);
    const short = toShortLang(language);
    if (short) form.append("language", short);
    if (withTimestamps && model === "whisper-1") {
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "segment");
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI STT failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();

  let segments = null;
  if (Array.isArray(data.segments) && data.segments.length > 0) {
    segments = data.segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
  }

  return {
    provider: "openai",
    model: mode === "translate" ? "whisper-1 (translate)" : model,
    mode,
    transcript: data.text || "",
    detectedLanguage: data.language || (mode === "translate" ? "en" : language),
    segments,
  };
}
