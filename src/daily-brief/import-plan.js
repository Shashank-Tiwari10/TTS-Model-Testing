// Imports the Zahab & Rishabh 13-week cleaning schedule workbook into zahab-plan.json.
// Run whenever the workbook changes:
//   npm run brief:import                       (uses default Downloads path)
//   npm run brief:import -- "path\to\file.xlsx"
//
// Workbook layout (differs from src/voice-command/excel-parser.js, which expects the
// older template): headers on row 3, data from row 4, day columns I..CH (D1–D78),
// "✓" = task due that day, 0 = subsumed by a deeper clean the same day, blank = not due.
import XLSX from "xlsx";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_SOURCE = "C:\\Users\\legion\\Downloads\\Zahabh & Rishabh House Schedule Work.xlsx";
const HEADER_ROW = 3;   // 1-based
const DAY_COL_START = 9; // 1-based column I = D1
const TOTAL_DAYS = 78;

const source = process.argv[2] || DEFAULT_SOURCE;
const wb = XLSX.readFile(source);
const sheet = wb.Sheets[wb.SheetNames[0]];
const range = XLSX.utils.decode_range(sheet["!ref"]);

const cell = (r, c) => { // 1-based row/col
  const ref = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
  const x = sheet[ref];
  if (!x) return "";
  return x.t === "n" ? x.v : (x.w ?? x.v ?? "");
};

const tasks = [];
const dayTasks = Array.from({ length: TOTAL_DAYS }, () => []);

for (let r = HEADER_ROW + 1; r <= range.e.r + 1; r++) {
  const object = String(cell(r, 3) || "").trim();
  if (!object) continue; // section marker or footer row
  const task = {
    spaceNo: parseInt(cell(r, 1)) || 0,
    spaceName: String(cell(r, 2) || "").trim(),
    object,
    material: String(cell(r, 4) || "").trim(),
    work: String(cell(r, 5) || "").trim(),
    phase: String(cell(r, 6) || "").trim(),
    freq: Math.round(parseFloat(cell(r, 7)) || 1),
    timeMinutes: parseFloat(cell(r, 8)) || 0,
  };
  const id = tasks.length;
  tasks.push(task);
  for (let d = 0; d < TOTAL_DAYS; d++) {
    if (cell(r, DAY_COL_START + d) === "✓") dayTasks[d].push(id);
  }
}

const out = {
  client: "zahab_rishabh",
  clientName: "Zahab and Rishabh",
  source,
  importedAt: new Date().toISOString(),
  quarterAnchor: "2026-06-01", // Day 1 = Monday 1 June 2026; 6-day weeks, Sundays off
  totalDays: TOTAL_DAYS,
  tasks,
  dayTasks,
};

writeFileSync(join(__dirname, "zahab-plan.json"), JSON.stringify(out));
const perDay = dayTasks.map((ids) => ids.length);
console.log(`Imported ${tasks.length} tasks from: ${source}`);
console.log(`Day task counts: min ${Math.min(...perDay)}, max ${Math.max(...perDay)}, day1 ${perDay[0]}`);
