import OpenAI from "openai";

const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];
const MODELS = ["tts-1", "tts-1-hd", "gpt-4o-mini-tts"];

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export async function synthesize({ text, voice = "alloy", model = "tts-1", instructions = "" }) {
  const openai = getClient();

  const params = {
    model,
    voice,
    input: text,
    response_format: "mp3",
  };
  if (instructions && model === "gpt-4o-mini-tts") {
    params.instructions = instructions;
  }

  const response = await openai.audio.speech.create(params);
  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    audio: buffer,
    contentType: "audio/mpeg",
    format: "mp3",
    provider: "openai",
    model,
    voice,
  };
}

export function getConfig() {
  return {
    provider: "openai",
    label: "OpenAI TTS",
    voices: VOICES,
    models: MODELS,
    supportsInstructions: true,
    instructionsNote: "Instructions only work with gpt-4o-mini-tts model",
    configured: !!process.env.OPENAI_API_KEY,
  };
}
