import axios from "axios";

const DEFAULT_URL = "https://api-tts.knowlez.com/v1/tts/synthesise";

const VOICES = [
  { id: "af_bella", name: "Bella (Female)" },
  { id: "af_sarah", name: "Sarah (Female)" },
  { id: "af_nicole", name: "Nicole (Female)" },
  { id: "af_sky", name: "Sky (Female)" },
  { id: "am_adam", name: "Adam (Male)" },
  { id: "am_michael", name: "Michael (Male)" },
];

const FORMATS = ["mp3", "pcm"];

function getApiKey() {
  return process.env.KNOWLEZ_API_KEY || process.env.API_TTS_KEY || "";
}

export async function synthesize({
  text,
  voice = "af_bella",
  format = "mp3",
  speed = 1,
}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("KNOWLEZ_API_KEY not set");

  const audioFormat = FORMATS.includes(format) ? format : "mp3";
  const response = await axios.post(
    process.env.KNOWLEZ_TTS_API_URL || DEFAULT_URL,
    {
      text,
      voice,
      format: audioFormat,
      speed: parseFloat(speed),
      return: "audio",
    },
    {
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      responseType: "arraybuffer",
      timeout: 60000,
    }
  );

  return {
    audio: Buffer.from(response.data),
    contentType: audioFormat === "pcm" ? "audio/L16" : "audio/mpeg",
    format: audioFormat === "pcm" ? "pcm" : "mp3",
    provider: "knowlez",
    model: "api-tts-v1",
    voice,
  };
}

export function getConfig() {
  return {
    provider: "knowlez",
    label: "Knowlez API TTS",
    voices: VOICES,
    models: ["api-tts-v1"],
    supportsInstructions: false,
    extraParams: [
      { key: "speed", label: "Speed", type: "range", min: 0.5, max: 2.0, step: 0.05, default: 1.0 },
      { key: "format", label: "Audio Format", type: "select", options: FORMATS, default: "mp3" },
    ],
    configured: !!getApiKey(),
    configNote: "Uses https://api-tts.knowlez.com/v1/tts/synthesise with the x-api-key header.",
  };
}
