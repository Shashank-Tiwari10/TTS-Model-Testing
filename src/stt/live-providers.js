import WebSocket from "ws";
import axios from "axios";
import sdk from "microsoft-cognitiveservices-speech-sdk";

// Every adapter returns: { sendAudio(buffer), flush(), close() }
// and emits via callbacks: onReady(), onTranscript({ text, speaker, final }), onError(msg), onClose()
// All adapters expect 16 kHz, 16-bit, mono PCM from the browser.

function shortLang(language) {
  if (!language || language === "auto" || language === "unknown") return null;
  return language.split("-")[0];
}

// ---------- Deepgram (Nova-3) — live diarization ----------
function createDeepgram({ language }, cb) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY not set");
  const lang = shortLang(language);
  const params = new URLSearchParams({
    model: "nova-3",
    diarize: "true",
    smart_format: "true",
    interim_results: "true",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
  });
  params.set("language", lang || "multi");
  const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
    headers: { Authorization: `Token ${key}` },
  });
  socket.on("open", cb.onReady);
  socket.on("message", (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type !== "Results") return;
    const alt = msg.channel?.alternatives?.[0];
    if (!alt || !alt.transcript) return;
    const speaker = alt.words?.[0]?.speaker;
    cb.onTranscript({ text: alt.transcript, speaker: speaker != null ? String(speaker) : null, final: Boolean(msg.is_final) });
  });
  socket.on("error", (e) => cb.onError(`Deepgram: ${e.message}`));
  socket.on("close", cb.onClose);
  return {
    sendAudio: (buf) => socket.readyState === WebSocket.OPEN && socket.send(buf),
    flush: () => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "Finalize" })),
    close: () => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "CloseStream" }));
      setTimeout(() => socket.close(), 500);
    },
  };
}

// ---------- AssemblyAI (Universal-Streaming v3) — English-optimised, no live diarization ----------
function createAssemblyAI(_opts, cb) {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error("ASSEMBLYAI_API_KEY not set");
  const params = new URLSearchParams({ sample_rate: "16000", format_turns: "true" });
  const socket = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params}`, {
    headers: { Authorization: key },
  });
  socket.on("open", cb.onReady);
  socket.on("message", (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "Turn" && msg.transcript) {
      cb.onTranscript({ text: msg.transcript, speaker: null, final: Boolean(msg.end_of_turn) });
    }
  });
  socket.on("error", (e) => cb.onError(`AssemblyAI: ${e.message}`));
  socket.on("close", cb.onClose);
  return {
    sendAudio: (buf) => socket.readyState === WebSocket.OPEN && socket.send(buf),
    flush: () => {},
    close: () => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "Terminate" }));
      setTimeout(() => socket.close(), 500);
    },
  };
}

// ---------- Speechmatics Real-Time — live speaker diarization ----------
function createSpeechmatics({ language }, cb) {
  const key = process.env.SPEECHMATICS_API_KEY;
  if (!key) throw new Error("SPEECHMATICS_API_KEY not set");
  const socket = new WebSocket("wss://eu2.rt.speechmatics.com/v2", {
    headers: { Authorization: `Bearer ${key}` },
  });
  let seq = 0;
  socket.on("open", () => {
    socket.send(JSON.stringify({
      message: "StartRecognition",
      audio_format: { type: "raw", encoding: "pcm_s16le", sample_rate: 16000 },
      transcription_config: {
        language: shortLang(language) || "hi",
        operating_point: "enhanced",
        diarization: "speaker",
        enable_partials: true,
        max_delay: 2,
      },
    }));
  });
  socket.on("message", (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.message === "RecognitionStarted") { cb.onReady(); return; }
    if (msg.message === "Error") { cb.onError(`Speechmatics: ${msg.reason || msg.type}`); return; }
    if (msg.message === "AddTranscript" || msg.message === "AddPartialTranscript") {
      const results = msg.results || [];
      if (results.length === 0) return;
      // Group consecutive words by speaker within this message
      let current = null;
      const groups = [];
      for (const r of results) {
        const word = r.alternatives?.[0];
        if (!word) continue;
        const spk = word.speaker && word.speaker !== "UU" ? word.speaker.replace(/^S/, "") : null;
        if (!current || current.speaker !== spk) {
          if (current) groups.push(current);
          current = { speaker: spk, text: word.content };
        } else {
          current.text += (r.type === "punctuation" ? "" : " ") + word.content;
        }
      }
      if (current) groups.push(current);
      for (const g of groups) {
        cb.onTranscript({ text: g.text, speaker: g.speaker, final: msg.message === "AddTranscript" });
      }
    }
  });
  socket.on("error", (e) => cb.onError(`Speechmatics: ${e.message}`));
  socket.on("close", cb.onClose);
  return {
    sendAudio: (buf) => { if (socket.readyState === WebSocket.OPEN) { socket.send(buf); seq++; } },
    flush: () => {},
    close: () => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ message: "EndOfStream", last_seq_no: seq }));
      setTimeout(() => socket.close(), 1500);
    },
  };
}

// ---------- Gladia (Solaria) — live diarization + Hindi/English code-switching ----------
async function createGladia({ language }, cb) {
  const key = process.env.GLADIA_API_KEY;
  if (!key) throw new Error("GLADIA_API_KEY not set");
  const lang = shortLang(language);
  const init = await axios.post("https://api.gladia.io/v2/live", {
    encoding: "wav/pcm",
    sample_rate: 16000,
    bit_depth: 16,
    channels: 1,
    language_config: { languages: lang ? [lang, "en"] : [], code_switching: true },
    realtime_processing: {},
    pre_processing: { speech_threshold: 0.6 },
    messages_config: { receive_partial_transcripts: true, receive_final_transcripts: true },
    ...(true ? { diarization: true } : {}),
  }, { headers: { "x-gladia-key": key, "Content-Type": "application/json" }, timeout: 30000 }).catch(async (err) => {
    // diarization flag may be rejected on some plans — retry without it
    if (err.response?.status === 400) {
      return axios.post("https://api.gladia.io/v2/live", {
        encoding: "wav/pcm", sample_rate: 16000, bit_depth: 16, channels: 1,
        language_config: { languages: lang ? [lang, "en"] : [], code_switching: true },
      }, { headers: { "x-gladia-key": key, "Content-Type": "application/json" }, timeout: 30000 });
    }
    throw err;
  });
  const socket = new WebSocket(init.data.url);
  socket.on("open", cb.onReady);
  socket.on("message", (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "transcript" && msg.data?.utterance?.text) {
      const spk = msg.data.utterance.speaker;
      cb.onTranscript({
        text: msg.data.utterance.text.trim(),
        speaker: spk != null ? String(spk) : null,
        final: Boolean(msg.data.is_final),
      });
    }
    if (msg.type === "error") cb.onError(`Gladia: ${JSON.stringify(msg.data || msg).slice(0, 150)}`);
  });
  socket.on("error", (e) => cb.onError(`Gladia: ${e.message}`));
  socket.on("close", cb.onClose);
  return {
    sendAudio: (buf) => socket.readyState === WebSocket.OPEN && socket.send(buf),
    flush: () => {},
    close: () => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop_recording" }));
      setTimeout(() => socket.close(), 1000);
    },
  };
}

// ---------- Azure ConversationTranscriber — live diarization, uses existing AZURE_SPEECH_KEY ----------
function createAzureLive({ language }, cb) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = (process.env.AZURE_SPEECH_REGION || "CentralIndia").toLowerCase().replace(/\s+/g, "");
  if (!key) throw new Error("AZURE_SPEECH_KEY not set");

  // "unknown" is a valid auto-detect value for some other STT providers, but
  // it is not a valid Azure Speech locale. Passing it makes the SDK's service
  // WebSocket close with the otherwise unhelpful 1006 error.
  const isAuto = !language || ["auto", "unknown"].includes(language);
  const azureLanguage = isAuto ? "hi-IN" : language;

  const pushStream = sdk.AudioInputStream.createPushStream(sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1));
  const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
  const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);

  let transcriber;
  if (isAuto) {
    // Continuous language identification: Hindi stays in Devanagari, English stays
    // in Latin script — instead of locking to hi-IN which transliterates everything.
    speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous");
    const autoDetect = sdk.AutoDetectSourceLanguageConfig.fromLanguages(["hi-IN", "en-IN"]);
    transcriber = typeof sdk.ConversationTranscriber.FromConfig === "function"
      ? sdk.ConversationTranscriber.FromConfig(speechConfig, autoDetect, audioConfig)
      : (speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_AutoDetectSourceLanguages, "hi-IN,en-IN"),
         new sdk.ConversationTranscriber(speechConfig, audioConfig));
  } else {
    speechConfig.speechRecognitionLanguage = azureLanguage;
    transcriber = new sdk.ConversationTranscriber(speechConfig, audioConfig);
  }

  transcriber.transcribing = (_s, e) => {
    if (e.result.text) cb.onTranscript({ text: e.result.text, speaker: normalizeAzureSpeaker(e.result.speakerId), final: false });
  };
  transcriber.transcribed = (_s, e) => {
    if (e.result.text) cb.onTranscript({ text: e.result.text, speaker: normalizeAzureSpeaker(e.result.speakerId), final: true });
  };
  transcriber.canceled = (_s, e) => cb.onError(`Azure live (${region}, ${azureLanguage}): ${e.errorDetails || e.reason}`);
  transcriber.sessionStopped = () => cb.onClose();
  transcriber.startTranscribingAsync(() => cb.onReady(), (err) => cb.onError(`Azure live: ${err}`));

  return {
    sendAudio: (buf) => pushStream.write(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf),
    flush: () => {},
    close: () => {
      transcriber.stopTranscribingAsync(() => {
        pushStream.close();
        transcriber.close();
      }, () => {});
    },
  };
}

function normalizeAzureSpeaker(speakerId) {
  if (!speakerId || speakerId === "Unknown") return null;
  return String(speakerId).replace(/^Guest-?/i, "");
}

export const LIVE_PROVIDERS = {
  deepgram: {
    label: "Deepgram Nova-3",
    create: createDeepgram,
    envKey: "DEEPGRAM_API_KEY",
    diarization: true,
    notes: "Best-in-class live streaming with word-level speaker diarization. 'multi' language mode handles Hindi-English code-switching.",
  },
  speechmatics: {
    label: "Speechmatics Real-Time",
    create: createSpeechmatics,
    envKey: "SPEECHMATICS_API_KEY",
    diarization: true,
    notes: "Strongest live speaker diarization accuracy. Hindi supported (enhanced operating point).",
  },
  gladia: {
    label: "Gladia Solaria Live",
    create: createGladia,
    envKey: "GLADIA_API_KEY",
    diarization: true,
    notes: "Live diarization with Hindi-English code-switching — good for Hinglish interviews.",
  },
  azurelive: {
    label: "Azure ConversationTranscriber",
    create: createAzureLive,
    envKey: "AZURE_SPEECH_KEY",
    diarization: true,
    notes: "Real-time speaker diarization using your existing Azure key — works today, no new key needed.",
  },
  assemblyai: {
    label: "AssemblyAI Universal-Streaming",
    create: createAssemblyAI,
    envKey: "ASSEMBLYAI_API_KEY",
    diarization: false,
    notes: "Ultra-low-latency streaming (~300ms). English-optimised; no speaker labels in live mode.",
  },
};

export function getLiveProviderList() {
  const list = [
    // The two already wired directly in the relay
    { key: "sarvam", label: "Sarvam Saaras v3 Live", configured: Boolean(process.env.SARVAM_API_KEY), diarization: false, envKey: "SARVAM_API_KEY", notes: "Indian languages, live transcribe + translate. Speakers added after stop via Sarvam Batch." },
    { key: "openai", label: "OpenAI Realtime (gpt-realtime-whisper)", configured: Boolean(process.env.OPENAI_API_KEY), diarization: false, envKey: "OPENAI_API_KEY", notes: "Live streaming Whisper. Speakers added after stop via batch diarization." },
  ];
  for (const [key, p] of Object.entries(LIVE_PROVIDERS)) {
    list.push({ key, label: p.label, configured: Boolean(process.env[p.envKey]), diarization: p.diarization, envKey: p.envKey, notes: p.notes });
  }
  return list;
}
