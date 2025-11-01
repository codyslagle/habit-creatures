export const nowISO = () => new Date().toISOString();

/* ========= Core date formatting ========= */
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ========= Parsing (LOCAL, not UTC) ========= */
/** Parse "YYYY-MM-DD" into a local Date (no timezone shift). */
export function dateFromKey(key) {
  if (!key || typeof key !== "string") return new Date();
  const parts = key.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return new Date();
  }
  return new Date(y, (m || 1) - 1, d || 1);
}

/* ========= Basic arithmetic ========= */
export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const addWeeks = (d, n) => addDays(d, 7 * n);

export const lastDayOfMonth = (y, m) => new Date(y, m + 1, 0).getDate();

export function addMonthsClamped(d, n, dayPreference = null) {
  const m = d.getMonth();
  const target = new Date(d);
  target.setMonth(m + n);
  const wantDay = dayPreference ?? d.getDate();
  const maxDay = lastDayOfMonth(target.getFullYear(), target.getMonth());
  target.setDate(Math.min(wantDay, maxDay));
  return target;
}

/* ========= Normalized helpers ========= */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole-day difference (a - b) using local midnights. */
export function dayDiff(a, b) {
  const a0 = startOfDay(a);
  const b0 = startOfDay(b);
  return Math.floor((a0 - b0) / MS_PER_DAY);
}

/* ========= Week helpers ========= */
export const startOfWeek = (d, weekStart = 0) => {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (date.getDay() - weekStart + 7) % 7;
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date;
};

export const weekKeyBy = (d, weekStart = 0) => {
  const s = startOfWeek(d, weekStart);
  return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}-${String(
    s.getDate()
  ).padStart(2, "0")}`;
};

/** Whole-week difference between week starts (a - b). */
export function weekDiffBy(a, b, weekStart = 0) {
  const sa = startOfWeek(a, weekStart);
  const sb = startOfWeek(b, weekStart);
  return Math.floor((sa - sb) / (7 * MS_PER_DAY));
}

/* ========= Month helpers ========= */
/** Month difference (a - b) in whole months. */
export function monthDiff(a, b) {
  return (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());
}

/* ========= Offset helpers ========= */
export const nowWithOffset = (offsetDays = 0) => {
  const d = new Date();
  if (!offsetDays) return d;
  const copy = new Date(d);
  copy.setDate(copy.getDate() + offsetDays);
  return copy;
};

export const todayKeyWithOffset = (offsetDays = 0) =>
  localDateStr(nowWithOffset(offsetDays));

export const weekKeyWithOffset = (offsetDays = 0, weekStart = 0) =>
  weekKeyBy(nowWithOffset(offsetDays), weekStart);
