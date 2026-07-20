import XLSX from "xlsx";
import { readFileSync } from "fs";

const HEADER_ROW = 5;
const DATA_START_ROW = 7;
const DAY_COL_START = 9;

const SECTION_MARKERS = [
  "DAILY", "EVERY 2 DAYS", "EVERY 3 DAYS", "EVERY 4 DAYS",
  "WEEKLY", "EVERY 8 DAYS", "FORTNIGHTLY", "EVERY 15 DAYS",
  "EVERY 18 DAYS", "EVERY 24 DAYS", "EVERY 28 DAYS", "MONTHLY",
  "EVERY 36 DAYS", "EVERY 48 DAYS", "EVERY 54 DAYS", "EVERY 72 DAYS",
  "QUARTERLY", "TOTAL MIN", "EFFECTIVE MIN", "ACTIVE TASKS",
  "TIME SAVED", "DELTA"
];

function isSectionMarker(val) {
  if (!val && val !== 0) return false;
  const str = String(val).toUpperCase();
  return SECTION_MARKERS.some(m => str.includes(m));
}

export function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet["!ref"]);

  const totalDays = range.e.c - DAY_COL_START + 2;

  const tasks = [];

  for (let r = DATA_START_ROW - 1; r <= range.e.r; r++) {
    const colA = getCellValue(sheet, r, 0);
    if (isSectionMarker(colA)) continue;
    if (colA === "" || colA === undefined || colA === null) {
      const colB = getCellValue(sheet, r, 1);
      if (!colB) continue;
    }

    const spaceName = String(getCellValue(sheet, r, 1) || "").trim();
    if (!spaceName) continue;

    const spaceNo = getCellValue(sheet, r, 0);
    if (spaceNo !== "" && spaceNo !== undefined && spaceNo !== null && isNaN(parseInt(spaceNo))) continue;

    const object = String(getCellValue(sheet, r, 2) || "").trim();
    const material = String(getCellValue(sheet, r, 3) || "").trim();
    const work = String(getCellValue(sheet, r, 4) || "").trim();
    const phase = String(getCellValue(sheet, r, 5) || "").trim();
    const freq = parseInt(getCellValue(sheet, r, 6)) || 1;
    const timeInst = String(getCellValue(sheet, r, 7) || "").trim();

    const dayMarks = {};
    for (let d = 0; d < totalDays && d < 78; d++) {
      const colIdx = DAY_COL_START - 1 + d;
      const val = getCellValue(sheet, r, colIdx);
      if (val === "✓" || val === "✔" || val === "1" || val === 1) {
        dayMarks[d + 1] = "tick";
      } else if (val === "0" || val === 0) {
        dayMarks[d + 1] = "zero";
      }
    }

    tasks.push({
      row: r + 1,
      spaceNo: parseInt(spaceNo) || 0,
      spaceName,
      object,
      material,
      work,
      phase,
      freq,
      timeMinutes: parseFloat(timeInst) || 0,
      dayMarks,
      isDaily: freq === 1,
    });
  }

  return { tasks, totalDays: Math.min(totalDays, 78), sheetName };
}

export function getTasksForDay(allTasks, dayNumber) {
  return allTasks.filter(t => {
    const mark = t.dayMarks[dayNumber];
    return mark === "tick";
  });
}

export function getDayInfo(dayNumber) {
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekdayIndex = (dayNumber - 1) % 6;
  const weekNumber = Math.floor((dayNumber - 1) / 6) + 1;
  return {
    day: dayNumber,
    weekday: weekdays[weekdayIndex],
    week: weekNumber,
    month: Math.ceil(weekNumber / 4.33),
  };
}

function getCellValue(sheet, r, c) {
  const addr = XLSX.utils.encode_cell({ r, c });
  const cell = sheet[addr];
  if (!cell) return "";
  if (cell.t === "n") return cell.v;
  return cell.w || cell.v || "";
}
