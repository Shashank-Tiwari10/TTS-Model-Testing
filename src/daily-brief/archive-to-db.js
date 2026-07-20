// Archives every brief's COMMAND DRAFT + TRANSLATIONS (text only, no audio) into the
// database repo clone given as argv[2] — permanent record, never pruned (the main repo
// keeps only the newest 30 briefs). Layout in the DB repo:
//   zahab/<date>_day-<NN>/{english.txt, hindi-roman.txt, hindi-devanagari.txt, meta.json}
//   index.csv — one row per brief (rebuilt on every run)
// Used by the nightly GitHub Action; run locally with:
//   node src/daily-brief/archive-to-db.js <path-to-Zahab-Brief-Database-clone>
import { readdirSync, existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { BRIEFS_DIR } from "./generate.js";

const dbRoot = process.argv[2];
if (!dbRoot || !existsSync(dbRoot)) {
  console.error("Usage: node archive-to-db.js <path-to-database-repo-clone>");
  process.exit(1);
}

const clientDir = join(dbRoot, "zahab");
mkdirSync(clientDir, { recursive: true });

const TEXT_FILES = ["english.txt", "hindi-roman.txt", "hindi-devanagari.txt", "meta.json"];
let copied = 0;
if (existsSync(BRIEFS_DIR)) {
  for (const id of readdirSync(BRIEFS_DIR)) {
    const src = join(BRIEFS_DIR, id);
    if (!existsSync(join(src, "meta.json"))) continue;
    const dst = join(clientDir, id);
    mkdirSync(dst, { recursive: true });
    for (const f of TEXT_FILES) {
      if (existsSync(join(src, f))) copyFileSync(join(src, f), join(dst, f));
    }
    copied++;
  }
}

// Rebuild index.csv from every archived meta.json (old + newly copied).
const rows = [];
for (const id of readdirSync(clientDir).sort()) {
  const metaPath = join(clientDir, id, "meta.json");
  if (!existsSync(metaPath)) continue;
  const m = JSON.parse(readFileSync(metaPath, "utf8"));
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  rows.push([m.date, m.day, m.weekday, m.week, m.cycle, m.totalTasks, m.totalMinutes,
    m.voice, m.translateModel, m.generatedAt, m.sent?.email?.ok ? "sent" : "no"].map(esc).join(","));
}
writeFileSync(
  join(dbRoot, "index.csv"),
  "date,day,weekday,week,cycle,total_tasks,total_minutes,voice,translate_model,generated_at,email\n" + rows.join("\n") + "\n"
);
console.log(`Archived ${copied} brief(s); index.csv now has ${rows.length} row(s).`);
