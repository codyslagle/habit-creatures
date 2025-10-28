import { useEffect, useMemo, useState } from "react";
import { loadDexFromCSV, ELEMENTS } from "./data/csvDexLoader";

/* ===================== Helpers & Constants ===================== */

const blankTally = () => ({ fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 });
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const caps = (arr) => arr.map(cap).join(" / ");
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const nowISO = () => new Date().toISOString();
const pluralize = (n, one, many) => (n === 1 ? one : many);
const totalCost = (ev) => Object.values(ev.cost || {}).reduce((a,b)=>a+(b||0), 0);
const canAfford = (candies, cost) =>
  Object.entries(cost || {}).every(([el, amt]) => (candies[el] || 0) >= amt);
const formatCost = (cost) => {
  const parts = Object.entries(cost || {})
    .filter(([,amt]) => amt > 0)
    .map(([el,amt]) => `${amt} ${cap(el)}`);
  return parts.length ? parts.join(" + ") : "—";
};

// Element labels for dropdown
const ELEMENT_LABEL = {
  fire: "Fire (Fitness)",
  water: "Water (Self-Care)",
  earth: "Earth (Chores)",
  air: "Air (Learning)",
  light: "Light (Creativity)",
  metal: "Metal (Work/Productivity)",
  heart: "Heart (Social)"
};

// Subtle badge background per element
const ELEMENT_BADGE_BG = {
  fire:  "rgba(255, 99, 71, 0.18)",
  water: "rgba(80, 160, 255, 0.18)",
  earth: "rgba(120, 180, 120, 0.20)",
  air:   "rgba(180, 220, 255, 0.18)",
  light: "rgba(255, 240, 150, 0.18)",
  metal: "rgba(180, 180, 200, 0.20)",
  heart: "rgba(255, 150, 200, 0.18)",
};

// XP per difficulty
const XP_BY_DIFFICULTY = { easy: 5, med: 10, hard: 20 };

// Level curve
function levelFromXP(xp) {
  return Math.max(1, Math.floor((xp || 0) / 100) + 1);
}
function nextLevelAt(level) {
  return level * 100;
}

// Date helpers
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Week math with custom start (0=Sun..6=Sat)
function startOfWeek(d, weekStart=0) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay();
  const diff = (day - weekStart + 7) % 7;
  date.setDate(date.getDate() - diff);
  date.setHours(0,0,0,0);
  return date;
}
function weekKeyBy(d, weekStart=0) {
  const s = startOfWeek(d, weekStart);
  return `${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,"0")}-${String(s.getDate()).padStart(2,"0")}`;
}

// For “Specific Days” frequency UI
const DAY_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

/* ===================== Save & Migration ===================== */

const SAVE_VERSION = 4;
const STORAGE_KEY = "hc-state";

const initialState = {
  candies: { fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 },

  // NEW: multi-slot creature storage
  stable: [
    {
      egg: { progress: 0, cost: 5, element: null, tally: blankTally() },
      creature: { speciesId: null, nickname: null, happiness: null }
    }
  ],
  activeIndex: 0,

  tasks: [], // see newTask()

  meta: {
    lastSeenISO: null,
    saveVersion: SAVE_VERSION,
    lastActionLocalDate: null,
    streak: 0,
    xpTotal: 0,
    xpByElement: { fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 },
    devOffsetDays: 0,
    weekStartDay: 0, // user preference: 0=Sun .. 6=Sat
    level: 1
  }
};

function withDefaults(s) {
  const base = structuredClone(initialState);
  const next = {
    ...base,
    ...(s || {}),
    meta: {
      ...base.meta,
      ...(s?.meta || {}),
      saveVersion: SAVE_VERSION,
      xpByElement: { ...base.meta.xpByElement, ...(s?.meta?.xpByElement || {}) },
      devOffsetDays: s?.meta?.devOffsetDays || 0,
      weekStartDay: (s?.meta?.weekStartDay ?? 0),
      level: s?.meta?.level ?? base.meta.level
    }
  };

  // MIGRATION: if old single egg/creature existed, move to stable[0]
  if (!Array.isArray(s?.stable)) {
    const oldEgg = s?.egg;
    const oldCreature = s?.creature;
    next.stable = [
      {
        egg: oldEgg ? { ...base.stable[0].egg, ...oldEgg } : base.stable[0].egg,
        creature: oldCreature ? { ...base.stable[0].creature, ...oldCreature } : base.stable[0].creature
      }
    ];
    next.activeIndex = 0;
  } else {
    next.stable = s.stable;
    next.activeIndex = s.activeIndex ?? 0;
  }

  // Tasks
  next.tasks = Array.isArray(s?.tasks) ? s.tasks.map(migrateTask) : [];

  return next;
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return withDefaults(parsed);
  } catch {
    return null;
  }
}
function saveState(s) { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }

/* ===================== Time (with Dev Offset) ===================== */

function nowWithOffset(offsetDays=0) {
  const d = new Date();
  if (offsetDays) { const copy = new Date(d); copy.setDate(copy.getDate()+offsetDays); return copy; }
  return d;
}
function todayKeyWithOffset(offsetDays=0) {
  return localDateStr(nowWithOffset(offsetDays));
}
function weekKeyWithOffset(offsetDays=0, weekStart=0) {
  return weekKeyBy(nowWithOffset(offsetDays), weekStart);
}

/* ===================== Hatching ===================== */

function pickDominantElement(availableCandies, validElements) {
  const counts = validElements.map(e => ({ e, n: (availableCandies?.[e] || 0) }));
  counts.sort((a,b)=>b.n-a.n);
  const top = counts[0];
  if (!top || top.n === 0) return null;
  const ties = counts.filter(c => c.n === top.n).map(c=>c.e);
  return ties[Math.floor(Math.random()*ties.length)];
}

/* ===================== Tasks ===================== */

// frequency: 'once' | 'daily' | 'weekly' | 'days' (specific days)
// weeklyDay: 0..6 optional for 'weekly'; if null → any day that week
// daysOfWeek: array of 0..6 used for 'days'
function newTask({ title, element, difficulty, frequency, weeklyDay, daysOfWeek }) {
  const id = `task_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  return {
    id,
    title: (title || "").trim(),
    element,
    difficulty,
    frequency,
    weeklyDay: (typeof weeklyDay === "number" ? weeklyDay : null),
    daysOfWeek: Array.isArray(daysOfWeek) ? daysOfWeek : [],
    createdAtISO: nowISO(),
    doneOnce: false,
    lastCompletedDayKey: null,
    lastCompletedWeekKey: null
  };
}
function migrateTask(t) {
  return {
    weeklyDay: (typeof t.weeklyDay === "number" ? t.weeklyDay : null),
    daysOfWeek: Array.isArray(t.daysOfWeek) ? t.daysOfWeek : [],
    ...t
  };
}

// Allowed to complete now?
function canCompleteTaskNow(t, todayKey, wkKey, dayIndex) {
  if (t.frequency === "once")   return !t.doneOnce;
  if (t.frequency === "daily")  return t.lastCompletedDayKey !== todayKey;
  if (t.frequency === "weekly") {
    const onRightDay = (t.weeklyDay == null) ? true : (dayIndex === t.weeklyDay);
    return onRightDay && t.lastCompletedWeekKey !== wkKey;
  }
  if (t.frequency === "days") {
    const scheduled = t.daysOfWeek?.includes(dayIndex);
    return scheduled && t.lastCompletedDayKey !== todayKey;
  }
  return true;
}

// Should appear in Today?
function isDueToday(t, todayKey, wkKey, dayIndex) {
  if (t.frequency === "once")   return !t.doneOnce;
  if (t.frequency === "daily")  return true;
  if (t.frequency === "weekly") {
    const onRightDay = (t.weeklyDay == null) ? true : (dayIndex === t.weeklyDay);
    return onRightDay && t.lastCompletedWeekKey !== wkKey;
  }
  if (t.frequency === "days")   return t.daysOfWeek?.includes(dayIndex);
  return false;
}

/* ===================== App ===================== */

export default function App() {
  const [state, setState] = useState(() => loadState() || initialState);
  const [dex, setDex] = useState({ DEX: {}, getSpecies: () => null, findBaseByElement: () => null, ready: false });

  // UI toggles
  const [showCreatureCard, setShowCreatureCard] = useState(true);
  const [showEvoModal, setShowEvoModal] = useState(false);
  const [evoChoices, setEvoChoices] = useState([]);
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [tasksCollapsedToday, setTasksCollapsedToday] = useState(false);
  const [tasksCollapsedAll, setTasksCollapsedAll] = useState(false);

  // Task form UI
  const [taskTitle, setTaskTitle] = useState("");
  const [taskElement, setTaskElement] = useState("heart");
  const [taskDifficulty, setTaskDifficulty] = useState("easy");
  const [taskFrequency, setTaskFrequency] = useState("daily");
  const [taskWeeklyDay, setTaskWeeklyDay] = useState(null);  // for 'weekly'
  const [taskDays, setTaskDays] = useState([]);              // for 'days'

  // Task list controls
  const [filterElement, setFilterElement] = useState("all");
  const [sortMode, setSortMode] = useState("element"); // 'element' | 'title'

  // Inline edit
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

  // Level-up toast
  const [levelToast, setLevelToast] = useState(null); // { level, xpToNext }

  /* ----- DEX load ----- */
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const loaded = await loadDexFromCSV();
        if (active) setDex({ ...loaded, ready: true });
      } catch (err) {
        console.error("Failed to load dex:", err);
      }
    })();
    return () => { active = false; };
  }, []);

  /* ----- Persist state ----- */
  useEffect(() => { saveState(state); }, [state]);

  /* ----- Last seen bookkeeping ----- */
  useEffect(() => {
    if (!dex.ready) return;
    setState((s) => ({ ...s, meta: { ...s.meta, lastSeenISO: nowISO() } }));
  }, [dex.ready]);

  /* ----- Derived time values (with dev offset & week start) ----- */
  const todayKey = todayKeyWithOffset(state.meta.devOffsetDays);
  const todayDate = nowWithOffset(state.meta.devOffsetDays);
  const todayDayIndex = todayDate.getDay();
  const wkKey = weekKeyWithOffset(state.meta.devOffsetDays, state.meta.weekStartDay);

  /* ----- Active slot refs ----- */
  const active = state.stable[state.activeIndex] ?? state.stable[0];
  const activeEgg = active.egg;
  const activeCreature = active.creature;
  const creature = activeCreature.speciesId ? dex.getSpecies(activeCreature.speciesId) : null;

  const sprite = useMemo(
    () => (creature ? (creature.sprite || `/sprites/${creature.id}.png`) : "/egg.png"),
    [creature]
  );

  /* ===================== Slot helpers ===================== */

  function setActiveSlot(updater) {
    setState((s) => {
      const next = structuredClone(s);
      const slot = next.stable[next.activeIndex];
      updater(slot);
      return next;
    });
  }
  function gotoPrev() {
    setState(s => ({ ...s, activeIndex: (s.activeIndex - 1 + s.stable.length) % s.stable.length }));
  }
  function gotoNext() {
    setState(s => ({ ...s, activeIndex: (s.activeIndex + 1) % s.stable.length }));
  }
  function addEggSlot() { // dev helper
    setState((s)=>{
      const next = structuredClone(s);
      if (next.stable.length >= 3) return s; // soft cap for now
      next.stable.push({
        egg: { progress: 0, cost: 5, element: null, tally: blankTally() },
        creature: { speciesId: null, nickname: null, happiness: null }
      });
      next.activeIndex = next.stable.length - 1;
      return next;
    });
  }

  /* ===================== Core Actions ===================== */

  function maybeBumpStreak(next) {
    if (next.meta.lastActionLocalDate !== todayKey) {
      next.meta.streak = (next.meta.streak || 0) + 1;
      const pick = ELEMENTS[Math.floor(Math.random() * ELEMENTS.length)];
      next.candies[pick] = (next.candies[pick] || 0) + 1;
      next.meta.lastActionLocalDate = todayKey;
    }
  }

  function awardXP(next, xpGain) {
    const prevTotal = next.meta.xpTotal || 0;
    const prevLevel = levelFromXP(prevTotal);
    const newTotal = prevTotal + xpGain;
    const newLevel = levelFromXP(newTotal);
    next.meta.xpTotal = newTotal;
    if (newLevel > prevLevel) {
      next.meta.level = newLevel;
      setTimeout(() => {
        setLevelToast({ level: newLevel, xpToNext: nextLevelAt(newLevel) - newTotal });
      }, 0);
    }
  }

  // Dev candy
  function earnCandy(el) {
    setState((s) => {
      const next = structuredClone(s);
      maybeBumpStreak(next);
      next.candies[el] = (next.candies[el] || 0) + 1;
      awardXP(next, 1);
      next.meta.xpByElement[el] = (next.meta.xpByElement[el] || 0) + 1;
      return next;
    });
  }

  // Feeding is slot-aware
  function feedCandy(el) {
    setState((s) => {
      const next = structuredClone(s);
      const slot = next.stable[next.activeIndex];
      if (slot.creature.speciesId) return s;
      if (slot.egg.progress >= slot.egg.cost) return s;
      if ((next.candies[el]||0) <= 0) return s;
      next.candies[el]--;
      slot.egg.progress += 1;
      slot.egg.tally[el] += 1;
      return next;
    });
  }

  function hatchIfReady() {
    setState((s) => {
      const next = structuredClone(s);
      const slot = next.stable[next.activeIndex];
      if (slot.creature.speciesId || slot.egg.progress < slot.egg.cost) return s;
      const dominant = pickDominantElement(slot.egg.tally, ELEMENTS) || "fire";
      const base = dex.findBaseByElement(dominant);
      if (!base) return s;
      slot.egg = { progress: 0, cost: slot.egg.cost, element: dominant, tally: blankTally() };
      slot.creature = { speciesId: base.id, nickname: null, happiness: 60 };
      return next;
    });
  }

  function tryEvolve() {
    if (!creature) return;
    const evos = creature.evolutions || [];
    if (!evos.length) return;
    const affordable = evos.filter((ev) => canAfford(state.candies, ev.cost));
    if (!affordable.length) return;

    const byCost = affordable.reduce((acc, ev) => {
      const k = totalCost(ev);
      (acc[k] ||= []).push(ev);
      return acc;
    }, {});
    const cheapest = Math.min(...Object.keys(byCost).map(Number));
    const cheapestSet = byCost[cheapest];

    if (cheapestSet.length === 1) confirmEvolution(cheapestSet[0]);
    else { setEvoChoices(cheapestSet); setShowEvoModal(true); }
  }

  function confirmEvolution(chosen) {
    setState((s) => {
      const next = structuredClone(s);
      const slot = next.stable[next.activeIndex];
      if (!slot.creature.speciesId) return s;
      Object.entries(chosen.cost || {}).forEach(([el, amt]) => {
        next.candies[el] = Math.max(0, (next.candies[el] || 0) - amt);
      });
      slot.creature.speciesId = chosen.to;
      if (slot.creature.happiness != null) {
        slot.creature.happiness = clamp((slot.creature.happiness || 0) + 5, 0, 100);
      }
      return next;
    });
    setShowEvoModal(false);
    setEvoChoices([]);
  }

  /* ===================== Tasks: CRUD / Complete / Edit ===================== */

  function addTask() {
    const title = taskTitle.trim();
    if (!title) return;
    setState((s) => {
      const next = structuredClone(s);
      next.tasks.push(newTask({
        title,
        element: taskElement,
        difficulty: taskDifficulty,
        frequency: taskFrequency,
        weeklyDay: taskFrequency === "weekly" ? taskWeeklyDay : null,
        daysOfWeek: taskFrequency === "days" ? [...taskDays] : []
      }));
      return next;
    });
    setTaskTitle("");
    setTaskDays([]);
    setTaskWeeklyDay(null);
  }

  function deleteTask(id) {
    setState((s) => {
      const next = structuredClone(s);
      next.tasks = next.tasks.filter(t => t.id !== id);
      return next;
    });
  }

  function completeTask(id) {
    setState((s) => {
      const idx = s.tasks.findIndex(t => t.id === id);
      if (idx === -1) return s;
      const task = s.tasks[idx];
      if (!canCompleteTaskNow(task, todayKey, wkKey, todayDayIndex)) return s;

      const next = structuredClone(s);
      const t = next.tasks[idx];

      maybeBumpStreak(next);
      next.candies[t.element] = (next.candies[t.element] || 0) + 1;

      const xpGain = XP_BY_DIFFICULTY[t.difficulty] || 0;
      awardXP(next, xpGain);
      next.meta.xpByElement[t.element] = (next.meta.xpByElement[t.element] || 0) + xpGain;

      if (t.frequency === "once") t.doneOnce = true;
      else if (t.frequency === "weekly") t.lastCompletedWeekKey = wkKey;
      else t.lastCompletedDayKey = todayKey; // daily or days
      return next;
    });
  }

  function startEditTask(t) {
    setEditingTaskId(t.id);
    setEditDraft({
      id: t.id,
      title: t.title,
      element: t.element,
      difficulty: t.difficulty,
      frequency: t.frequency,
      weeklyDay: (typeof t.weeklyDay === "number" ? t.weeklyDay : null),
      daysOfWeek: Array.isArray(t.daysOfWeek) ? [...t.daysOfWeek] : []
    });
  }
  function cancelEdit() { setEditingTaskId(null); setEditDraft(null); }
  function saveEdit() {
    if (!editDraft) return;
    setState((s) => {
      const next = structuredClone(s);
      const idx = next.tasks.findIndex(x => x.id === editingTaskId);
      if (idx !== -1) {
        const prev = next.tasks[idx];
        next.tasks[idx] = {
          ...prev,
          title: (editDraft.title || "").trim(),
          element: editDraft.element,
          difficulty: editDraft.difficulty,
          frequency: editDraft.frequency,
          weeklyDay: editDraft.frequency === "weekly" ? editDraft.weeklyDay : null,
          daysOfWeek: editDraft.frequency === "days" ? [...(editDraft.daysOfWeek||[])] : []
        };
      }
      return next;
    });
    setEditingTaskId(null);
    setEditDraft(null);
  }

  /* ===================== Derived UI Lists ===================== */

  function bySort(a,b) {
    if (sortMode === "title") return a.title.localeCompare(b.title);
    if (a.element !== b.element) return a.element.localeCompare(b.element);
    return a.title.localeCompare(b.title);
  }

  const visibleTasks = state.tasks
    .filter(t => filterElement === "all" ? true : t.element === filterElement);

  const tasksToday = visibleTasks
    .filter(t => isDueToday(t, todayKey, wkKey, todayDayIndex))
    .sort(bySort);

  const tasksAll = visibleTasks.sort(bySort);

  const completedToday = visibleTasks
    .filter(t => {
      const due = isDueToday(t, todayKey, wkKey, todayDayIndex);
      const canDo = canCompleteTaskNow(t, todayKey, wkKey, todayDayIndex);
      return due && !canDo; // was due, now locked → finished for today/week
    })
    .sort(bySort);

  /* ===================== Render ===================== */

  const progressPct = Math.round((activeEgg.progress / activeEgg.cost) * 100);
  const eggIsFull = activeEgg.progress >= activeEgg.cost;

  const speciesName = creature?.name || "Egg";
  const nickDisplay = activeCreature.nickname || speciesName;
  const sublabel = creature
    ? `${caps(creature.elements || [])} — ${creature.stage === 0 ? "Base" : `Stage ${creature.stage}`}`
    : "";

  // Nickname editing
  const [editingNick, setEditingNick] = useState(false);
  function startEditNick() { if (creature) setEditingNick(true); }
  function saveNick(e) {
    const value = (e.target.value || "").trim();
    setState((s) => {
      const next = structuredClone(s);
      const slot = next.stable[next.activeIndex];
      if (!slot.creature.speciesId) return s;
      slot.creature.nickname = value || null;
      return next;
    });
    setEditingNick(false);
  }

  if (!dex.ready) {
    return (
      <div className="container">
        <div className="card"><div className="big">Loading Growlings…</div></div>
      </div>
    );
  }

  const currentEvos = creature?.evolutions || [];
  const evoCount = currentEvos.length;
  const hasEvos = evoCount > 0;
  const hasAffordable = currentEvos.some((ev) => canAfford(state.candies, ev.cost));
  const isFinal = !!creature && !hasEvos;
  const evolveSubtitle = !creature
    ? "Hatch a creature first."
    : isFinal
    ? "This Growling is in its final form."
    : evoCount === 1
    ? "Spend candies to evolve."
    : "Choose your path when multiple evolutions are possible.";

  return (
    <div className="container">
      {/* Header */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="big">Growlings — Habit Hatchlings (MVP)</div>
          <div className="small" style={{ textAlign: "right" }}>
            Streak: <strong>{state.meta.streak || 0}</strong><br />
            XP: <strong>{state.meta.xpTotal || 0}</strong>
          </div>
        </div>
      </div>

      {/* Creature Card */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ alignItems:"center", justifyContent:"space-between" }}>
          <div className="big">Creature Card</div>
          <div className="row" style={{ gap:6 }}>
            <button className="btn" onClick={gotoPrev} title="Previous">◀</button>
            <div className="small" style={{ alignSelf:"center" }}>
              Slot {state.activeIndex+1} / {state.stable.length}
            </div>
            <button className="btn" onClick={gotoNext} title="Next">▶</button>
            <button className="btn" onClick={addEggSlot} title="Add Egg (dev)">+ Egg</button>
            <button className="btn" onClick={() => setShowCreatureCard(v => !v)}>
              {showCreatureCard ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {showCreatureCard && (
          <div className="row" style={{ alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
            <div>
              <div className="small">Current</div>
              <div className="big" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {editingNick ? (
                  <input
                    autoFocus
                    defaultValue={activeCreature.nickname || ""}
                    placeholder={speciesName}
                    className="input"
                    style={{ minWidth: 180 }}
                    onBlur={saveNick}
                    onKeyDown={(e) => { if (e.key === "Enter") saveNick(e); if (e.key === "Escape") setEditingNick(false); }}
                  />
                ) : (
                  <>
                    <span>{nickDisplay}</span>
                    {!!creature && (
                      <button className="btn" style={{ padding: 4, minWidth: 0 }} onClick={startEditNick} title="Edit nickname">
                        <img src="/ui/icons/16px/icon_edit.png" width="16" height="16" alt="Edit" style={{ imageRendering: "pixelated", display: "block" }} />
                      </button>
                    )}
                  </>
                )}
              </div>
              {!!creature && <div className="small" style={{ opacity: 0.8, marginTop: 2 }}>{sublabel}</div>}
            </div>

            <div className="sprite" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <img
                src={sprite}
                alt="creature"
                width="64"
                height="64"
                style={{ imageRendering: "pixelated" }}
                onError={(e) => { e.currentTarget.src = "/egg.png"; }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Egg/Hatch — only before hatch */}
      {!creature && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div className="small">Egg progress</div>
              <div className="progress"><div style={{ width: `${progressPct}%` }} /></div>
              <div className="small" style={{ marginTop: 6 }}>
                {activeEgg.progress}/{activeEgg.cost}
              </div>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {ELEMENTS.map((el) => (
                <button key={el} className="btn" disabled={eggIsFull} onClick={() => feedCandy(el)}>
                  Feed {cap(el)}
                </button>
              ))}
              <button className="btn" disabled={!eggIsFull} onClick={hatchIfReady}>Hatch</button>
            </div>
          </div>
        </div>
      )}

      {/* Evolution — only after hatch */}
      {creature && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="big">Evolve</div>
          <div className="small">{evolveSubtitle}</div>

          {hasEvos && (
            <div style={{ marginTop: 10 }}>
              <div className="small" style={{ marginBottom: 6 }}>
                {`Available ${pluralize(evoCount, "Evolution", "Evolutions")}`}
              </div>
              <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                {currentEvos.map((ev, idx) => {
                  const sp = dex.getSpecies(ev.to);
                  const can = canAfford(state.candies, ev.cost);
                  const art = sp?.sprite || "/egg.png";
                  const needText = ELEMENTS
                    .map(el => {
                      const delta = Math.max(0, (ev.cost[el]||0) - (state.candies[el]||0));
                      return delta>0 ? `${delta} ${cap(el)}` : null;
                    })
                    .filter(Boolean)
                    .join(" + ");
                  return (
                    <div key={idx} className="row" style={{
                      alignItems: "center", gap: 8, padding: "6px 10px",
                      border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, opacity: can ? 1 : 0.7
                    }}>
                      <img src={art} alt={sp?.name || "Evolution"} width="32" height="32" style={{ imageRendering: "pixelated" }} />
                      <div>
                        <div className="small" style={{ fontWeight: 600 }}>{sp?.name || "???"}</div>
                        <div className="small" style={{ opacity: 0.9 }}>Cost: {formatCost(ev.cost)}</div>
                        {!can && needText && <div className="small" style={{ opacity: 0.75 }}>Need: {needText}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
            {!hasEvos ? (
              <button className="btn" disabled title="This Growling is already at its final form">Final Form</button>
            ) : (
              <button className="btn" onClick={tryEvolve} disabled={!hasAffordable} title={!hasAffordable ? "Not enough candies yet" : "Evolve"}>
                {hasAffordable ? "Evolve" : "Cannot Evolve Yet"}
              </button>
            )}
            <button
              className="btn"
              onClick={() => {
                if (confirm("Reset all progress? This cannot be undone.")) {
                  setState(structuredClone(initialState));
                }
              }}
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {/* TASKS */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent:"space-between", alignItems:"center", gap: 10 }}>
          <div className="big">Tasks</div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <select className="input" value={filterElement} onChange={(e)=>setFilterElement(e.target.value)}>
              <option value="all">All Elements</option>
              {ELEMENTS.map(el => <option key={el} value={el}>{cap(el)}</option>)}
            </select>
            <select className="input" value={sortMode} onChange={(e)=>setSortMode(e.target.value)}>
              <option value="element">Sort by Element</option>
              <option value="title">Sort by Title</option>
            </select>
          </div>
        </div>
        <div className="small">Create tasks, then complete them to earn candies and XP.</div>

        {/* Add task form */}
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ minWidth: 240 }}
            placeholder="Task title (e.g., Go for a walk)"
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
          />
          <select className="input" value={taskElement} onChange={(e) => setTaskElement(e.target.value)}>
            {ELEMENTS.map(el => <option key={el} value={el}>{ELEMENT_LABEL[el]}</option>)}
          </select>
          <select className="input" value={taskDifficulty} onChange={(e) => setTaskDifficulty(e.target.value)}>
            <option value="easy">Easy (5 XP)</option>
            <option value="med">Medium (10 XP)</option>
            <option value="hard">Hard (20 XP)</option>
          </select>
          <select className="input" value={taskFrequency} onChange={(e) => setTaskFrequency(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="days">Specific Days</option>
            <option value="once">One-time</option>
          </select>

          {taskFrequency === "weekly" && (
            <select className="input" value={taskWeeklyDay ?? ""} onChange={(e)=>setTaskWeeklyDay(e.target.value===""?null:Number(e.target.value))}>
              <option value="">Any day this week</option>
              {DAY_SHORT.map((d,i)=><option key={i} value={i}>{d}</option>)}
            </select>
          )}

          {taskFrequency === "days" && (
            <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
              {DAY_SHORT.map((d, i) => (
                <label key={i} className="small" style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                  <input
                    type="checkbox"
                    checked={taskDays.includes(i)}
                    onChange={() => {
                      setTaskDays((prev) => prev.includes(i) ? prev.filter(x=>x!==i) : [...prev, i]);
                    }}
                  />
                  {d}
                </label>
              ))}
            </div>
          )}
          <button className="btn" onClick={addTask}>Add Task</button>
        </div>

        {/* Today (collapsible) */}
        <div style={{ marginTop: 14 }}>
          <div className="row" style={{ justifyContent:"space-between", alignItems:"center" }}>
            <div className="small" style={{ fontWeight:700 }}>Today</div>
            <button className="btn" onClick={()=>setTasksCollapsedToday(v=>!v)}>{tasksCollapsedToday ? "Expand" : "Collapse"}</button>
          </div>
          {!tasksCollapsedToday && (
            <div style={{ marginTop: 8, display:"grid", gap:8 }}>
              {tasksToday.length === 0 ? (
                <div className="small" style={{ opacity:0.8 }}>No tasks due today.</div>
              ) : tasksToday.map((t) => renderTaskRow(t))}
            </div>
          )}
        </div>

        {/* Completed Today */}
        <div style={{ marginTop: 14 }}>
          <div className="row" style={{ justifyContent:"space-between", alignItems:"center" }}>
            <div className="small" style={{ fontWeight:700 }}>Completed Today</div>
          </div>
          <div style={{ marginTop: 8, display:"grid", gap:8 }}>
            {completedToday.length === 0 ? (
              <div className="small" style={{ opacity:0.8 }}>Nothing here yet.</div>
            ) : completedToday.map((t) => (
              <div key={t.id} className="row" style={{
                justifyContent:"space-between",
                alignItems:"center",
                padding:"6px 10px",
                border:"1px solid rgba(255,255,255,0.12)",
                borderRadius:8,
                opacity:0.75
              }}>
                <div className="small" style={{ fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {t.title}
                </div>
                <div className="row" style={{ gap:6, flexWrap:"wrap" }}>
                  <span className="badge" style={{ background: ELEMENT_BADGE_BG[t.element] }}>{cap(t.element)}</span>
                  <span className="badge">{t.frequency === "weekly" ? "This week done" : "Done today"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* All (collapsible) */}
        <div style={{ marginTop: 14 }}>
          <div className="row" style={{ justifyContent:"space-between", alignItems:"center" }}>
            <div className="small" style={{ fontWeight:700 }}>All Tasks</div>
            <button className="btn" onClick={()=>setTasksCollapsedAll(v=>!v)}>{tasksCollapsedAll ? "Expand" : "Collapse"}</button>
          </div>
          {!tasksCollapsedAll && (
            <div style={{ marginTop: 8, display:"grid", gap:8 }}>
              {tasksAll.length === 0 ? (
                <div className="small" style={{ opacity:0.8 }}>No tasks yet. Add a few to start earning candies!</div>
              ) : tasksAll.map((t) => renderTaskRow(t))}
            </div>
          )}
        </div>
      </div>

      {/* Candy Bag */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="big">Candy Bag</div>
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
          {ELEMENTS.map((el) => (
            <span key={el} className="badge">{cap(el)}: {state.candies[el]}</span>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8, alignItems: "center", gap: 8 }}>
          <div className="small" style={{ opacity: 0.8 }}>XP by Element:</div>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {ELEMENTS.map(el => (
              <span key={el} className="badge">{cap(el)} XP: {state.meta.xpByElement[el] || 0}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Settings */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="big">Settings</div>
        <div className="row" style={{ marginTop:8, gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <div className="small" style={{ opacity:0.9 }}>Week starts on:</div>
          <select
            className="input"
            value={state.meta.weekStartDay}
            onChange={(e)=>setState(s=>({ ...s, meta:{ ...s.meta, weekStartDay: Number(e.target.value) } }))}
          >
            {DAY_SHORT.map((d,i)=><option key={i} value={i}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Developer */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ justifyContent:"space-between", alignItems:"center" }}>
          <div className="big">Developer</div>
          <button className="btn" onClick={()=>setShowDevPanel(v=>!v)}>{showDevPanel ? "Hide" : "Show"}</button>
        </div>
        {showDevPanel && (
          <>
            <div className="row" style={{ flexWrap:"wrap", gap:8, marginTop:8 }}>
              <button className="btn" onClick={()=>setState(s=>({ ...s, meta:{ ...s.meta, devOffsetDays: s.meta.devOffsetDays - 1 } }))}>−1 day</button>
              <button className="btn" onClick={()=>setState(s=>({ ...s, meta:{ ...s.meta, devOffsetDays: s.meta.devOffsetDays + 1 } }))}>+1 day</button>
              <button className="btn" onClick={()=>setState(s=>({ ...s, meta:{ ...s.meta, devOffsetDays: 0 } }))}>Reset date</button>
            </div>
            <div className="row" style={{ flexWrap:"wrap", gap:8, marginTop:8 }}>
              {ELEMENTS.map(el => (
                <button key={el} className="btn" onClick={() => earnCandy(el)}>+1 {cap(el)} (dev)</button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Evolution Choice Modal */}
      {showEvoModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999
        }}>
          <div className="card" style={{ maxWidth: 420, width: "90%", padding: 16 }}>
            <div className="big" style={{ marginBottom: 6 }}>
              {creature?.name} can evolve!
            </div>
            <div className="small" style={{ marginBottom: 12, opacity: 0.9 }}>
              Choose a path:
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              {evoChoices.map((ev, i) => {
                const sp = dex.getSpecies(ev.to);
                const art = sp?.sprite || "/egg.png";
                return (
                  <button
                    key={i}
                    className="btn"
                    style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-start" }}
                    onClick={() => confirmEvolution(ev)}
                  >
                    <img src={art} alt={sp?.name || "Evolution"} width="32" height="32" style={{ imageRendering: "pixelated" }} />
                    <div style={{ textAlign: "left" }}>
                      <div style={{ fontWeight: 700 }}>{sp?.name || "???"}</div>
                      <div className="small" style={{ opacity: 0.8 }}>Cost: {formatCost(ev.cost)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => { setShowEvoModal(false); setEvoChoices([]); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Level Up Toast */}
      {levelToast && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999
        }}>
          <div className="card" style={{ maxWidth:380, width:"90%", padding:16, textAlign:"center" }}>
            <div className="big">Level Up!</div>
            <div className="small" style={{ marginTop:6 }}>
              Congrats—You reached <strong>Level {levelToast.level}</strong>! 🎉
            </div>
            <div className="small" style={{ opacity:0.85, marginTop:4 }}>
              {levelToast.xpToNext <= 0 ? "Max level for this curve." : `${levelToast.xpToNext} XP to next level.`}
            </div>
            <div className="row" style={{ marginTop:12, justifyContent:"center" }}>
              <button className="btn" onClick={()=>setLevelToast(null)}>Nice!</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  /* ===== Task Row Renderer (stacked text, element-colored badge) ===== */
  function renderTaskRow(t) {
    const canDo = canCompleteTaskNow(t, todayKey, wkKey, todayDayIndex);

    // Edit mode
    if (editingTaskId === t.id && editDraft) {
      return (
        <div key={t.id} className="row" style={{
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
          padding: "8px 10px",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8,
          flexWrap: "wrap"
        }}>
          <div style={{ display:"grid", gap:6, minWidth: 240, flex:1 }}>
            <input
              className="input"
              value={editDraft.title}
              onChange={(e)=>setEditDraft(d=>({ ...d, title: e.target.value }))}
            />
            <div className="row" style={{ gap:6, flexWrap:"wrap" }}>
              <select className="input" value={editDraft.element} onChange={(e)=>setEditDraft(d=>({ ...d, element: e.target.value }))}>
                {ELEMENTS.map(el => <option key={el} value={el}>{ELEMENT_LABEL[el]}</option>)}
              </select>
              <select className="input" value={editDraft.difficulty} onChange={(e)=>setEditDraft(d=>({ ...d, difficulty: e.target.value }))}>
                <option value="easy">Easy (5 XP)</option>
                <option value="med">Medium (10 XP)</option>
                <option value="hard">Hard (20 XP)</option>
              </select>
              <select className="input" value={editDraft.frequency} onChange={(e)=>setEditDraft(d=>({ ...d, frequency: e.target.value }))}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="days">Specific Days</option>
                <option value="once">One-time</option>
              </select>
            </div>

            {editDraft.frequency === "weekly" && (
              <select className="input" value={editDraft.weeklyDay ?? ""} onChange={(e)=>setEditDraft(d=>({ ...d, weeklyDay: e.target.value===""?null:Number(e.target.value) }))}>
                <option value="">Any day this week</option>
                {DAY_SHORT.map((d,i)=><option key={i} value={i}>{d}</option>)}
              </select>
            )}

            {editDraft.frequency === "days" && (
              <div className="row" style={{ gap:6, flexWrap:"wrap" }}>
                {DAY_SHORT.map((d,i)=>(
                  <label key={i} className="small" style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                    <input
                      type="checkbox"
                      checked={editDraft.daysOfWeek?.includes(i)}
                      onChange={()=>{
                        setEditDraft(ed=>{
                          const on = ed.daysOfWeek?.includes(i);
                          return { ...ed, daysOfWeek: on ? ed.daysOfWeek.filter(x=>x!==i) : [...(ed.daysOfWeek||[]), i] };
                        });
                      }}
                    />
                    {d}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="row" style={{ gap:6 }}>
            <button className="btn" onClick={saveEdit}>Save</button>
            <button className="btn" onClick={cancelEdit}>Cancel</button>
          </div>
        </div>
      );
    }

    // Read-only row
    return (
      <div key={t.id} className="row" style={{
        alignItems: "stretch",
        justifyContent: "space-between",
        padding: "8px 10px",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        gap: 10,
        flexWrap: "wrap"
      }}>
        <div style={{ display:"grid", gap:4, minWidth: 240, flex:1 }}>
          <div className="small" style={{ fontWeight: 700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {t.title}
          </div>
          <div className="small" style={{ opacity: 0.9, display:"flex", flexWrap:"wrap", gap:6 }}>
            <span className="badge" style={{ background: ELEMENT_BADGE_BG[t.element] }}>{cap(t.element)}</span>
            <span className="badge">{cap(t.difficulty)} • {XP_BY_DIFFICULTY[t.difficulty]} XP</span>
            <span className="badge">
              {t.frequency === "daily" ? "Daily"
                : t.frequency === "weekly" ? (t.weeklyDay==null ? "Weekly" : `Weekly: ${DAY_SHORT[t.weeklyDay]}`)
                : t.frequency === "once" ? "One-time"
                : `Days: ${t.daysOfWeek.map(i=>DAY_SHORT[i]).join(", ") || "—"}`}
            </span>
            <span className="badge">Rewards: 1 {cap(t.element)} Candy</span>
          </div>
          {!canDo && (
            <div className="small" style={{ opacity: 0.7 }}>
              {t.frequency === "once" ? "Completed."
                : t.frequency === "weekly" ? "Completed this week."
                : "Completed today."}
            </div>
          )}
        </div>
        <div className="row" style={{ gap: 6, alignItems:"center" }}>
          <button className="btn" onClick={() => completeTask(t.id)} disabled={!canDo}>
            {canDo ? "Complete" : "Locked"}
          </button>
          <button className="btn" onClick={() => startEditTask(t)}>Edit</button>
          <button className="btn" onClick={() => deleteTask(t.id)} title="Delete task">Delete</button>
        </div>
      </div>
    );
  }
}
