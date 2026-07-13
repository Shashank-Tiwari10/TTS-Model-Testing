import axios from "axios";

const BASE_URL = "https://api.sarvam.ai";

const VOICES_V3 = [
  { id: "shubh", name: "Shubh (Male, Default)" },
  { id: "mani", name: "Mani (Male, Tier 1)" },
  { id: "varun", name: "Varun (Male, Tier 1)" },
  { id: "priya", name: "Priya (Female, Tier 1)" },
  { id: "ishita", name: "Ishita (Female, Tier 1)" },
  { id: "ratan", name: "Ratan (Male)" },
  { id: "sunny", name: "Sunny (Male)" },
  { id: "amit", name: "Amit (Male)" },
  { id: "rahul", name: "Rahul (Male)" },
  { id: "rohan", name: "Rohan (Male)" },
  { id: "aditya", name: "Aditya (Male)" },
  { id: "dev", name: "Dev (Male)" },
  { id: "sumit", name: "Sumit (Male)" },
  { id: "kabir", name: "Kabir (Male)" },
  { id: "aayan", name: "Aayan (Male)" },
  { id: "ashutosh", name: "Ashutosh (Male)" },
  { id: "advait", name: "Advait (Male)" },
  { id: "anand", name: "Anand (Male)" },
  { id: "tarun", name: "Tarun (Male)" },
  { id: "gokul", name: "Gokul (Male)" },
  { id: "vijay", name: "Vijay (Male)" },
  { id: "mohit", name: "Mohit (Male)" },
  { id: "rehan", name: "Rehan (Male)" },
  { id: "soham", name: "Soham (Male)" },
  { id: "manan", name: "Manan (Male)" },
  { id: "ritu", name: "Ritu (Female)" },
  { id: "neha", name: "Neha (Female)" },
  { id: "pooja", name: "Pooja (Female)" },
  { id: "simran", name: "Simran (Female)" },
  { id: "kavya", name: "Kavya (Female)" },
  { id: "shreya", name: "Shreya (Female)" },
  { id: "roopa", name: "Roopa (Female)" },
  { id: "tanya", name: "Tanya (Female)" },
  { id: "shruti", name: "Shruti (Female)" },
  { id: "suhani", name: "Suhani (Female)" },
  { id: "kavitha", name: "Kavitha (Female)" },
  { id: "rupali", name: "Rupali (Female)" },
];

const VOICES_V2 = [
  { id: "anushka", name: "Anushka (Female)" },
  { id: "manisha", name: "Manisha (Female)" },
  { id: "vidya", name: "Vidya (Female)" },
  { id: "arya", name: "Arya (Male)" },
  { id: "abhilash", name: "Abhilash (Male)" },
  { id: "karun", name: "Karun (Male)" },
  { id: "hitesh", name: "Hitesh (Male)" },
];

const VOICES = [...VOICES_V3, ...VOICES_V2];

function getVoicesForModel(model) {
  return model === "bulbul:v2" ? VOICES_V2 : VOICES_V3;
}

function getDefaultVoice(model) {
  return model === "bulbul:v2" ? "anushka" : "shubh";
}

function isVoiceCompatible(voice, model) {
  const voices = getVoicesForModel(model);
  return voices.some((v) => v.id === voice);
}

const MODELS = ["bulbul:v3", "bulbul:v2"];

const LANGUAGES = [
  { id: "hi-IN", name: "Hindi" },
  { id: "en-IN", name: "English (Indian)" },
  { id: "bn-IN", name: "Bengali" },
  { id: "ta-IN", name: "Tamil" },
  { id: "te-IN", name: "Telugu" },
  { id: "kn-IN", name: "Kannada" },
  { id: "ml-IN", name: "Malayalam" },
  { id: "mr-IN", name: "Marathi" },
  { id: "gu-IN", name: "Gujarati" },
  { id: "pa-IN", name: "Punjabi" },
  { id: "od-IN", name: "Odia" },
];

function getHeaders() {
  if (!process.env.SARVAM_API_KEY) throw new Error("SARVAM_API_KEY not set");
  return {
    "api-subscription-key": process.env.SARVAM_API_KEY,
    "Content-Type": "application/json",
  };
}

const V2_CHAR_LIMIT = 300;

function splitTextIntoChunks(text, limit) {
  if (text.length <= limit) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    let splitAt = -1;
    const separators = ["।", ".", "!", "?", ",", ";", ":", " "];
    for (const sep of separators) {
      const idx = remaining.lastIndexOf(sep, limit);
      if (idx > 0) {
        splitAt = idx + sep.length;
        break;
      }
    }

    if (splitAt <= 0) splitAt = limit;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  return chunks.filter((c) => c.length > 0);
}

const CONTENT_TYPE_MAP = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/opus",
};

async function synthesizeChunk({ text, speaker, model, language, pace, temperature, codec }) {
  const body = {
    text,
    target_language_code: language,
    speaker,
    model,
    pace: parseFloat(pace),
    output_audio_codec: codec,
  };

  if (model === "bulbul:v3") {
    body.temperature = parseFloat(temperature);
  }

  const response = await axios.post(`${BASE_URL}/text-to-speech`, body, {
    headers: getHeaders(),
  });

  return Buffer.from(response.data.audios[0], "base64");
}

export async function synthesize({
  text,
  voice = "shubh",
  model = "bulbul:v3",
  language = "hi-IN",
  pace = 1.0,
  temperature = 0.6,
  codec = "mp3",
}) {
  const speaker = isVoiceCompatible(voice, model) ? voice : getDefaultVoice(model);

  const needsChunking = model === "bulbul:v2" && text.length > V2_CHAR_LIMIT;
  const chunks = needsChunking ? splitTextIntoChunks(text, V2_CHAR_LIMIT) : [text];

  const buffers = [];
  for (const chunk of chunks) {
    const buf = await synthesizeChunk({ text: chunk, speaker, model, language, pace, temperature, codec });
    buffers.push(buf);
  }

  const buffer = buffers.length === 1 ? buffers[0] : Buffer.concat(buffers);

  return {
    audio: buffer,
    contentType: CONTENT_TYPE_MAP[codec] || "audio/mpeg",
    format: codec === "opus" ? "ogg" : codec,
    provider: "sarvam",
    model,
    voice: speaker,
  };
}

export function getConfig() {
  return {
    provider: "sarvam",
    label: "Sarvam AI (Bulbul)",
    voices: VOICES,
    voicesByModel: { "bulbul:v3": VOICES_V3, "bulbul:v2": VOICES_V2 },
    models: MODELS,
    languages: LANGUAGES,
    supportsInstructions: false,
    extraParams: [
      { key: "language", label: "Language", type: "select", options: LANGUAGES.map((l) => l.id), optionLabels: LANGUAGES.map((l) => `${l.name} (${l.id})`), default: "hi-IN" },
      { key: "pace", label: "Pace (Speed)", type: "range", min: 0.5, max: 2.0, step: 0.1, default: 1.0 },
      { key: "temperature", label: "Temperature (v3 only)", type: "range", min: 0.01, max: 2.0, step: 0.05, default: 0.6 },
      { key: "codec", label: "Audio Format", type: "select", options: ["mp3", "wav", "aac", "opus", "flac"], default: "mp3" },
    ],
    configured: !!process.env.SARVAM_API_KEY,
  };
}
