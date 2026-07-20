// Zahab & Rishabh daily plan lookup: maps a calendar date to the schedule day (1–78)
// and its due tasks. Quarter anchor comes from zahab-plan.json (currently Monday
// 2026-07-20 = Day 1, so 21 Jul = Day 2, per the owner). 6-day weeks — Sundays are
// off (no brief). After Day 78 the 13-week cycle repeats, staying weekday-aligned.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let planCache = null;
export function loadPlan() {
  if (!planCache) {
    planCache = JSON.parse(readFileSync(join(__dirname, "zahab-plan.json"), "utf8"));
  }
  return planCache;
}

// Date parts in Asia/Kolkata regardless of server timezone.
export function istDateParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday, // "Mon".."Sun"
    hhmm: `${parts.hour}:${parts.minute}`,
  };
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Working-day distance from the anchor (counting only Mon–Sat), for an IST calendar date.
export function scheduleForDate(isoDate) {
  const plan = loadPlan();
  const anchor = new Date(plan.quarterAnchor + "T00:00:00Z");
  const target = new Date(isoDate + "T00:00:00Z");
  const diffDays = Math.round((target - anchor) / 86400000);
  if (diffDays < 0) return { off: true, reason: `Schedule starts ${plan.quarterAnchor}` };

  // Anchor is a Monday; within each 7-day block, offset 6 is Sunday.
  if (diffDays % 7 === 6) return { off: true, reason: "Sunday — weekly off, no cleaning brief" };

  const workingDays = Math.floor(diffDays / 7) * 6 + (diffDays % 7);
  const cycle = Math.floor(workingDays / plan.totalDays) + 1;
  const day = (workingDays % plan.totalDays) + 1;
  const dayInWeek = (day - 1) % 6;
  const week = Math.floor((day - 1) / 6) + 1;
  const taskIds = plan.dayTasks[day - 1] || [];
  const tasks = taskIds.map((id) => plan.tasks[id]);
  return {
    off: false,
    date: isoDate,
    day,
    cycle,
    week,
    weekday: WEEKDAYS[dayInWeek],
    tasks,
    totalMinutes: Math.round(tasks.reduce((s, t) => s + (t.timeMinutes || 0), 0) * 10) / 10,
    clientName: plan.clientName,
  };
}
