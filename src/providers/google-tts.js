import textToSpeech from "@google-cloud/text-to-speech";

const VOICES = [
  { id: "en-US-Neural2-A", name: "Neural2-A (Male)" },
  { id: "en-US-Neural2-C", name: "Neural2-C (Female)" },
  { id: "en-US-Neural2-D", name: "Neural2-D (Male)" },
  { id: "en-US-Neural2-E", name: "Neural2-E (Female)" },
  { id: "en-US-Neural2-F", name: "Neural2-F (Female)" },
  { id: "en-US-Neural2-G", name: "Neural2-G (Female)" },
  { id: "en-US-Neural2-H", name: "Neural2-H (Female)" },
  { id: "en-US-Neural2-I", name: "Neural2-I (Male)" },
  { id: "en-US-Neural2-J", name: "Neural2-J (Male)" },
  { id: "en-US-Studio-M", name: "Studio-M (Male)" },
  { id: "en-US-Studio-O", name: "Studio-O (Female)" },
  { id: "en-US-Wavenet-A", name: "Wavenet-A (Male)" },
  { id: "en-US-Wavenet-C", name: "Wavenet-C (Female)" },
  { id: "en-US-Wavenet-D", name: "Wavenet-D (Male)" },
  { id: "en-US-Wavenet-F", name: "Wavenet-F (Female)" },
  { id: "en-IN-Neural2-A", name: "Hindi Neural2-A (Female)" },
  { id: "en-IN-Neural2-B", name: "Hindi Neural2-B (Male)" },
  { id: "en-IN-Neural2-C", name: "Hindi Neural2-C (Male)" },
  { id: "en-IN-Neural2-D", name: "Hindi Neural2-D (Female)" },
  { id: "hi-IN-Neural2-A", name: "Hindi-IN Neural2-A (Female)" },
  { id: "hi-IN-Neural2-B", name: "Hindi-IN Neural2-B (Male)" },
  { id: "hi-IN-Neural2-C", name: "Hindi-IN Neural2-C (Male)" },
  { id: "hi-IN-Neural2-D", name: "Hindi-IN Neural2-D (Female)" },
];

const AUDIO_ENCODINGS = ["MP3", "LINEAR16", "OGG_OPUS"];

let client = null;

function getClient() {
  if (!client) {
    client = new textToSpeech.TextToSpeechClient();
  }
  return client;
}

export async function synthesize({ text, voice = "en-US-Neural2-C", encoding = "MP3", speakingRate = 1.0, pitch = 0 }) {
  const ttsClient = getClient();

  const languageCode = voice.split("-").slice(0, 2).join("-");

  const [response] = await ttsClient.synthesizeSpeech({
    input: { text },
    voice: { languageCode, name: voice },
    audioConfig: {
      audioEncoding: encoding,
      speakingRate: parseFloat(speakingRate),
      pitch: parseFloat(pitch),
    },
  });

  const contentTypeMap = { MP3: "audio/mpeg", LINEAR16: "audio/wav", OGG_OPUS: "audio/ogg" };
  const formatMap = { MP3: "mp3", LINEAR16: "wav", OGG_OPUS: "ogg" };

  return {
    audio: Buffer.from(response.audioContent),
    contentType: contentTypeMap[encoding] || "audio/mpeg",
    format: formatMap[encoding] || "mp3",
    provider: "google",
    model: "google-cloud-tts",
    voice,
  };
}

export function getConfig() {
  return {
    provider: "google",
    label: "Google Cloud TTS",
    voices: VOICES,
    models: ["google-cloud-tts"],
    encodings: AUDIO_ENCODINGS,
    supportsInstructions: false,
    extraParams: [
      { key: "speakingRate", label: "Speaking Rate", type: "range", min: 0.25, max: 4.0, step: 0.05, default: 1.0 },
      { key: "pitch", label: "Pitch", type: "range", min: -20, max: 20, step: 0.5, default: 0 },
      { key: "encoding", label: "Audio Encoding", type: "select", options: AUDIO_ENCODINGS, default: "MP3" },
    ],
    configured: !!process.env.GOOGLE_APPLICATION_CREDENTIALS,
  };
}
