import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";

const VOICES = [
  { id: "Joanna", name: "Joanna (Female, US English)" },
  { id: "Matthew", name: "Matthew (Male, US English)" },
  { id: "Danielle", name: "Danielle (Female, US English)" },
  { id: "Stephen", name: "Stephen (Male, US English)" },
  { id: "Amy", name: "Amy (Female, British English)" },
  { id: "Brian", name: "Brian (Male, British English)" },
  { id: "Aditi", name: "Aditi (Female, Indian English/Hindi)" },
  { id: "Kajal", name: "Kajal (Female, Indian English/Hindi)" },
  { id: "Aria", name: "Aria (Female, New Zealand English)" },
  { id: "Olivia", name: "Olivia (Female, Australian English)" },
];

const ENGINES = ["neural", "standard"];
const OUTPUT_FORMATS = ["mp3", "ogg_vorbis", "pcm"];
const SAMPLE_RATES = ["8000", "16000", "22050", "24000"];

function hasExplicitCredentials() {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION)
  );
}

function getClient() {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  return new PollyClient({
    region,
    credentials: hasExplicitCredentials()
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  });
}

export async function synthesize({
  text,
  voice = "Joanna",
  engine = "neural",
  outputFormat = "mp3",
  sampleRate = "24000",
}) {
  if (!hasExplicitCredentials()) {
    throw new Error("AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION must be set");
  }

  const format = OUTPUT_FORMATS.includes(outputFormat) ? outputFormat : "mp3";
  const command = new SynthesizeSpeechCommand({
    Text: text,
    TextType: "text",
    VoiceId: voice,
    Engine: ENGINES.includes(engine) ? engine : "neural",
    OutputFormat: format,
    SampleRate: sampleRate,
  });

  const response = await getClient().send(command);
  const chunks = [];
  for await (const chunk of response.AudioStream) {
    chunks.push(Buffer.from(chunk));
  }

  const formatMap = {
    mp3: { ext: "mp3", contentType: "audio/mpeg" },
    ogg_vorbis: { ext: "ogg", contentType: "audio/ogg" },
    pcm: { ext: "pcm", contentType: "audio/L16" },
  };

  return {
    audio: Buffer.concat(chunks),
    contentType: formatMap[format].contentType,
    format: formatMap[format].ext,
    provider: "aws",
    model: `polly-${engine}`,
    voice,
  };
}

export function getConfig() {
  return {
    provider: "aws",
    label: "AWS Polly",
    voices: VOICES,
    models: ["polly-neural", "polly-standard"],
    supportsInstructions: false,
    extraParams: [
      { key: "engine", label: "Engine", type: "select", options: ENGINES, default: "neural" },
      { key: "outputFormat", label: "Audio Format", type: "select", options: OUTPUT_FORMATS, optionLabels: ["MP3", "OGG Vorbis", "PCM"], default: "mp3" },
      { key: "sampleRate", label: "Sample Rate", type: "select", options: SAMPLE_RATES, default: "24000" },
    ],
    configured: hasExplicitCredentials(),
    configNote: "Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION for Amazon Polly.",
  };
}
