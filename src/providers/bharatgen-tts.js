import axios from "axios";

const LANGUAGES = [
  { id: "hi", name: "Hindi" },
  { id: "en", name: "English (Indian)" },
  { id: "bn", name: "Bengali" },
  { id: "ta", name: "Tamil" },
  { id: "te", name: "Telugu" },
  { id: "kn", name: "Kannada" },
  { id: "ml", name: "Malayalam" },
  { id: "mr", name: "Marathi" },
  { id: "gu", name: "Gujarati" },
  { id: "pa", name: "Punjabi" },
  { id: "od", name: "Odia" },
  { id: "ur", name: "Urdu" },
];

const MODELS = ["bharatgenai/sooktam2"];

function getBaseUrl() {
  return process.env.BHARATGEN_API_URL || "http://localhost:5060";
}

export async function synthesize({
  text,
  language = "hi",
  referenceAudioUrl = "",
  referenceText = "",
}) {
  const baseUrl = getBaseUrl();

  const body = {
    gen_text: text,
    tokenizer: "cls",
  };

  if (referenceAudioUrl) {
    body.ref_file = referenceAudioUrl;
    body.ref_text = referenceText || "";
  }

  const response = await axios.post(`${baseUrl}/synthesize`, body, {
    headers: { "Content-Type": "application/json" },
    responseType: "arraybuffer",
    timeout: 120000,
  });

  return {
    audio: Buffer.from(response.data),
    contentType: "audio/wav",
    format: "wav",
    provider: "bharatgen",
    model: "sooktam2",
    voice: "reference-guided",
  };
}

export function getConfig() {
  return {
    provider: "bharatgen",
    label: "BharatGen (Sooktam-2)",
    voices: [{ id: "reference-guided", name: "Reference-Guided (clone)" }],
    models: MODELS,
    languages: LANGUAGES,
    supportsInstructions: true,
    instructionsNote: "Requires a reference audio file (3-10s clean speech) for voice cloning. Self-hosted only.",
    extraParams: [
      { key: "language", label: "Language", type: "select", options: LANGUAGES.map((l) => l.id), optionLabels: LANGUAGES.map((l) => `${l.name} (${l.id})`), default: "hi" },
      { key: "referenceText", label: "Reference Text (matching ref audio)", type: "text", default: "" },
    ],
    configured: !!process.env.BHARATGEN_API_URL,
    configNote: process.env.BHARATGEN_API_URL
      ? `Using self-hosted at ${process.env.BHARATGEN_API_URL}`
      : "Self-hosted only. Set BHARATGEN_API_URL to your inference server. See huggingface.co/bharatgenai/sooktam2",
  };
}
