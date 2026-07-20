import { fileToBlob } from "./util.js";

const API_KEY = process.env.AZURE_SPEECH_KEY;
const REGION = process.env.AZURE_SPEECH_REGION || "CentralIndia";

export function getConfig() {
  return {
    key: "azure",
    label: "Azure Speech (Fast Transcription)",
    configured: Boolean(API_KEY),
    models: ["fast-transcription"],
    capabilities: { transcribe: true, diarize: true, translate: false, timestamps: true },
    languages: ["auto", "hi-IN", "en-IN", "en-US", "bn-IN", "ta-IN", "te-IN", "kn-IN", "ml-IN", "mr-IN", "gu-IN"],
    notes: "Fast Transcription API — synchronous, with speaker diarization and language identification.",
  };
}

export async function transcribe({ filePath, originalName, mode = "transcribe", language = "auto", maxSpeakers = 4 }) {
  if (!API_KEY) throw new Error("AZURE_SPEECH_KEY not set");

  const blob = await fileToBlob(filePath, originalName);

  const definition = {
    locales: language && language !== "auto" ? [language] : ["hi-IN", "en-IN", "en-US"],
  };
  if (mode === "diarize") {
    definition.diarization = { maxSpeakers: Number(maxSpeakers) || 4, enabled: true };
  }

  const form = new FormData();
  form.append("audio", blob, originalName || "audio.wav");
  form.append("definition", JSON.stringify(definition));

  const region = REGION.toLowerCase().replace(/\s+/g, "");
  const url = `https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": API_KEY },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Azure STT failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();

  const transcript = (data.combinedPhrases || []).map((p) => p.text).join("\n");

  let segments = null;
  if (Array.isArray(data.phrases) && data.phrases.length > 0) {
    segments = data.phrases.map((p) => ({
      speaker: mode === "diarize" && p.speaker != null ? String(p.speaker) : null,
      start: p.offsetMilliseconds != null ? p.offsetMilliseconds / 1000 : null,
      end: p.offsetMilliseconds != null && p.durationMilliseconds != null ? (p.offsetMilliseconds + p.durationMilliseconds) / 1000 : null,
      text: p.text,
    }));
  }

  const detected = data.phrases?.[0]?.locale || (definition.locales.length === 1 ? definition.locales[0] : "auto");

  return {
    provider: "azure",
    model: "fast-transcription",
    mode,
    transcript,
    detectedLanguage: detected,
    segments,
  };
}
