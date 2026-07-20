import axios from "axios";

const MODELS = [
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-pro-preview-tts",
];

const VOICES = [
  "Kore", "Zephyr", "Puck", "Charon", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
];

// Gemini TTS returns raw 16-bit mono PCM at 24 kHz — wrap it in a WAV header
function pcmToWav(pcmBuffer, sampleRate = 24000, channels = 1, bytesPerSample = 2) {
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bytesPerSample * 8, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

function findBase64Audio(obj, depth = 0) {
  if (!obj || depth > 8) return null;
  if (typeof obj === "string" && obj.length > 1000 && /^[A-Za-z0-9+/=]+$/.test(obj.slice(0, 200))) return obj;
  if (typeof obj !== "object") return null;
  for (const key of ["output_audio", "outputAudio", "audio", "data", "inlineData", "inline_data"]) {
    if (obj[key]) {
      const found = findBase64Audio(obj[key], depth + 1);
      if (found) return found;
    }
  }
  for (const val of Object.values(obj)) {
    const found = findBase64Audio(val, depth + 1);
    if (found) return found;
  }
  return null;
}

async function synthesizeViaInteractions({ text, voice, model, apiKey }) {
  const response = await axios.post(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      model,
      input: text,
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice }] },
    },
    { headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" }, timeout: 120000 }
  );
  const b64 = findBase64Audio(response.data);
  if (!b64) throw new Error(`Gemini Interactions API returned no audio. Keys: ${Object.keys(response.data || {}).join(", ")}`);
  return Buffer.from(b64, "base64");
}

async function synthesizeViaGenerateContent({ text, voice, model, apiKey }) {
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    },
    { headers: { "Content-Type": "application/json" }, timeout: 120000 }
  );
  const b64 = response.data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) throw new Error("Gemini TTS returned no audio data");
  return Buffer.from(b64, "base64");
}

export async function synthesize({ text, voice = "Kore", model = "gemini-3.1-flash-tts-preview" }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  let pcm;
  if (model === "gemini-3.1-flash-tts-preview") {
    try {
      pcm = await synthesizeViaInteractions({ text, voice, model, apiKey });
    } catch (err) {
      // Preview API shape may differ — fall back to generateContent
      console.log(`[gemini-tts] Interactions API failed (${err.response?.status || err.message}), trying generateContent...`);
      pcm = await synthesizeViaGenerateContent({ text, voice, model, apiKey });
    }
  } else {
    pcm = await synthesizeViaGenerateContent({ text, voice, model, apiKey });
  }

  return {
    audio: pcmToWav(pcm),
    contentType: "audio/wav",
    format: "wav",
    provider: "gemini",
    model,
    voice,
  };
}

export function getConfig() {
  return {
    provider: "gemini",
    label: "Google Gemini TTS",
    voices: VOICES,
    models: MODELS,
    supportsInstructions: true,
    instructionsNote: "Steer style with natural language inside the text, e.g. \"Say warmly and slowly: ...\" — 70+ languages incl. Hindi",
    configured: !!process.env.GEMINI_API_KEY,
  };
}
