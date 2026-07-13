import axios from "axios";

const BASE_URL = "https://api.vachana.ai/api/v1";

const VOICES = [
  { id: "Karan", name: "Karan (Male)" },
  { id: "Simran", name: "Simran (Female)" },
  { id: "Nara", name: "Nara (Male)" },
  { id: "Riya", name: "Riya (Female)" },
  { id: "Viraj", name: "Viraj (Male)" },
  { id: "Raju", name: "Raju (Male)" },
];

const LANGUAGES = [
  { id: "hi-IN", name: "Hindi" },
  { id: "en-IN", name: "English (Indian)" },
  { id: "kn-IN", name: "Kannada" },
  { id: "ta-IN", name: "Tamil" },
  { id: "te-IN", name: "Telugu" },
  { id: "mr-IN", name: "Marathi" },
  { id: "ml-IN", name: "Malayalam" },
  { id: "gu-IN", name: "Gujarati" },
  { id: "pa-IN", name: "Punjabi" },
  { id: "bn-IN", name: "Bengali" },
  { id: "od-IN", name: "Odia" },
  { id: "as-IN", name: "Assamese" },
];

const MODELS = ["vachana-voice-v3"];

function getHeaders() {
  if (!process.env.GNANI_API_KEY) throw new Error("GNANI_API_KEY not set");
  return {
    "X-API-Key-ID": process.env.GNANI_API_KEY,
    "Content-Type": "application/json",
  };
}

export async function synthesize({
  text,
  voice = "Karan",
  model = "vachana-voice-v3",
  sampleRate = 22050,
  container = "wav",
}) {
  const outputContainer = "wav";
  const body = {
    audio_config: {
      bitrate: "128k",
      container: outputContainer,
      encoding: "linear_pcm",
      channels: "1",
      sample_rate: String(sampleRate),
      sample_width: "2",
    },
    model,
    text,
    voice,
  };

  const response = await axios.post(`${BASE_URL}/tts/sse`, body, {
    headers: getHeaders(),
    responseType: "text",
    timeout: 60000,
  });

  const audioChunks = [];
  const lines = response.data.split("\n");
  for (const line of lines) {
    if (line.startsWith("data:")) {
      try {
        const data = JSON.parse(line.slice(5).trim());
        if (data.audio_chunk) {
          audioChunks.push(Buffer.from(data.audio_chunk, "base64"));
        } else if (data.audio) {
          audioChunks.push(Buffer.from(data.audio, "base64"));
        }
      } catch {
        // skip non-JSON data lines
      }
    }
  }

  if (audioChunks.length === 0) {
    throw new Error("No audio data received from Gnani.ai SSE response");
  }

  const audioBuffer = normalizeStreamedAudio(audioChunks, outputContainer);

  return {
    audio: audioBuffer,
    contentType: "audio/wav",
    format: outputContainer,
    provider: "gnani",
    model,
    voice,
  };
}

export function getConfig() {
  return {
    provider: "gnani",
    label: "Gnani.ai (Vachana)",
    voices: VOICES,
    models: MODELS,
    languages: LANGUAGES,
    supportsInstructions: false,
    configNote: "For clean browser playback, Gnani output is saved as merged WAV. Voice commands can choose voice/sample settings, but Gnani does not accept free-form tone instructions.",
    extraParams: [
      { key: "sampleRate", label: "Sample Rate", type: "select", options: ["8000", "16000", "22050", "44100"], default: "22050" },
      { key: "container", label: "Audio Format", type: "select", options: ["wav"], default: "wav" },
    ],
    configured: !!process.env.GNANI_API_KEY,
  };
}

function normalizeStreamedAudio(chunks, container) {
  if (container === "wav") return mergeWavChunks(chunks);
  if (container === "mp3") return stripRepeatedId3Tags(chunks);
  return Buffer.concat(chunks);
}

function mergeWavChunks(chunks) {
  const wavParts = chunks.map(parseWavChunk).filter(Boolean);
  if (wavParts.length === 0) return Buffer.concat(chunks);

  const format = wavParts[0].format;
  const data = Buffer.concat(wavParts.map((part) => part.data));
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  format.copy(header, 20, 0, 16);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

function parseWavChunk(buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }

  let offset = 12;
  let format = null;
  let data = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = Math.min(start + size, buffer.length);

    if (id === "fmt " && size >= 16) format = buffer.subarray(start, start + 16);
    if (id === "data") data = buffer.subarray(start, end);

    offset = end + (size % 2);
  }

  return format && data ? { format, data } : null;
}

function stripRepeatedId3Tags(chunks) {
  return Buffer.concat(chunks.map((chunk, index) => (index === 0 ? chunk : stripId3Tag(chunk))));
}

function stripId3Tag(buffer) {
  if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "ID3") return buffer;
  const size =
    ((buffer[6] & 0x7f) << 21) |
    ((buffer[7] & 0x7f) << 14) |
    ((buffer[8] & 0x7f) << 7) |
    (buffer[9] & 0x7f);
  return buffer.subarray(10 + size);
}
