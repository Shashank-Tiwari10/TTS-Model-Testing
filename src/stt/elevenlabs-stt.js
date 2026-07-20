import { fileToBlob } from "./util.js";

const API_KEY = process.env.ELEVENLABS_API_KEY;

export function getConfig() {
  return {
    key: "elevenlabs",
    label: "ElevenLabs (Scribe v1)",
    configured: Boolean(API_KEY),
    models: ["scribe_v1"],
    capabilities: { transcribe: true, diarize: true, translate: false, timestamps: true },
    languages: ["auto", "hi", "en", "bn", "ta", "te", "kn", "ml", "mr", "gu", "pa"],
    notes: "Scribe v1 — 99 languages, word timestamps, speaker diarization (up to 32 speakers), audio-event tagging.",
  };
}

export async function transcribe({ filePath, originalName, mode = "transcribe", language = "auto", model = "scribe_v1" }) {
  if (!API_KEY) throw new Error("ELEVENLABS_API_KEY not set");

  const blob = await fileToBlob(filePath, originalName);
  const form = new FormData();
  form.append("file", blob, originalName || "audio.wav");
  form.append("model_id", model);
  form.append("diarize", mode === "diarize" ? "true" : "false");
  form.append("tag_audio_events", "false");
  if (language && language !== "auto") {
    form.append("language_code", language.split("-")[0]);
  }

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": API_KEY },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs STT failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = await res.json();

  // Group word-level results into segments (by speaker when diarizing, else by pause)
  let segments = null;
  if (Array.isArray(data.words) && data.words.length > 0) {
    segments = [];
    let current = null;
    for (const w of data.words) {
      if (w.type === "spacing") {
        if (current) current.text += w.text;
        continue;
      }
      const speaker = w.speaker_id != null ? String(w.speaker_id).replace("speaker_", "") : null;
      if (!current || (mode === "diarize" && current.speakerId !== speaker) || (w.start - current.end > 2.0)) {
        if (current) segments.push(current);
        current = { speakerId: speaker, speaker: speaker, start: w.start, end: w.end, text: w.text };
      } else {
        current.text += w.text;
        current.end = w.end;
      }
    }
    if (current) segments.push(current);
    segments = segments.map(({ speakerId, ...s }) => (mode === "diarize" ? s : { ...s, speaker: null }));
  }

  return {
    provider: "elevenlabs",
    model,
    mode,
    transcript: data.text || "",
    detectedLanguage: data.language_code || language,
    segments,
  };
}
