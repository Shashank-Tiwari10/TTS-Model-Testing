import axios from "axios";

const BASE_URL = "https://api.elevenlabs.io/v1";

const DEFAULT_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam" },
];

const MODELS = [
  "eleven_multilingual_v2",
  "eleven_turbo_v2_5",
  "eleven_turbo_v2",
];

function getHeaders() {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY not set");
  return {
    "xi-api-key": process.env.ELEVENLABS_API_KEY,
    "Content-Type": "application/json",
  };
}

export async function synthesize({ text, voice = "21m00Tcm4TlvDq8ikWAM", model = "eleven_multilingual_v2", stability = 0.5, similarity = 0.75 }) {
  const response = await axios.post(
    `${BASE_URL}/text-to-speech/${voice}`,
    {
      text,
      model_id: model,
      voice_settings: {
        stability: parseFloat(stability),
        similarity_boost: parseFloat(similarity),
      },
    },
    {
      headers: getHeaders(),
      responseType: "arraybuffer",
    }
  );

  return {
    audio: Buffer.from(response.data),
    contentType: "audio/mpeg",
    format: "mp3",
    provider: "elevenlabs",
    model,
    voice,
  };
}

export async function listVoices() {
  try {
    const response = await axios.get(`${BASE_URL}/voices`, { headers: getHeaders() });
    return response.data.voices.map((v) => ({ id: v.voice_id, name: v.name }));
  } catch {
    return DEFAULT_VOICES;
  }
}

export function getConfig() {
  return {
    provider: "elevenlabs",
    label: "ElevenLabs",
    voices: DEFAULT_VOICES,
    models: MODELS,
    supportsInstructions: false,
    extraParams: [
      { key: "stability", label: "Stability", type: "range", min: 0, max: 1, step: 0.05, default: 0.5 },
      { key: "similarity", label: "Similarity Boost", type: "range", min: 0, max: 1, step: 0.05, default: 0.75 },
    ],
    configured: !!process.env.ELEVENLABS_API_KEY,
  };
}
