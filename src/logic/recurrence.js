import {
  startOfWeek,
  weekKeyBy,
  lastDayOfMonth,
} from "../utils/dates";

/* ========= Local, safe date helpers (no timezone shenanigans) ========= */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function sod(d) {
  // start-of-day, local time
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function dayDiff(a, b) {
  // whole-day difference between dates (a - b), both normalized
  return Math.floor((sod(a) - sod(b)) / MS_PER_DAY);
}
function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Returns true if task t is due today.
 * today: Date object representing "now" (can include dev-offset)
 * todayKey: "YYYY-MM-DD" string (already based on dev-offset)
 * wkKey: week key string for current week (based on dev-offset + user weekStart)
 * dayIndex: 0..6 (Sun..Sat) for today's DOW
 * weekStart: 0..6 user's preference for week start day
 */
export function isDueTodayAdvanced(t, today, todayKey, wkKey, dayIndex, weekStart) {
  // Snooze: hidden strictly until the snooze date; on/after that date, normal rules
  if (t.snoozeUntilKey && todayKey < t.snoozeUntilKey) return false;

  // Quick wins
  if (t.frequency === "once")   return !t.doneOnce;
  if (t.frequency === "daily")  return t.lastCompletedDayKey !== todayKey;

  if (t.frequency === "weekly") {
    const onRightDay = (t.weeklyDay == null) ? true : (dayIndex === t.weeklyDay);
    return onRightDay && t.lastCompletedWeekKey !== wkKey;
  }

  if (t.frequency === "days") {
    return t.daysOfWeek?.includes(dayIndex) && t.lastCompletedDayKey !== todayKey;
  }

  // Monthly on specific day (1..31, clamped)
  if (t.frequency === "monthly") {
    const want = t.monthlyDay ?? 1;
    const max = lastDayOfMonth(today.getFullYear(), today.getMonth());
    const day = Math.min(want, max);
    if (today.getDate() !== day) return false;
    const curMonthKey = monthKey(today);
    return t.lastCompletedMonthKey !== curMonthKey;
  }

  // Monthly last day
  if (t.frequency === "monthly_last_day") {
    const isLast = today.getDate() === lastDayOfMonth(today.getFullYear(), today.getMonth());
    if (!isLast) return false;
    const curMonthKey = monthKey(today);
    return t.lastCompletedMonthKey !== curMonthKey;
  }

  // ===== Every X Days / Weeks / Months =====
  // Rule of thumb:
  // - If there's a lastCompleted* value, schedule relative to that completion
  // - Otherwise, schedule relative to anchorDayKey
  // - "Start date = today" *does* count (diff = 0), provided it's not already completed for today/period.

  if (t.frequency === "everyXDays" && t.everyX) {
    const baseDate = t.lastCompletedDayKey
      ? new Date(t.lastCompletedDayKey)
      : new Date(t.anchorDayKey || todayKey);
    const diff = dayDiff(today, baseDate); // whole days from base to today
    // due on day 0, X, 2X, ... and not already completed today
    return (diff % t.everyX === 0) && (t.lastCompletedDayKey !== todayKey);
  }

  if (t.frequency === "everyXWeeks" && t.everyX) {
    // Use completion week start if available; else use anchor's week start.
    const anchor = t.lastCompletedWeekKey
      ? // reconstruct a date from lastCompletedWeekKey's "YYYY-MM-DD"
        new Date(t.lastCompletedWeekKey)
      : new Date(t.anchorDayKey || todayKey);

    const anchorStart = startOfWeek(anchor, weekStart);
    const todayStart  = startOfWeek(today, weekStart);

    const weeksDiff = Math.floor((sod(todayStart) - sod(anchorStart)) / (7 * MS_PER_DAY));
    // Require same weekday as the original anchor date (not week start)
    const anchorDow = new Date(t.anchorDayKey || todayKey).getDay();
    const onSameWeekday = today.getDay() === anchorDow;

    // due on week 0, X, 2X, ... when it's the proper weekday, and not completed this week
    return (weeksDiff % t.everyX === 0) && onSameWeekday && (t.lastCompletedWeekKey !== weekKeyBy(today, weekStart));
  }

  if (t.frequency === "everyXMonths" && t.everyX) {
    // Base schedule on lastCompletedMonthKey if present; else anchor
    const base = t.lastCompletedMonthKey
      ? // reconstruct from "YYYY-MM" by appending day from anchor (or 1)
        (() => {
          const [y, m] = t.lastCompletedMonthKey.split("-").map(Number);
          // Keep the *anchor day* intention when possible
          const anchor = new Date(t.anchorDayKey || todayKey);
          const wantDay = Math.min(anchor.getDate(), lastDayOfMonth(y, m - 1));
          return new Date(y, m - 1, wantDay);
        })()
      : new Date(t.anchorDayKey || todayKey);

    const monthsDiff = (today.getFullYear() - base.getFullYear()) * 12 + (today.getMonth() - base.getMonth());

    // Target day each due month = clamped anchor day (respect end-of-month)
    const targetDay = Math.min(new Date(t.anchorDayKey || todayKey).getDate(), lastDayOfMonth(today.getFullYear(), today.getMonth()));
    const isTargetDay = today.getDate() === targetDay;

    const curMonthKey = monthKey(today);
    // due on month 0, X, 2X, ... and on the target day, and not already completed this month
    return (monthsDiff % t.everyX === 0) && isTargetDay && (t.lastCompletedMonthKey !== curMonthKey);
  }

  if (t.frequency === "yearly") {
    const m = t.yearlyMonth ?? 0;
    const d = t.yearlyDay ?? 1;
    if (today.getMonth() !== m) return false;
    const want = Math.min(d, lastDayOfMonth(today.getFullYear(), today.getMonth()));
    if (today.getDate() !== want) return false;
    const curYear = today.getFullYear();
    return t.lastCompletedYear !== curYear;
  }

  return false;
}

export const canCompleteNowAdvanced = (t, today, todayKey, wkKey, dayIndex, weekStart) =>
  isDueTodayAdvanced(t, today, todayKey, wkKey, dayIndex, weekStart);
