import { readFile } from "fs/promises";

const MIME_MAP = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  webm: "audio/webm",
  m4a: "audio/x-m4a",
  mp4: "audio/mp4",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  amr: "audio/amr",
};

export function getMime(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  return MIME_MAP[ext] || "audio/mpeg";
}

export async function fileToBlob(filePath, originalName) {
  const buf = await readFile(filePath);
  return new Blob([buf], { type: getMime(originalName) });
}

// ISO 639-1 code for providers like OpenAI ("hi"), from "hi-IN"
export function toShortLang(lang) {
  if (!lang || lang === "auto" || lang === "unknown") return null;
  return lang.split("-")[0];
}

export function formatSegments(segments) {
  if (!segments || segments.length === 0) return "";
  return segments
    .map((s) => {
      const time = s.start != null ? `[${fmtTime(s.start)}${s.end != null ? "–" + fmtTime(s.end) : ""}] ` : "";
      const speaker = s.speaker != null ? `Speaker ${s.speaker}: ` : "";
      return `${time}${speaker}${s.text}`;
    })
    .join("\n");
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
