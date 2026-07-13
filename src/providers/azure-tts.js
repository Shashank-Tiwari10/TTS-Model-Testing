import * as sdk from "microsoft-cognitiveservices-speech-sdk";

const VOICES = [
  { id: "hi-IN-SwaraNeural", name: "Swara (Female, Hindi)" },
  { id: "hi-IN-MadhurNeural", name: "Madhur (Male, Hindi)" },
  { id: "en-IN-NeerjaNeural", name: "Neerja (Female, Indian English)" },
  { id: "en-IN-PrabhatNeural", name: "Prabhat (Male, Indian English)" },
  { id: "en-US-JennyNeural", name: "Jenny (Female, US English)" },
  { id: "en-US-GuyNeural", name: "Guy (Male, US English)" },
  { id: "en-US-AriaNeural", name: "Aria (Female, US English)" },
  { id: "en-US-DavisNeural", name: "Davis (Male, US English)" },
  { id: "en-US-AmberNeural", name: "Amber (Female, US English)" },
  { id: "en-US-AnaNeural", name: "Ana (Female, Child)" },
  { id: "en-US-AndrewNeural", name: "Andrew (Male, US English)" },
  { id: "en-US-EmmaNeural", name: "Emma (Female, US English)" },
  { id: "en-US-BrianNeural", name: "Brian (Male, US English)" },
  { id: "en-US-ChristopherNeural", name: "Christopher (Male, US English)" },
  { id: "en-US-EricNeural", name: "Eric (Male, US English)" },
  { id: "en-US-MichelleNeural", name: "Michelle (Female, US English)" },
  { id: "en-US-RogerNeural", name: "Roger (Male, US English)" },
];

const STYLES = ["default", "cheerful", "sad", "angry", "excited", "friendly", "hopeful", "shouting", "whispering", "terrified"];

function getLangFromVoice(voiceId) {
  const match = voiceId.match(/^([a-z]{2}-[A-Z]{2})/);
  return match ? match[1] : "en-US";
}

export async function synthesize({ text, voice = "hi-IN-SwaraNeural", style = "default", rate = "0%", pitch = "0%" }) {
  if (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION) {
    throw new Error("AZURE_SPEECH_KEY and AZURE_SPEECH_REGION must be set");
  }

  const speechConfig = sdk.SpeechConfig.fromSubscription(
    process.env.AZURE_SPEECH_KEY,
    process.env.AZURE_SPEECH_REGION
  );
  speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

  const lang = getLangFromVoice(voice);
  const ssml = buildSSML(text, voice, style, rate, pitch, lang);

  return new Promise((resolve, reject) => {
    const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

    synthesizer.speakSsmlAsync(
      ssml,
      (result) => {
        synthesizer.close();
        if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
          resolve({
            audio: Buffer.from(result.audioData),
            contentType: "audio/mpeg",
            format: "mp3",
            provider: "azure",
            model: "azure-neural",
            voice,
          });
        } else {
          reject(new Error(`Azure TTS failed: ${result.errorDetails || "Unknown error"}`));
        }
      },
      (err) => {
        synthesizer.close();
        reject(err);
      }
    );
  });
}

function buildSSML(text, voice, style, rate, pitch, lang) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let inner = `<prosody rate="${rate}" pitch="${pitch}">${escaped}</prosody>`;
  if (style !== "default") {
    inner = `<mstts:express-as style="${style}">${inner}</mstts:express-as>`;
  }
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${lang}">
  <voice name="${voice}">${inner}</voice>
</speak>`;
}

export function getConfig() {
  return {
    provider: "azure",
    label: "Azure Speech",
    voices: VOICES,
    models: ["azure-neural"],
    styles: STYLES,
    supportsInstructions: false,
    extraParams: [
      { key: "style", label: "Speaking Style", type: "select", options: STYLES, default: "default" },
      { key: "rate", label: "Rate", type: "select", options: ["-50%", "-25%", "0%", "+25%", "+50%", "+100%"], default: "0%" },
      { key: "pitch", label: "Pitch", type: "select", options: ["-50%", "-25%", "0%", "+25%", "+50%"], default: "0%" },
    ],
    configured: !!(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION),
  };
}
