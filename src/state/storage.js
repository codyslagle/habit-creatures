import { initialState, SAVE_VERSION, blankTally, blankXPByEl } from "./initial";
import { nowISO, localDateStr } from "../utils/dates";

export const STORAGE_KEY = "hc-state";

/* ---------- small helpers ---------- */
const clampInt = (n, lo, hi, fallback = null) =>
  Number.isInteger(n) ? Math.max(lo, Math.min(hi, n)) : fallback;

const uniqInts0to6 = (arr) => {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  for (const v of arr) {
    if (Number.isInteger(v) && v >= 0 && v <= 6) seen.add(v);
  }
  return Array.from(seen).sort((a, b) => a - b);
};

const toDayKey = (v) => {
  // Accepts YYYY-MM-DD, ISO strings, or Date; returns YYYY-MM-DD
  if (!v) return null;
  try {
    if (typeof v === "string") {
      // Already a YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      // ISO → Date
      const d = new Date(v);
      if (!isNaN(d)) return localDateStr(d);
      return null;
    }
    if (v instanceof Date) return localDateStr(v);
    return null;
  } catch {
    return null;
  }
};

const toMonthKey = (d) => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

/* ---------- task constructors / migration ---------- */
export function newTask({
  title,
  element,
  difficulty,
  frequency,
  weeklyDay,
  daysOfWeek,
  monthlyDay,
  everyX,
  yearlyMonth,
  yearlyDay,
  anchorDayKey
}) {
  const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const normalizedAnchor = toDayKey(anchorDayKey) || localDateStr(new Date());

  return {
    id,
    title: (title || "").trim(),
    element,
    difficulty,
    frequency,

    // normalized/validated recurrence config
    weeklyDay: clampInt(weeklyDay, 0, 6, null),
    daysOfWeek: uniqInts0to6(daysOfWeek),
    monthlyDay: clampInt(monthlyDay, 1, 31, null),
    everyX: Number.isFinite(everyX) && everyX > 0 ? Math.trunc(everyX) : null,
    yearlyMonth: clampInt(yearlyMonth, 0, 11, null),
    yearlyDay: clampInt(yearlyDay, 1, 31, null),

    // anchors & bookkeeping
    createdAtISO: nowISO(),
    anchorDayKey: normalizedAnchor,
    doneOnce: false,
    lastCompletedDayKey: null,
    lastCompletedWeekKey: null,
    lastCompletedMonthKey: null,
    lastCompletedYear: null,
    snoozeUntilKey: null
  };
}

export function migrateTask(t) {
  const merged = { ...t };

  // Normalize recurrence fields
  merged.weeklyDay = clampInt(t.weeklyDay, 0, 6, null);
  merged.daysOfWeek = uniqInts0to6(t.daysOfWeek);
  merged.monthlyDay = clampInt(t.monthlyDay, 1, 31, null);
  merged.everyX = Number.isFinite(t.everyX) && t.everyX > 0 ? Math.trunc(t.everyX) : null;
  merged.yearlyMonth = clampInt(t.yearlyMonth, 0, 11, null);
  merged.yearlyDay = clampInt(t.yearlyDay, 1, 31, null);

  // Normalize keys/anchors to YYYY-MM-DD where applicable
  const createdKey = t.createdAtISO ? toDayKey(t.createdAtISO) : localDateStr(new Date());
  merged.anchorDayKey = toDayKey(t.anchorDayKey) || createdKey;

  merged.lastCompletedDayKey = toDayKey(t.lastCompletedDayKey);
  // week key should remain a YYYY-MM-DD of the week's start; if legacy ISO slipped in, normalize
  merged.lastCompletedWeekKey = toDayKey(t.lastCompletedWeekKey);
  // month key should be YYYY-MM; try to coerce if legacy stored a date
  merged.lastCompletedMonthKey =
    t.lastCompletedMonthKey && /^\d{4}-\d{2}$/.test(t.lastCompletedMonthKey)
      ? t.lastCompletedMonthKey
      : toMonthKey(t.lastCompletedMonthKey) || null;

  merged.lastCompletedYear =
    Number.isInteger(t.lastCompletedYear) && t.lastCompletedYear > 0 ? t.lastCompletedYear : null;

  merged.snoozeUntilKey = toDayKey(t.snoozeUntilKey);

  // Ensure required fields exist
  merged.title = (t.title || "").trim();
  merged.frequency = t.frequency || "daily";

  return merged;
}

/* ---------- state shape & persistence ---------- */
export function withDefaults(s) {
  const base = structuredClone(initialState);

  const next = {
    ...base,
    ...(s || {}),

    meta: {
      ...base.meta,
      ...(s?.meta || {}),
      saveVersion: SAVE_VERSION,

      // keep xp map shape
      xpByElement: { ...base.meta.xpByElement, ...(s?.meta?.xpByElement || {}) },

      // normalized meta flags
      devOffsetDays:
        Number.isInteger(s?.meta?.devOffsetDays) ? s.meta.devOffsetDays : 0,
      weekStartDay: clampInt(s?.meta?.weekStartDay, 0, 6, 0),

      level: Number.isInteger(s?.meta?.level) ? s.meta.level : base.meta.level,
      gems: Number.isFinite(s?.meta?.gems) ? s.meta.gems : 0,
      lastGemAwardDayKey: toDayKey(s?.meta?.lastGemAwardDayKey),

      pokedex: s?.meta?.pokedex && typeof s.meta.pokedex === "object" ? s.meta.pokedex : {}
    }
  };

  // Stable slots (creatures/eggs)
  if (!Array.isArray(s?.stable)) {
    const oldEgg = s?.egg;
    const oldCreature = s?.creature;
    next.stable = [
      {
        egg: oldEgg ? { ...base.stable[0].egg, ...oldEgg, cost: 3 } : base.stable[0].egg,
        creature: oldCreature
          ? {
              ...base.stable[0].creature,
              ...oldCreature,
              xpTotal: oldCreature.xpTotal || 0,
              xpByElement: oldCreature.xpByElement || blankXPByEl()
            }
          : base.stable[0].creature
      }
    ];
  } else {
    next.stable = s.stable.map((slot) => ({
      egg: { ...base.stable[0].egg, ...slot.egg, cost: 3 },
      creature: {
        ...base.stable[0].creature,
        ...slot.creature,
        xpTotal: slot?.creature?.xpTotal || 0,
        xpByElement: slot?.creature?.xpByElement || blankXPByEl()
      }
    }));
  }

  // Active team indices must be valid ints within range
  if (!Array.isArray(s?.activeTeam) || s.activeTeam.length === 0) {
    next.activeTeam = [0];
  } else {
    next.activeTeam = s.activeTeam
      .map((i) => (Number.isInteger(i) ? i : -1))
      .filter((i) => i >= 0 && i < next.stable.length);
    if (next.activeTeam.length === 0) next.activeTeam = [0];
  }

  next.activeIndex = Number.isInteger(s?.activeIndex)
    ? Math.max(0, Math.min(next.activeTeam.length - 1, s.activeIndex))
    : 0;

  // Tasks: migrate + normalize all
  next.tasks = Array.isArray(s?.tasks) ? s.tasks.map(migrateTask) : [];

  return next;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return withDefaults(parsed);
  } catch {
    return null;
  }
}

export const saveState = (s) =>
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
