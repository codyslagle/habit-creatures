import {
  startOfWeek,
  weekKeyBy,
  lastDayOfMonth,
  dateFromKey,   // new
  dayDiff,       // new (local, whole days)
  weekDiffBy,    // new (whole weeks by weekStart)
  monthDiff,     // new (whole months)
} from "../utils/dates";

/* ===== helpers ===== */
const monthKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Returns true if task t is due today.
 * today: Date (already dev-offset)
 * todayKey: "YYYY-MM-DD" for today
 * wkKey: week key for today (weekStart applied)
 * dayIndex: 0..6 (Sun..Sat)
 * weekStart: 0..6 user preference
 */
export function isDueTodayAdvanced(t, today, todayKey, wkKey, dayIndex, weekStart) {
  // Snooze: hide strictly until the chosen date
  if (t.snoozeUntilKey && todayKey < t.snoozeUntilKey) return false;

  // One-time / Daily
  if (t.frequency === "once")  return !t.doneOnce;
  if (t.frequency === "daily") return t.lastCompletedDayKey !== todayKey;

  // Weekly (optionally pinned to a specific weekday)
  if (t.frequency === "weekly") {
    const onRightDay = (t.weeklyDay == null) ? true : (dayIndex === t.weeklyDay);
    return onRightDay && t.lastCompletedWeekKey !== wkKey;
  }

  // Specific days of week
  if (t.frequency === "days") {
    return (t.daysOfWeek?.includes(dayIndex)) && (t.lastCompletedDayKey !== todayKey);
  }

  // Monthly (fixed day, clamped)
  if (t.frequency === "monthly") {
    const want = t.monthlyDay ?? 1;
    const max  = lastDayOfMonth(today.getFullYear(), today.getMonth());
    const day  = Math.min(want, max);
    if (today.getDate() !== day) return false;
    return t.lastCompletedMonthKey !== monthKey(today);
  }

  // Monthly (last day)
  if (t.frequency === "monthly_last_day") {
    const isLast = today.getDate() === lastDayOfMonth(today.getFullYear(), today.getMonth());
    if (!isLast) return false;
    return t.lastCompletedMonthKey !== monthKey(today);
  }

  // ===== Every X Days =====
  if (t.frequency === "everyXDays" && t.everyX) {
    const baseDate = t.lastCompletedDayKey
      ? dateFromKey(t.lastCompletedDayKey)
      : dateFromKey(t.anchorDayKey || todayKey);

    const diff = dayDiff(today, baseDate); // whole days (today - base)
    // Must not trigger before the anchor/completion reference
    if (diff < 0) return false;

    // Due on day 0, X, 2X... and not already completed today
    return (diff % t.everyX === 0) && (t.lastCompletedDayKey !== todayKey);
  }

  // ===== Every X Weeks =====
  if (t.frequency === "everyXWeeks" && t.everyX) {
    // Week distance is always measured between week starts,
    // but the *weekday* trigger comes from the anchor’s weekday.
    const anchorForDistance = t.lastCompletedWeekKey
      ? dateFromKey(t.lastCompletedWeekKey) // this will be a week-start date
      : dateFromKey(t.anchorDayKey || todayKey);

    const weeksDiff = weekDiffBy(today, anchorForDistance, weekStart);
    if (weeksDiff < 0) return false;

    // Anchor weekday: prefer anchorDayKey if available; otherwise use the distance anchor date
    const anchorWeekday = t.anchorDayKey
      ? dateFromKey(t.anchorDayKey).getDay()
      : anchorForDistance.getDay();

    const onSameWeekday = today.getDay() === anchorWeekday;
    const curWeekKey = weekKeyBy(today, weekStart);

    return (weeksDiff % t.everyX === 0) && onSameWeekday && (t.lastCompletedWeekKey !== curWeekKey);
  }

  // ===== Every X Months =====
  if (t.frequency === "everyXMonths" && t.everyX) {
    // Rebuild a base "anchor-like" date:
    // - If we have lastCompletedMonthKey, reconstruct that YM with the anchor's day (clamped).
    // - Else, use anchorDayKey (or today) directly.
    const anchorDay = t.anchorDayKey ? dateFromKey(t.anchorDayKey).getDate() : dateFromKey(todayKey).getDate();

    const base = t.lastCompletedMonthKey
      ? (() => {
          const [y, m] = t.lastCompletedMonthKey.split("-").map(Number);
          const want = Math.min(anchorDay, lastDayOfMonth(y, (m || 1) - 1));
          return new Date(y, (m || 1) - 1, want);
        })()
      : dateFromKey(t.anchorDayKey || todayKey);

    const mDiff = monthDiff(today, base);
    if (mDiff < 0) return false;

    // Trigger on the anchor’s "day of month", clamped for the *current* month
    const targetDay = Math.min(anchorDay, lastDayOfMonth(today.getFullYear(), today.getMonth()));
    const isTargetDay = today.getDate() === targetDay;

    return (mDiff % t.everyX === 0) && isTargetDay && (t.lastCompletedMonthKey !== monthKey(today));
  }

  // Yearly (clamp to month’s last day)
  if (t.frequency === "yearly") {
    const m = t.yearlyMonth ?? 0;
    const d = t.yearlyDay ?? 1;
    if (today.getMonth() !== m) return false;
    const want = Math.min(d, lastDayOfMonth(today.getFullYear(), today.getMonth()));
    if (today.getDate() !== want) return false;
    return t.lastCompletedYear !== today.getFullYear();
  }

  return false;
}

export const canCompleteNowAdvanced = (t, today, todayKey, wkKey, dayIndex, weekStart) =>
  isDueTodayAdvanced(t, today, todayKey, wkKey, dayIndex, weekStart);
