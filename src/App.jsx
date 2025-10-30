// Full file: src/App.jsx
import { useEffect, useMemo, useState } from "react";
import { loadDexFromCSV, ELEMENTS } from "./data/csvDexLoader";
import suggestions from "./data/taskSuggestions.json";

/* ===================== Helpers & Constants ===================== */

const blankTally = () => ({ fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 });
const blankXPByEl = () => ({ fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 });

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

/* ===== Level curve ===== */
const xpToLevel = (level) => Math.round(100 * Math.pow(1.25, Math.max(0, level - 1)));
function levelInfoFromTotalXP(totalXP) {
  let level = 1;
  let spent = 0;
  let need = xpToLevel(level);
  while (totalXP >= spent + need) {
    spent += need;
    level += 1;
    need = xpToLevel(level);
  }
  return {
    level,
    currentIntoLevel: totalXP - spent,
    neededForLevel: need,
    xpToNext: need - (totalXP - spent)
  };
}
const nextLevelAt = (level) => xpToLevel(level); // cost to go from level -> level+1

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

const SAVE_VERSION = 6;
const STORAGE_KEY = "hc-state";

const initialState = {
  candies: { fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 },

  // Multi-slot creature storage (unlimited)
  stable: [
    {
      egg: { progress: 0, cost: 3, element: null, tally: blankTally() },
      creature: { speciesId: null, nickname: null, happiness: null, xpTotal: 0, xpByElement: blankXPByEl() }
    }
  ],

  // Active Team of indices into `stable` (max 6 shown on home carousel)
  activeTeam: [0],
  activeIndex: 0, // index within activeTeam (0..activeTeam.length-1)

  tasks: [], // see newTask()

  meta: {
    lastSeenISO: null,
    saveVersion: SAVE_VERSION,
    lastActionLocalDate: null,
    lastGemAwardDayKey: null,
    streak: 0,
    xpTotal: 0,
    xpByElement: { fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 },
    devOffsetDays: 0,
    weekStartDay: 0, // user preference: 0=Sun .. 6=Sat
    level: 1,
    gems: 0,
    // New: pokedex registry
    pokedex: {} // { [speciesId]: { seen:boolean, owned:boolean, firstSeenISO:string } }
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
      level: s?.meta?.level ?? base.meta.level,
      gems: s?.meta?.gems ?? 0,
      lastGemAwardDayKey: s?.meta?.lastGemAwardDayKey ?? null,
      pokedex: s?.meta?.pokedex || {}
    }
  };

  // MIGRATION: stable / creature fields
  if (!Array.isArray(s?.stable)) {
    const oldEgg = s?.egg;
    const oldCreature = s?.creature;
    next.stable = [
      {
        egg: oldEgg ? { ...base.stable[0].egg, ...oldEgg, cost: 3 } : base.stable[0].egg,
        creature: oldCreature
          ? { ...base.stable[0].creature, ...oldCreature, xpTotal: oldCreature.xpTotal || 0, xpByElement: oldCreature.xpByElement || blankXPByEl() }
          : base.stable[0].creature
      }
    ];
  } else {
    next.stable = s.stable.map(slot => ({
      egg: { ...base.stable[0].egg, ...slot.egg, cost: 3 }, // enforce hatch cost=3
      creature: {
        ...base.stable[0].creature,
        ...slot.creature,
        xpTotal: slot?.creature?.xpTotal || 0,
        xpByElement: slot?.creature?.xpByElement || blankXPByEl()
      }
    }));
  }

  // Active Team migration
  if (!Array.isArray(s?.activeTeam) || s.activeTeam.length === 0) {
    next.activeTeam = [0];
  } else {
    // clamp indices to stable length
    next.activeTeam = s.activeTeam.filter(i => typeof i === "number" && i >= 0 && i < next.stable.length);
    if (next.activeTeam.length === 0) next.activeTeam = [0];
  }
  next.activeIndex = (typeof s?.activeIndex === "number")
    ? Math.max(0, Math.min(next.activeTeam.length - 1, s.activeIndex))
    : 0;

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
  if (t.frequency === "daily")  return true; // filtered later by !canCompleteTaskNow -> hides after completion
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

  // Tabs
  const [tab, setTab] = useState("creatures"); // 'creatures' | 'tasks' | 'library'

  // UI toggles
  const [showCreatureCard, setShowCreatureCard] = useState(true);
  const [showEvoModal, setShowEvoModal] = useState(false);
  const [evoChoices, setEvoChoices] = useState([]);
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [tasksCollapsedToday, setTasksCollapsedToday] = useState(false);
  const [tasksCollapsedAll, setTasksCollapsedAll] = useState(false);
  const [tasksCollapsedCompleted, setTasksCollapsedCompleted] = useState(true); // default collapsed
  const [showSettings, setShowSettings] = useState(false);
  const [showProfile, setShowProfile] = useState(false); // per-creature profile

  // Task form UI
  const [taskTitle, setTaskTitle] = useState("");
  const [taskElement, setTaskElement] = useState("heart");
  const [taskDifficulty, setTaskDifficulty] = useState("easy");
  const [taskFrequency, setTaskFrequency] = useState("daily");
  const [taskWeeklyDay, setTaskWeeklyDay] = useState(null);  // for 'weekly'
  const [taskDays, setTaskDays] = useState([]);              // for 'days'
  const [showSuggestions, setShowSuggestions] = useState(false); // ✅ NEW: collapsed by default

  // Task list controls
  const [filterElement, setFilterElement] = useState("all");
  const [filterOccur, setFilterOccur] = useState("all"); // 'all'|'once'|'daily'|'weekly'|'days'
  const [sortMode, setSortMode] = useState("element"); // 'element' | 'title'

  // Inline edit
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

  // Level-up toast
  const [levelToast, setLevelToast] = useState(null); // { level, xpToNext }

  // Status bar UI
  const [showXPTooltip, setShowXPTooltip] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [showManageTeam, setShowManageTeam] = useState(false);

  // ✅ Evolution Congrats modal state
  const [showEvoCongrats, setShowEvoCongrats] = useState(null); // { from, to }

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

  /* ----- Active Team mapping ----- */
  const team = state.activeTeam.length ? state.activeTeam : [0];
  const activeStableIndex = team[state.activeIndex] ?? team[0];
  const active = state.stable[activeStableIndex] ?? state.stable[0];
  const activeEgg = active.egg;
  const activeCreature = active.creature;
  const creature = activeCreature?.speciesId ? dex.getSpecies(activeCreature.speciesId) : null;

  const sprite = useMemo(
    () => (creature ? (creature.sprite || `/sprites/${creature.id}.png`) : "/egg.png"),
    [creature]
  );

  /* ===================== Slot helpers ===================== */

  function setActiveSlot(updater) {
    setState((s) => {
      const next = structuredClone(s);
      const stableIndex = (next.activeTeam[next.activeIndex] ?? 0);
      const slot = next.stable[stableIndex];
      updater(slot, stableIndex, next);
      return next;
    });
  }

  function gotoPrev() {
    setState(s => ({
      ...s,
      activeIndex: (s.activeIndex - 1 + s.activeTeam.length) % s.activeTeam.length
    }));
  }
  function gotoNext() {
    setState(s => ({
      ...s,
      activeIndex: (s.activeIndex + 1) % s.activeTeam.length
    }));
  }

  function addEggSlotDev() { // dev helper (free)
    setState((s)=>{
      const next = structuredClone(s);
      next.stable.push({
        egg: { progress: 0, cost: 3, element: null, tally: blankTally() },
        creature: { speciesId: null, nickname: null, happiness: null, xpTotal: 0, xpByElement: blankXPByEl() }
      });
      const newIndex = next.stable.length - 1;
      // If team has space (<6), auto-add dev egg to team and focus it
      if (next.activeTeam.length < 6) {
        next.activeTeam.push(newIndex);
        next.activeIndex = next.activeTeam.length - 1;
      }
      return next;
    });
  }

  function buyEgg() {
    setState((s)=>{
      const next = structuredClone(s);
      if ((next.meta.gems || 0) < 20) return s; // not enough
      next.meta.gems -= 20;
      next.stable.push({
        egg: { progress: 0, cost: 3, element: null, tally: blankTally() },
        creature: { speciesId: null, nickname: null, happiness: null, xpTotal: 0, xpByElement: blankXPByEl() }
      });
      const newIdx = next.stable.length - 1;
      if (next.activeTeam.length < 6) {
        next.activeTeam.push(newIdx);
        next.activeIndex = next.activeTeam.length - 1;
      }
      return next;
    });
  }

  function openManageTeam() { setShowManageTeam(true); }
  function toggleTeamMember(stableIndex) {
    setState((s)=>{
      const next = structuredClone(s);
      const pos = next.activeTeam.indexOf(stableIndex);
      if (pos >= 0) {
        // remove
        next.activeTeam.splice(pos, 1);
        if (next.activeIndex >= next.activeTeam.length) next.activeIndex = Math.max(0, next.activeTeam.length - 1);
      } else {
        if (next.activeTeam.length >= 6) return s; // max 6
        next.activeTeam.push(stableIndex);
        next.activeIndex = next.activeTeam.length - 1;
      }
      if (next.activeTeam.length === 0) next.activeTeam = [0];
      return next;
    });
  }

  /* ===================== Pokedex helpers ===================== */

  function ensureDexEntry(next, speciesId) {
    if (!speciesId) return;
    if (!next.meta.pokedex[speciesId]) {
      next.meta.pokedex[speciesId] = { seen: false, owned: false, firstSeenISO: null };
    }
  }
  function markSeen(next, speciesId) {
    if (!speciesId) return;
    ensureDexEntry(next, speciesId);
    const entry = next.meta.pokedex[speciesId];
    if (!entry.seen) {
      entry.seen = true;
      entry.firstSeenISO = entry.firstSeenISO || nowISO();
    }
  }
  // ✅ Mark the species AND its ancestors as owned (you had to own them to get here)
  function markOwnedLineage(next, speciesId) {
    if (!speciesId) return;
    let cur = dex.getSpecies(speciesId);
    while (cur) {
      ensureDexEntry(next, cur.id);
      next.meta.pokedex[cur.id].seen = true;
      next.meta.pokedex[cur.id].owned = true;
      next.meta.pokedex[cur.id].firstSeenISO = next.meta.pokedex[cur.id].firstSeenISO || nowISO();
      if (!cur.parentId) break;
      cur = dex.getSpecies(cur.parentId);
    }
  }

  /* ===================== Core Actions ===================== */

  function maybeBumpStreakAndGems(next) {
    // Streak bump + 1 random candy on first action of a calendar day
    if (next.meta.lastActionLocalDate !== todayKey) {
      next.meta.streak = (next.meta.streak || 0) + 1;
      const pick = ELEMENTS[Math.floor(Math.random() * ELEMENTS.length)];
      next.candies[pick] = (next.candies[pick] || 0) + 1;
      next.meta.lastActionLocalDate = todayKey;
    }
  }

  function maybeAwardDailyGems(next) {
    if (next.meta.lastGemAwardDayKey !== todayKey) {
      next.meta.gems = (next.meta.gems || 0) + 20;
      next.meta.lastGemAwardDayKey = todayKey;
    }
  }

  function awardXP(next, xpGain) {
    const prevTotal = next.meta.xpTotal || 0;
    const prevInfo = levelInfoFromTotalXP(prevTotal);
    const newTotal = prevTotal + xpGain;
    next.meta.xpTotal = newTotal;

    const newInfo = levelInfoFromTotalXP(newTotal);
    if (newInfo.level > prevInfo.level) {
      next.meta.level = newInfo.level;
      setTimeout(() => {
        setLevelToast({ level: newInfo.level, xpToNext: newInfo.xpToNext });
      }, 0);
    } else {
      next.meta.level = newInfo.level;
    }
  }

  // Dev candy
  function earnCandy(el) {
    setState((s) => {
      const next = structuredClone(s);
      maybeBumpStreakAndGems(next); // gems can also award here if first action
      next.candies[el] = (next.candies[el] || 0) + 1;
      awardXP(next, 1);
      next.meta.xpByElement[el] = (next.meta.xpByElement[el] || 0) + 1;
      // Party XP (tiny dev action credit)
      for (const idx of next.activeTeam) {
        const slot = next.stable[idx];
        if (slot?.creature?.speciesId) {
          slot.creature.xpTotal += 1;
          slot.creature.xpByElement[el] = (slot.creature.xpByElement[el] || 0) + 1;
          markSeen(next, slot.creature.speciesId); // seen/current
        }
      }
      return next;
    });
  }

  // Feeding is slot-aware
  function feedCandy(el) {
    setState((s) => {
      const next = structuredClone(s);
      const slot = next.stable[next.activeTeam[next.activeIndex] ?? 0];
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
      const slot = next.stable[next.activeTeam[next.activeIndex] ?? 0];
      if (slot.creature.speciesId || slot.egg.progress < slot.egg.cost) return s;
      const dominant = pickDominantElement(slot.egg.tally, ELEMENTS) || "fire";
      const base = dex.findBaseByElement(dominant);
      if (!base) return s;
      slot.egg = { progress: 0, cost: slot.egg.cost, element: dominant, tally: blankTally() };
      slot.creature = { speciesId: base.id, nickname: null, happiness: 60, xpTotal: 0, xpByElement: blankXPByEl() };
      // Pokedex: owning base (and its lineage == itself)
      markOwnedLineage(next, base.id);
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

    // Mark these species as seen when presenting choices
    setState((s) => {
      const next = structuredClone(s);
      for (const ev of cheapestSet) markSeen(next, ev.to);
      return next;
    });

    if (cheapestSet.length === 1) confirmEvolution(cheapestSet[0]);
    else { setEvoChoices(cheapestSet); setShowEvoModal(true); }
  }

  function confirmEvolution(chosen) {
    // ✅ Determine “from” and “to” BEFORE state mutation so the modal always has correct data
    const fromSp = creature ? dex.getSpecies(creature.id) : null;
    const toSp = dex.getSpecies(chosen.to);

    setState((s) => {
      const next = structuredClone(s);
      const slot = next.stable[next.activeTeam[next.activeIndex] ?? 0];
      if (!slot.creature.speciesId) return s;

      Object.entries(chosen.cost || {}).forEach(([el, amt]) => {
        next.candies[el] = Math.max(0, (next.candies[el] || 0) - amt);
      });
      slot.creature.speciesId = chosen.to;
      if (slot.creature.happiness != null) {
        slot.creature.happiness = clamp((slot.creature.happiness || 0) + 5, 0, 100);
      }
      // Pokedex: own the evolved species + all its ancestors
      markOwnedLineage(next, chosen.to);
      return next;
    });

    // ✅ Trigger the Congrats modal with stable “from/to”
    setShowEvoCongrats({ from: fromSp, to: toSp });

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

      // Streak & gems (first completion of day)
      maybeBumpStreakAndGems(next);
      maybeAwardDailyGems(next);

      // Reward: 1 candy of task's element + XP
      next.candies[t.element] = (next.candies[t.element] || 0) + 1;

      const xpGain = XP_BY_DIFFICULTY[t.difficulty] || 0;
      awardXP(next, xpGain);
      next.meta.xpByElement[t.element] = (next.meta.xpByElement[t.element] || 0) + xpGain;

      // Party XP: each active creature gains the same XP, bucketed by element
      for (const idx2 of next.activeTeam) {
        const slot = next.stable[idx2];
        if (slot?.creature?.speciesId) {
          slot.creature.xpTotal += xpGain;
          slot.creature.xpByElement[t.element] = (slot.creature.xpByElement[t.element] || 0) + xpGain;
          // Mark current creatures seen (safety)
          markSeen(next, slot.creature.speciesId);
        }
      }

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

  const visibleTasksBase = state.tasks
    .filter(t => filterElement === "all" ? true : t.element === filterElement)
    .filter(t => filterOccur === "all" ? true : (
      filterOccur === "once" ? t.frequency === "once" :
      filterOccur === "daily" ? t.frequency === "daily" :
      filterOccur === "weekly" ? t.frequency === "weekly" :
      t.frequency === "days"
    ));

  const tasksToday = visibleTasksBase
    .filter(t => isDueToday(t, todayKey, wkKey, todayDayIndex))
    .filter(t => canCompleteTaskNow(t, todayKey, wkKey, todayDayIndex)) // hide daily once completed
    .sort(bySort);

  const tasksAll = visibleTasksBase.slice().sort(bySort);

  const completedToday = visibleTasksBase
    .filter(t => {
      const due = isDueToday(t, todayKey, wkKey, todayDayIndex);
      const canDo = canCompleteTaskNow(t, todayKey, wkKey, todayDayIndex);
      return due && !canDo; // was due, now locked → finished for today/week
    })
    .sort(bySort);

  /* ===================== Level values (for status bar) ===================== */
  const lvlInfo = levelInfoFromTotalXP(state.meta.xpTotal || 0);
  const xpPct = Math.max(0, Math.min(100, Math.round((lvlInfo.currentIntoLevel / lvlInfo.neededForLevel) * 100)));

  /* ===================== Library (Growlings index) ===================== */

  // Build list of species grouped by element and evolution lines (rooted by chain)
  const allSpecies = useMemo(() => {
    if (!dex.ready) return [];
    return Object.values(dex.DEX || {});
  }, [dex]);

  function getRootId(sp) {
    // Climb parentId to the top
    let cur = sp;
    const seen = new Set();
    while (cur?.parentId) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      cur = dex.getSpecies(cur.parentId);
    }
    return cur?.id || sp.id;
  }

  const libraryByElement = useMemo(() => {
    const out = {};
    for (const el of ELEMENTS) out[el] = new Map(); // rootId -> [species...]
    for (const sp of allSpecies) {
      const primary = sp?.elements?.[0];
      if (!primary) continue;
      if (!ELEMENTS.includes(primary)) continue;
      const root = getRootId(sp);
      if (!out[primary].has(root)) out[primary].set(root, []);
      out[primary].get(root).push(sp);
    }
    // Sort each line by stage, then id
    for (const el of ELEMENTS) {
      for (const [rootId, arr] of out[el].entries()) {
        arr.sort((a,b)=> (a.stage - b.stage) || a.id.localeCompare(b.id));
      }
    }
    return out;
  }, [allSpecies, dex]);

  // ✅ Owned stats (overall + per element)
  const ownedIds = new Set(
    Object.entries(state.meta.pokedex || {})
      .filter(([,v]) => v?.owned)
      .map(([id]) => id)
  );
  const overallTotal = allSpecies.length || 0;
  const overallOwned = overallTotal ? allSpecies.filter(sp => ownedIds.has(sp.id)).length : 0;
  const overallPct = overallTotal ? Math.round((overallOwned / overallTotal) * 100) : 0;

  function elementCounts(el) {
    let total = 0;
    let owned = 0;
    for (const [, line] of (libraryByElement[el] || new Map()).entries()) {
      for (const sp of line) {
        total += 1;
        if (ownedIds.has(sp.id)) owned += 1;
      }
    }
    const pct = total ? Math.round((owned / total) * 100) : 0;
    return { total, owned, pct };
  }

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
      const slot = next.stable[next.activeTeam[next.activeIndex] ?? 0];
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
      {/* Header with Tabs */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="big">Growlings — Habit Hatchlings</div>
          <div className="row" style={{ gap:6 }}>
            <button className="btn" onClick={()=>setTab("creatures")} disabled={tab==="creatures"}>Creatures</button>
            <button className="btn" onClick={()=>setTab("tasks")} disabled={tab==="tasks"}>Tasks</button>
            <button className="btn" onClick={()=>setTab("library")} disabled={tab==="library"}>Library</button>
          </div>
        </div>
      </div>

      {/* Status Bar: Streak | Level N | XP bar (clickable) | Gems + Shop */}
      <div className="card" style={{ marginBottom: 12, padding: "8px 12px" }}>
        <div className="row" style={{ alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <span className="badge">Streak: {state.meta.streak || 0}</span>
          <span className="badge">Level {lvlInfo.level}</span>

          <div
            className="progress"
            onClick={()=>setShowXPTooltip(v=>!v)}
            title="Click to show XP details"
            style={{ width: 220, cursor: "pointer" }}
          >
            <div style={{ width: `${xpPct}%` }} />
          </div>
          {showXPTooltip && (
            <div className="small" style={{ opacity: 0.9 }}>
              {lvlInfo.currentIntoLevel} / {lvlInfo.neededForLevel} XP (Level {lvlInfo.level} → {lvlInfo.level+1})
            </div>
          )}

          <span className="badge">💎 {state.meta.gems || 0}</span>
          <button className="btn" onClick={()=>setShowShop(true)}>Shop</button>
        </div>
      </div>

      {/* ===== CREATURES TAB ===== */}
      {tab === "creatures" && (
        <>
          {/* Creature Card */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ alignItems:"center", justifyContent:"space-between" }}>
              <div className="big">Creature Card</div>
              <div className="row" style={{ gap:6, alignItems:"center" }}>
                <button className="btn" onClick={gotoPrev} title="Previous">◀</button>
                <div className="small" style={{ alignSelf:"center" }}>
                  Team Slot {state.activeIndex+1} / {state.activeTeam.length}
                </div>
                <button className="btn" onClick={gotoNext} title="Next">▶</button>
                <button className="btn" onClick={openManageTeam} title="Manage Team">Manage Team</button>
                <button className="btn" onClick={()=>setShowProfile(true)} title="View Summary">Summary</button>
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
                      const owned = !!state.meta.pokedex?.[sp?.id || ""]?.owned;
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
                          <img
                            src={art}
                            alt={sp?.name || "Evolution"}
                            width="32"
                            height="32"
                            style={{
                              imageRendering: "pixelated",
                              filter: owned ? "none" : "grayscale(1) brightness(0) contrast(1)"
                            }}
                          />
                          <div>
                            <div className="small" style={{ fontWeight: 600 }}>{owned ? (sp?.name || "???") : "???"}</div>
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

          {/* Candy Bag */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="big">Candy Bag</div>
            <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
              {ELEMENTS.map((el) => (
                <span key={el} className="badge">{cap(el)}: {state.candies[el]}</span>
              ))}
            </div>
            <div className="row" style={{ marginTop: 8, alignItems: "center", gap: 8 }}>
              <div className="small" style={{ opacity: 0.8 }}>Trainer XP by Element:</div>
              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {ELEMENTS.map(el => (
                  <span key={el} className="badge">{cap(el)} XP: {state.meta.xpByElement[el] || 0}</span>
                ))}
              </div>
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
                  <button className="btn" onClick={addEggSlotDev}>+ Egg (dev, free)</button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ===== TASKS TAB ===== */}
      {tab === "tasks" && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="row" style={{ justifyContent:"space-between", alignItems:"center", gap: 10 }}>
            <div className="big">Tasks</div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              {/* Occurrence filter pills */}
              <div className="row" style={{ gap:6, flexWrap:"wrap" }}>
                {[
                  ["all","All"],["once","Once"],["daily","Daily"],["weekly","Weekly"],["days","Specific Days"]
                ].map(([val,label])=>(
                  <button
                    key={val}
                    className="btn"
                    onClick={()=>setFilterOccur(val)}
                    disabled={filterOccur===val}
                    title={`Filter: ${label}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

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
          <div className="small">Create tasks, then complete them to earn candies, XP, and daily 💎.</div>

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

          {/* ✅ Suggestions (collapsed by default) */}
          <div className="card" style={{ marginTop:12 }}>
            <div className="row" style={{ justifyContent:"space-between", alignItems:"center" }}>
              <div className="small" style={{ fontWeight:700 }}>
                Suggestions for {ELEMENT_LABEL[taskElement]}
              </div>
              <button className="btn" onClick={()=>setShowSuggestions(v=>!v)}>
                {showSuggestions ? "Hide ideas" : "Give me task ideas"}
              </button>
            </div>

            {showSuggestions && (
              <div className="row" style={{ marginTop:8, gap:8, flexWrap:"wrap" }}>
                {(suggestions?.[taskElement] || []).map((title, i) => (
                  <button
                    key={i}
                    className="btn"
                    title="Add this suggestion"
                    onClick={()=>{
                      setTaskTitle(title);
                      // You can auto-add on click by uncommenting:
                      // setTimeout(addTask, 0);
                    }}
                  >
                    + {title}
                  </button>
                ))}
              </div>
            )}
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
                  <div className="small" style={{ opacity:0.8 }}>No tasks due (or all done) today.</div>
                ) : tasksToday.map((t) => renderTaskRow(t))}
              </div>
            )}
          </div>

          {/* Completed Today (collapsible, default collapsed) */}
          <div style={{ marginTop: 14 }}>
            <div className="row" style={{ justifyContent:"space-between", alignItems:"center" }}>
              <div className="small" style={{ fontWeight:700 }}>Completed Today</div>
              <button className="btn" onClick={()=>setTasksCollapsedCompleted(v=>!v)}>{tasksCollapsedCompleted ? "Expand" : "Collapse"}</button>
            </div>
            {!tasksCollapsedCompleted && (
              <div style={{ marginTop: 8, display:"grid", gap:8 }}>
                {completedToday.length === 0 ? (
                  <div className="small" style={{ opacity:0.8 }}>Nothing here yet.</div>
                ) : completedToday.map((t) => (
                  editingTaskId === t.id && editDraft
                  ? renderTaskRow(t) // reuse editor UI
                  : (
                    <div
                      key={t.id}
                      className="row"
                      onClick={()=>startEditTask(t)} // click-to-expand editor
                      style={{
                        justifyContent:"space-between",
                        alignItems:"center",
                        padding:"6px 10px",
                        border:"1px solid rgba(255,255,255,0.12)",
                        borderRadius:8,
                        opacity:0.9,
                        cursor: "pointer"
                      }}>
                      <div className="small" style={{ fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {t.title}
                      </div>
                      <div className="row" style={{ gap:6, flexWrap:"wrap" }}>
                        <span className="badge" style={{ background: ELEMENT_BADGE_BG[t.element] }}>{cap(t.element)}</span>
                        <span className="badge">{t.frequency === "weekly" ? "This week done" : "Done today"}</span>
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}
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
      )}

      {/* ===== LIBRARY TAB ===== */}
      {tab === "library" && (
        <div className="card" style={{ marginBottom:12 }}>
          <div className="big">Library</div>
          <div className="small" style={{ marginTop:6, opacity:0.9 }}>
            Track creatures you’ve seen and owned. Unknown species show as silhouettes until owned.
          </div>

          {/* ✅ Overall summary */}
          <div className="row" style={{ gap:8, flexWrap:"wrap", marginTop:10 }}>
            <span className="badge">
              Overall: {overallOwned}/{overallTotal} ({overallPct}%)
            </span>
          </div>

          {ELEMENTS.map((el)=> {
            const stats = elementCounts(el);
            return (
              <div key={el} style={{ marginTop:14 }}>
                <div className="small" style={{ fontWeight:700, marginBottom:6 }}>
                  {cap(el)} — {stats.owned}/{stats.total} ({stats.pct}%)
                </div>
                <div style={{ display:"grid", gap:8 }}>
                  {[...libraryByElement[el].entries()].map(([rootId, line])=>{
                    return (
                      <div key={rootId} className="row" style={{ gap:8, alignItems:"center", flexWrap:"wrap" }}>
                        {line.map(sp=>{
                          const owned = !!state.meta.pokedex?.[sp.id]?.owned;
                          const seen = !!state.meta.pokedex?.[sp.id]?.seen;
                          const art = sp?.sprite || "/egg.png";
                          return (
                            <div key={sp.id} style={{
                              display:"grid", justifyItems:"center", padding:"6px 8px",
                              border:"1px solid rgba(255,255,255,0.12)", borderRadius:8, minWidth:90
                            }}>
                              <img
                                src={art}
                                alt={sp.name}
                                width="48"
                                height="48"
                                style={{
                                  imageRendering:"pixelated",
                                  filter: owned ? "none" : "grayscale(1) brightness(0) contrast(1)"
                                }}
                                onError={(e)=>{ e.currentTarget.style.opacity = 0.5; }}
                              />
                              <div className="small" style={{ marginTop:4, textAlign:"center" }}>
                                {owned ? sp.name : "???"}
                              </div>
                              <div className="small" style={{ opacity:0.7 }}>
                                {seen ? (owned ? "Owned" : "Seen") : "—"}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Settings (floating ⚙️ opens this card inline) */}
      {showSettings && (
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

          <div className="row" style={{ marginTop:8, gap:8, flexWrap:"wrap" }}>
            {/* Links moved to persistent footer */}
            <button
              className="btn"
              onClick={()=>setState(s=>({ ...s, meta:{ ...s.meta, onboardingDone: false } }))}
              title="Replay the tutorial on next load"
            >
              Replay Tutorial Next Load
            </button>
          </div>
        </div>
      )}

      {/* ✅ Persistent Footer */}
      <footer
        style={{
          marginTop:20,
          padding:"12px 0",
          borderTop:"1px solid rgba(255,255,255,0.12)",
          textAlign:"center",
          opacity:0.8,
          fontSize:"0.9em"
        }}
      >
        <a
          href="https://forms.gle/qbmrn6Bmtveezgt68"
          target="_blank"
          rel="noreferrer"
          className="btn"
          style={{ marginRight:8 }}
        >
          Feedback
        </a>
        <a
          href="https://ko-fi.com/growlingshabithatchlings"
          target="_blank"
          rel="noreferrer"
          className="btn"
        >
          Support Growlings ♥
        </a>
      </footer>

      {/* Floating gear */}
      <button
        className="btn"
        onClick={()=>setShowSettings(v=>!v)}
        title="Settings"
        style={{
          position:"fixed", right:16, bottom:16, zIndex:9999,
          borderRadius:24, padding:"10px 14px"
        }}
      >
        ⚙️
      </button>

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
                const owned = !!state.meta.pokedex?.[sp?.id || ""]?.owned;
                return (
                  <button
                    key={i}
                    className="btn"
                    style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-start" }}
                    onClick={() => confirmEvolution(ev)}
                  >
                    <img
                      src={art}
                      alt={sp?.name || "Evolution"}
                      width="32"
                      height="32"
                      style={{
                        imageRendering: "pixelated",
                        filter: owned ? "none" : "grayscale(1) brightness(0) contrast(1)"
                      }}
                    />
                    <div style={{ textAlign: "left" }}>
                      <div style={{ fontWeight: 700 }}>{owned ? (sp?.name || "???") : "???"}</div>
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

      {/* ✅ Evolution Congrats Modal */}
      {showEvoCongrats && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.55)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:10000
        }}>
          <div className="card" style={{ maxWidth:460, width:"92%", padding:16, textAlign:"center" }}>
            <div className="big">Evolution Complete!</div>
            <div className="small" style={{ marginTop:6 }}>
              {(showEvoCongrats.from?.name || "Your Growling")} evolved into <strong>{showEvoCongrats.to?.name || "a new form"}</strong> 🎉
            </div>

            <div className="row" style={{ gap:16, alignItems:"center", justifyContent:"center", marginTop:12 }}>
              <div style={{ display:"grid", justifyItems:"center" }}>
                <img
                  src={showEvoCongrats.from?.sprite || "/egg.png"}
                  width="64" height="64" alt={showEvoCongrats.from?.name || "From"}
                  style={{ imageRendering:"pixelated" }}
                />
                <div className="small" style={{ opacity:0.85, marginTop:4 }}>{showEvoCongrats.from?.name || "—"}</div>
              </div>
              <div className="big">→</div>
              <div style={{ display:"grid", justifyItems:"center" }}>
                <img
                  src={showEvoCongrats.to?.sprite || "/egg.png"}
                  width="64" height="64" alt={showEvoCongrats.to?.name || "To"}
                  style={{ imageRendering:"pixelated" }}
                />
                <div className="small" style={{ opacity:0.85, marginTop:4 }}>{showEvoCongrats.to?.name || "—"}</div>
              </div>
            </div>

            <div className="row" style={{ marginTop:12, justifyContent:"center" }}>
              <button className="btn" onClick={()=>setShowEvoCongrats(null)}>Sweet!</button>
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
              {levelToast.xpToNext <= 0 ? "Keep going!" : `${levelToast.xpToNext} XP to next level.`}
            </div>
            <div className="row" style={{ marginTop:12, justifyContent:"center" }}>
              <button className="btn" onClick={()=>setLevelToast(null)}>Nice!</button>
            </div>
          </div>
        </div>
      )}

      {/* Shop Modal */}
      {showShop && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999
        }}>
          <div className="card" style={{ maxWidth:420, width:"90%", padding:16 }}>
            <div className="big">Shop</div>
            <div className="small" style={{ marginTop:6, opacity:0.9 }}>
              💎 {state.meta.gems || 0} gems available
            </div>

            {/* Buy Egg */}
            <div className="row" style={{ marginTop:12, gap:8, alignItems:"center", justifyContent:"space-between" }}>
              <div className="row" style={{ gap:8, alignItems:"center" }}>
                <img src="/egg.png" width="24" height="24" style={{ imageRendering:"pixelated" }} alt="Egg" />
                <div className="small"><strong>Buy Egg</strong> — 20 💎</div>
              </div>
              <button className="btn" disabled={(state.meta.gems||0) < 20} onClick={buyEgg}>
                {(state.meta.gems||0) < 20 ? "Not enough" : "Buy"}
              </button>
            </div>

            {/* Buy Candies (5 gems each) */}
            <div className="small" style={{ marginTop:12, opacity:0.9 }}>Candies — 5 💎 each</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:6 }}>
              {ELEMENTS.map(el=>(
                <div key={el} className="row" style={{ alignItems:"center", justifyContent:"space-between", border:"1px solid rgba(255,255,255,0.12)", borderRadius:8, padding:"6px 8px" }}>
                  <div className="row" style={{ gap:8, alignItems:"center" }}>
                    <span className="badge" style={{ background: ELEMENT_BADGE_BG[el] }}>{cap(el)}</span>
                    <div className="small">x {state.candies[el]}</div>
                  </div>
                  <button
                    className="btn"
                    disabled={(state.meta.gems||0) < 5}
                    onClick={()=>{
                      setState(s=>{
                        const next = structuredClone(s);
                        if ((next.meta.gems||0) < 5) return s;
                        next.meta.gems -= 5;
                        next.candies[el] = (next.candies[el]||0) + 1;
                        return next;
                      })
                    }}
                  >
                    {(state.meta.gems||0) < 5 ? "Need 5💎" : "Buy"}
                  </button>
                </div>
              ))}
            </div>

            <div className="row" style={{ marginTop:12, justifyContent:"flex-end" }}>
              <button className="btn" onClick={()=>setShowShop(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Team Modal */}
      {showManageTeam && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999
        }}>
          <div className="card" style={{ maxWidth:520, width:"95%", padding:16 }}>
            <div className="big">Manage Team (max 6)</div>
            <div className="small" style={{ marginTop:6, opacity:0.9 }}>
              Select which eggs/creatures show on your home carousel.
            </div>
            <div style={{
              marginTop:12, display:"grid",
              gridTemplateColumns:"repeat(auto-fill, minmax(120px, 1fr))",
              gap:8
            }}>
              {state.stable.map((slot, idx) => {
                const chosen = state.activeTeam.includes(idx);
                const sp = slot.creature?.speciesId ? dex.getSpecies(slot.creature.speciesId) : null;
                const art = sp?.sprite || "/egg.png";
                const label = sp?.name || "Egg";
                return (
                  <button
                    key={idx}
                    className="btn"
                    onClick={() => toggleTeamMember(idx)}
                    title={chosen ? "Remove from team" : "Add to team"}
                    style={{
                      display:"grid", gap:6, justifyItems:"center",
                      border: chosen ? "2px solid #8ad" : "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 10, padding: 10
                    }}
                  >
                    <img src={art} width="32" height="32" style={{ imageRendering:"pixelated" }} alt={label} />
                    <div className="small" style={{ fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:100 }}>
                      {label}
                    </div>
                    <div className="small" style={{ opacity:0.8 }}>{chosen ? "Selected" : "Tap to select"}</div>
                  </button>
                );
              })}
            </div>
            <div className="row" style={{ marginTop:12, justifyContent:"flex-end", gap:8 }}>
              <div className="small" style={{ opacity:0.85 }}>Selected: {state.activeTeam.length} / 6</div>
              <button className="btn" onClick={()=>setShowManageTeam(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Creature Profile Modal */}
      {showProfile && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999
        }}>
          <div className="card" style={{ maxWidth:420, width:"95%", padding:16 }}>
            <div className="big">Profile</div>
            {creature ? (
              <>
                <div className="row" style={{ gap:10, alignItems:"center", marginTop:8 }}>
                  <img src={sprite} width="48" height="48" style={{ imageRendering:"pixelated" }} alt={creature.name} />
                  <div>
                    <div className="small" style={{ fontWeight:700 }}>{nickDisplay}</div>
                    <div className="small" style={{ opacity:0.8 }}>{caps(creature.elements || [])}</div>
                  </div>
                </div>
                <div className="small" style={{ marginTop:10 }}>
                  Total Creature XP: <strong>{activeCreature.xpTotal || 0}</strong>
                </div>
                <div className="row" style={{ flexWrap:"wrap", gap:8, marginTop:6 }}>
                  {ELEMENTS.map(el=>(
                    <span key={el} className="badge">{cap(el)} XP: {activeCreature.xpByElement?.[el] || 0}</span>
                  ))}
                </div>
              </>
            ) : (
              <div className="small" style={{ marginTop:8 }}>No creature yet — hatch your egg!</div>
            )}
            <div className="row" style={{ marginTop:12, justifyContent:"flex-end" }}>
              <button className="btn" onClick={()=>setShowProfile(false)}>Close</button>
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
