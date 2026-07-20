import axios from "axios";

const VOICES = [
  { id: "Aditi", name: "Aditi (Female)" },
  { id: "Bikram", name: "Bikram (Male)" },
  { id: "Anjali", name: "Anjali (Female)" },
  { id: "Arjun", name: "Arjun (Male)" },
  { id: "Kavya", name: "Kavya (Female)" },
  { id: "Ravi", name: "Ravi (Male)" },
  { id: "Meera", name: "Meera (Female)" },
  { id: "Deepak", name: "Deepak (Male)" },
];

const LANGUAGES = [
  { id: "hi", name: "Hindi" },
  { id: "en", name: "English" },
  { id: "bn", name: "Bengali" },
  { id: "ta", name: "Tamil" },
  { id: "te", name: "Telugu" },
  { id: "kn", name: "Kannada" },
  { id: "ml", name: "Malayalam" },
  { id: "mr", name: "Marathi" },
  { id: "gu", name: "Gujarati" },
  { id: "pa", name: "Punjabi" },
  { id: "od", name: "Odia" },
  { id: "as", name: "Assamese" },
  { id: "ur", name: "Urdu" },
  { id: "ne", name: "Nepali" },
  { id: "sa", name: "Sanskrit" },
  { id: "sd", name: "Sindhi" },
  { id: "mni", name: "Manipuri" },
  { id: "kok", name: "Konkani" },
  { id: "mai", name: "Maithili" },
  { id: "sat", name: "Santali" },
  { id: "doi", name: "Dogri" },
];

const EMOTIONS = ["Neutral", "Happy", "Sad", "Anger", "Fear", "Surprise", "Disgust", "Narration", "Conversation", "News", "Command"];

const MODELS = ["ai4bharat/indic-parler-tts"];

function getBaseUrl() {
  return process.env.AI4BHARAT_API_URL || "http://localhost:5050";
}

export async function synthesize({
  text,
  voice = "Aditi",
  language = "hi",
  emotion = "Neutral",
  description = "",
}) {
  const baseUrl = getBaseUrl();
  const voiceDescription = description || `${voice} speaks with a ${emotion.toLowerCase()} tone at a normal pace`;

  if (process.env.AI4BHARAT_USE_HF === "true") {
    return synthesizeViaHuggingFace({ text, voiceDescription });
  }

  const response = await axios.post(
    `${baseUrl}/synthesize`,
    {
      text,
      lang: `${language}-IN`,
      style: emotion.toLowerCase(),
      description: voiceDescription,
    },
    {
      headers: { "Content-Type": "application/json" },
      responseType: "arraybuffer",
      timeout: 60000,
    }
  );

  return {
    audio: Buffer.from(response.data),
    contentType: "audio/wav",
    format: "wav",
    provider: "ai4bharat",
    model: "indic-parler-tts",
    voice,
  };
}

async function synthesizeViaHuggingFace({ text, voiceDescription }) {
  if (!process.env.HF_API_TOKEN) throw new Error("HF_API_TOKEN not set (needed for AI4Bharat HuggingFace inference)");

  const response = await axios.post(
    "https://router.huggingface.co/hf-inference/models/ai4bharat/indic-parler-tts",
    { inputs: text, parameters: { description: voiceDescription } },
    {
      headers: {
        Authorization: `Bearer ${process.env.HF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      responseType: "arraybuffer",
      timeout: 120000,
    }
  );

  return {
    audio: Buffer.from(response.data),
    contentType: "audio/flac",
    format: "flac",
    provider: "ai4bharat",
    model: "indic-parler-tts",
    voice: "hf-default",
  };
}

export function getConfig() {
  const hfMode = process.env.AI4BHARAT_USE_HF === "true";
  const configured = hfMode
    ? !!process.env.HF_API_TOKEN
    : !!process.env.AI4BHARAT_API_URL;

  return {
    provider: "ai4bharat",
    label: "AI4Bharat (Indic Parler)",
    voices: VOICES,
    models: MODELS,
    languages: LANGUAGES,
    supportsInstructions: true,
    instructionsNote: "Describe the voice style, e.g. 'A female voice speaking slowly with warmth'",
    extraParams: [
      { key: "language", label: "Language", type: "select", options: LANGUAGES.map((l) => l.id), optionLabels: LANGUAGES.map((l) => `${l.name} (${l.id})`), default: "hi" },
      { key: "emotion", label: "Emotion", type: "select", options: EMOTIONS, default: "Neutral" },
    ],
    configured,
    configNote: hfMode
      ? "HuggingFace serverless no longer hosts indic-parler-tts (400: model not supported) — self-host and set AI4BHARAT_API_URL to use this provider"
      : configured
        ? `Using self-hosted at ${process.env.AI4BHARAT_API_URL}`
        : "Set AI4BHARAT_API_URL (self-hosted) or AI4BHARAT_USE_HF=true + HF_API_TOKEN",
  };
}
