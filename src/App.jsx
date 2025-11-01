// Full file: src/App.jsx
import { useEffect, useMemo, useState } from "react";
import { loadDexFromCSV, ELEMENTS } from "./data/csvDexLoader";
import suggestions from "./data/taskSuggestions.json";

/* ===================== Helpers & Constants ===================== */

import { SPRITE_BOX_PX } from "./constants/ui";
import {
  nowISO, localDateStr, addDays, addWeeks, addMonthsClamped,
  startOfWeek, weekKeyBy, lastDayOfMonth,
  nowWithOffset, todayKeyWithOffset, weekKeyWithOffset
} from "./utils/dates";
const blankTally = () => ({ fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 });
const blankXPByEl = () => ({ fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 });
const canAfford = (candies, cost) =>
  Object.entries(cost || {}).every(([el, amt]) => (candies[el] || 0) >= amt);
import { cap, caps, pluralize, formatCost } from "./utils/text";
import { clamp, totalCost, CREATURE_STAGE_MULT } from "./utils/num";
import { xpToLevel, levelInfoFromTotalXP, creatureLevelInfo, nextLevelAt } from "./utils/xp";
import { DAY_SHORT, XP_BY_DIFFICULTY, ELEMENT_LABEL, ELEMENT_BADGE_BG } from "./utils/tasks";
import { isDueTodayAdvanced, canCompleteNowAdvanced } from "./logic/recurrence";
import { initialState } from "./state/initial";
import { loadState, saveState, newTask, withDefaults } from "./state/storage";

// Date helpers
function sameDayKey(a, b) { return localDateStr(a) === localDateStr(b); }

/* ===================== Save & Migration ===================== */

const SAVE_VERSION = 8; // bumped for snooze logic + hatch modal + creature level toast + filters
const STORAGE_KEY = "hc-state";

// New flexible recurrence fields (kept optional for migration safety):
// frequency: 'once'|'daily'|'weekly'|'days'|'monthly'|'monthly_last_day'|'everyXDays'|'everyXWeeks'|'everyXMonths'|'yearly'
// fields: weeklyDay, daysOfWeek[], monthlyDay(1..31), everyX(number), yearlyMonth(0..11), yearlyDay(1..31)
// anchorDayKey (creation day), snoozeUntilKey (skip mechanic)

function migrateTask(t) {
  return {
    weeklyDay: (typeof t.weeklyDay === "number" ? t.weeklyDay : null),
    daysOfWeek: Array.isArray(t.daysOfWeek) ? t.daysOfWeek : [],
    monthlyDay: (typeof t.monthlyDay === "number" ? t.monthlyDay : null),
    everyX: (typeof t.everyX === "number" && t.everyX > 0) ? t.everyX : null,
    yearlyMonth: (typeof t.yearlyMonth === "number" ? t.yearlyMonth : null),
    yearlyDay: (typeof t.yearlyDay === "number" ? t.yearlyDay : null),
    anchorDayKey: t.anchorDayKey || (t.createdAtISO ? localDateStr(new Date(t.createdAtISO)) : localDateStr(new Date())),
    lastCompletedMonthKey: t.lastCompletedMonthKey || null,
    lastCompletedYear: t.lastCompletedYear || null,
    snoozeUntilKey: t.snoozeUntilKey || null,
    ...t
  };
}

/* ===================== Recurrence Engine ===================== */

function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }

/* ===================== App ===================== */

export default function App() {
  const [state, setState] = useState(() => loadState() || initialState);
  const [dex, setDex] = useState({ DEX: {}, getSpecies: () => null, findBaseByElement: () => null, ready: false, order: [] });

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
  const [taskMonthlyDay, setTaskMonthlyDay] = useState(1);   // for 'monthly'
  const [taskEveryX, setTaskEveryX] = useState(2);           // for everyX*
  const [taskYearlyMonth, setTaskYearlyMonth] = useState(0); // 0..11
  const [taskYearlyDay, setTaskYearlyDay] = useState(1);     // 1..31
  const [taskAnchorDayKey, setTaskAnchorDayKey] = useState(localDateStr(new Date())); // NEW
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Task list controls + search
  const [filterElement, setFilterElement] = useState("all");
  const [filterOccur, setFilterOccur] = useState("all");
  const [sortMode, setSortMode] = useState("element"); // 'element' | 'title'
  const [taskSearch, setTaskSearch] = useState(localStorage.getItem("hc-task-search") || "");
  const [searchDebounce, setSearchDebounce] = useState(taskSearch);

  useEffect(() => {
    const id = setTimeout(() => setTaskSearch(searchDebounce), 250);
    return () => clearTimeout(id);
  }, [searchDebounce]);
  useEffect(() => { localStorage.setItem("hc-task-search", taskSearch); }, [taskSearch]);

  // Inline edit
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);

  // Skip modal
  const [skipTarget, setSkipTarget] = useState(null); // { taskId, choices:[{label, keyToSet}] }

  // Trainer Level-up toast
  const [levelToast, setLevelToast] = useState(null); // { level, xpToNext }

  // Creature Level-up (queue)
  const [creatureLevelToast, setCreatureLevelToast] = useState(null); // current toast
  const [creatureToastQueue, setCreatureToastQueue] = useState([]);   // pending toasts

  // Status bar UI
  const [showXPTooltip, setShowXPTooltip] = useState(false);
  const [showShop, setShowShop] = useState(false);

  // Manage Team modal (paged 30/page)
  const [showManageTeam, setShowManageTeam] = useState(false);
  const [teamPage, setTeamPage] = useState(0);
  const TEAM_PAGE_SIZE = 30;

  // Evolution & Hatch Congrats modal state
  const [showEvoCongrats, setShowEvoCongrats] = useState(null); // { from, to }
  const [showHatchCongrats, setShowHatchCongrats] = useState(null); // { to }

  /* ----- DEX load ----- */
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const loaded = await loadDexFromCSV();
        if (active) setDex({ ...loaded, ready: true, order: loaded.order || [] });
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
  const activeStableIndex = team[state.activeIndex] ?? team[0] ?? 0;
  const active = state.stable[activeStableIndex] ?? state.stable[0];
  const activeEgg = active.egg;
  const activeCreature = active.creature;
  const activeSpecies = activeCreature?.speciesId ? dex.getSpecies(activeCreature.speciesId) : null;

  const sprite = useMemo(
    () => (activeSpecies ? (activeSpecies.sprite || `/sprites/${activeSpecies.id}.png`) : "/egg.png"),
    [activeSpecies]
  );

  /* ===================== Slot helpers ===================== */

  function setActiveSlot(updater) {
    setState((s) => {
      const next = structuredClone(s);
      const ai = Math.max(0, Math.min(next.activeTeam.length - 1, next.activeIndex || 0));
      const stableIndex = (next.activeTeam[ai] ?? 0);
      const slot = next.stable[stableIndex];
      if (!slot) return s;
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

  function openManageTeam() { setTeamPage(0); setShowManageTeam(true); }
  function toggleTeamMember(stableIndex) {
    setState((s)=>{
      const next = structuredClone(s);
      const pos = next.activeTeam.indexOf(stableIndex);
      if (pos >= 0) {
        next.activeTeam.splice(pos, 1);
        if (next.activeIndex >= next.activeTeam.length) next.activeIndex = Math.max(0, next.activeTeam.length - 1);
      } else {
        if (next.activeTeam.length >= 6) return s;
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
      setTimeout(() => { setLevelToast({ level: newInfo.level, xpToNext: newInfo.xpToNext }); }, 0);
    } else {
      next.meta.level = newInfo.level;
    }
  }

  // Queue a creature level-up toast
  function enqueueCreatureToast(payload) {
    setCreatureToastQueue(q => {
      const nextQ = [...q, payload];
      if (!creatureLevelToast) {
        // nothing showing; show immediately
        const first = nextQ[0];
        setCreatureLevelToast(first);
        return nextQ.slice(1);
        }
      return nextQ;
    });
  }
  function dismissCreatureToast() {
    setCreatureLevelToast(null);
    setCreatureToastQueue(q => {
      if (q.length === 0) return q;
      const [first, ...rest] = q;
      setCreatureLevelToast(first);
      return rest;
    });
  }

  // Dev candy (+5 candies, +5 XP trainer, +5 XP each active creature)
  function earnCandyDev(el) {
    setState((s) => {
      const next = structuredClone(s);

      maybeBumpStreakAndGems(next);

      // +5 candies of chosen element
      next.candies[el] = (next.candies[el] || 0) + 5;

      // Trainer XP (+5) and element XP
      const xpGain = 5;
      awardXP(next, xpGain);
      next.meta.xpByElement[el] = (next.meta.xpByElement[el] || 0) + xpGain;

      // Each active creature gains +5 XP and per-element XP
      for (const idx2 of next.activeTeam) {
        const before = s.stable[idx2];
        const after = next.stable[idx2];
        if (after?.creature?.speciesId) {
          after.creature.xpTotal += xpGain;
          after.creature.xpByElement[el] = (after.creature.xpByElement[el] || 0) + xpGain;

          const sp = dex.getSpecies(after.creature.speciesId);
          if (sp) {
            const prevLv = creatureLevelInfo(before.creature.xpTotal || 0, sp.stage || 0).level;
            const nowLv  = creatureLevelInfo(after.creature.xpTotal || 0,  sp.stage || 0).level;
            if (nowLv > prevLv) {
              const name = after.creature.nickname || sp.name || "Your Growling";
              const spr = sp.sprite || `/sprites/${sp.id}.png`;
              setTimeout(() => enqueueCreatureToast({ name, toLevel: nowLv, sprite: spr }), 0);
            }
          }
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
      if (!slot) return s;
      if (slot.creature?.speciesId) return s;
      if (slot.egg.progress >= slot.egg.cost) return s;
      if ((next.candies[el]||0) <= 0) return s;
      next.candies[el]--;
      slot.egg.progress += 1;
      slot.egg.tally[el] += 1;
      return next;
    });
  }

  function pickDominantElement(tally, order) {
    // choose highest tally; tie-break by ELEMENTS order
    let bestEl = order[0], bestVal = -1;
    for (const el of order) {
      const v = tally[el] || 0;
      if (v > bestVal) { bestVal = v; bestEl = el; }
    }
    return bestEl;
  }

  function hatchIfReady() {
    setState((s) => {
      const next = structuredClone(s);

      if (!dex.ready) return s;
      const ai = Math.max(0, Math.min(next.activeTeam.length - 1, next.activeIndex || 0));
      const stableIdx = next.activeTeam[ai] ?? 0;
      const slot = next.stable[stableIdx];
      if (!slot) return s;

      if (slot.creature?.speciesId) return s;
      if (slot.egg.progress < slot.egg.cost) return s;

      const dominant = pickDominantElement(slot.egg.tally, ELEMENTS) || "fire";
      const base = typeof dex.findBaseByElement === "function" ? dex.findBaseByElement(dominant) : null;
      if (!base) {
        // Safe guard: if no base found for element, do nothing instead of crashing
        return s;
      }

      // Reset egg & set creature
      slot.egg = { progress: 0, cost: slot.egg.cost, element: dominant, tally: blankTally() };
      slot.creature = { speciesId: base.id, nickname: null, happiness: 60, xpTotal: 0, xpByElement: blankXPByEl() };
      markOwnedLineage(next, base.id);

      // Show hatch modal
      setTimeout(() => setShowHatchCongrats({ to: dex.getSpecies(base.id) }), 0);

      return next;
    });
  }

  function tryEvolve() {
    if (!activeSpecies) return;
    const evos = activeSpecies.evolutions || [];
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

    // Mark as seen
    setState((s) => {
      const next = structuredClone(s);
      for (const ev of cheapestSet) markSeen(next, ev.to);
      return next;
    });

    if (cheapestSet.length === 1) confirmEvolution(cheapestSet[0]);
    else { setEvoChoices(cheapestSet); setShowEvoModal(true); }
  }

  function confirmEvolution(chosen) {
    const fromSp = activeSpecies ? dex.getSpecies(activeSpecies.id) : null;
    const toSp = dex.getSpecies(chosen.to);

    setState((s) => {
      const next = structuredClone(s);
      const slot = next.stable[next.activeTeam[next.activeIndex] ?? 0];
      if (!slot?.creature?.speciesId) return s;

      Object.entries(chosen.cost || {}).forEach(([el, amt]) => {
        next.candies[el] = Math.max(0, (next.candies[el] || 0) - amt);
      });
      slot.creature.speciesId = chosen.to;
      if (slot.creature.happiness != null) {
        slot.creature.happiness = clamp((slot.creature.happiness || 0) + 5, 0, 100);
      }
      markOwnedLineage(next, chosen.to);
      return next;
    });

    setShowEvoCongrats({ from: fromSp, to: toSp });
    setShowEvoModal(false);
    setEvoChoices([]);
  }

  /* ===================== Tasks: CRUD / Complete / Edit / Skip ===================== */

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
        daysOfWeek: taskFrequency === "days" ? [...taskDays] : [],
        monthlyDay: taskFrequency === "monthly" ? clamp(taskMonthlyDay,1,31) : null,
        everyX: (taskFrequency.startsWith("everyX") ? Math.max(1, Number(taskEveryX)||1) : null),
        yearlyMonth: taskFrequency === "yearly" ? taskYearlyMonth : null,
        yearlyDay: taskFrequency === "yearly" ? clamp(taskYearlyDay,1,31) : null,
        anchorDayKey: (taskFrequency.startsWith("everyX") ? taskAnchorDayKey : localDateStr(new Date()))
      }));
      return next;
    });
    setTaskTitle("");
    setTaskDays([]);
    setTaskWeeklyDay(null);
    setTaskAnchorDayKey(localDateStr(new Date()));
  }

  function deleteTask(id) {
    setState((s) => {
      const next = structuredClone(s);
      next.tasks = next.tasks.filter(t => t.id !== id);
      return next;
    });
  }

  function creatureLevelCheckAndToast(next, slotBefore, slotAfter) {
    if (!slotBefore?.creature?.speciesId || !slotAfter?.creature?.speciesId) return;
    const sp = dex.getSpecies(slotAfter.creature.speciesId);
    if (!sp) return;
    const prev = creatureLevelInfo(slotBefore.creature.xpTotal || 0, sp.stage || 0).level;
    const now = creatureLevelInfo(slotAfter.creature.xpTotal || 0, sp.stage || 0).level;
    if (now > prev) {
      const name = slotAfter.creature.nickname || sp.name || "Your Growling";
      const spr = sp.sprite || `/sprites/${sp.id}.png`;
      setTimeout(() => enqueueCreatureToast({ name, toLevel: now, sprite: spr }), 0);
    }
  }

  function completeTask(id) {
    setState((s) => {
      const idx = s.tasks.findIndex(t => t.id === id);
      if (idx === -1) return s;
      const task = s.tasks[idx];
      if (!canCompleteNowAdvanced(task, todayDate, todayKey, wkKey, todayDayIndex, state.meta.weekStartDay)) return s;

      const next = structuredClone(s);
      const t = next.tasks[idx];

      maybeBumpStreakAndGems(next);
      maybeAwardDailyGems(next);

      next.candies[t.element] = (next.candies[t.element] || 0) + 1;

      const xpGain = XP_BY_DIFFICULTY[t.difficulty] || 0;
      awardXP(next, xpGain);
      next.meta.xpByElement[t.element] = (next.meta.xpByElement[t.element] || 0) + xpGain;

      // Party XP and creature level-up toast checks
      for (const idx2 of next.activeTeam) {
        const slotBefore = s.stable[idx2];
        const slotAfter  = next.stable[idx2];
        if (slotAfter?.creature?.speciesId) {
          slotAfter.creature.xpTotal += xpGain;
          slotAfter.creature.xpByElement[t.element] = (slotAfter.creature.xpByElement[t.element] || 0) + xpGain;
          markSeen(next, slotAfter.creature.speciesId);
          creatureLevelCheckAndToast(next, slotBefore, slotAfter);
        }
      }

      // Mark complete for period + clear snooze
      if (t.frequency === "once") t.doneOnce = true;
      else if (t.frequency === "weekly" || t.frequency === "everyXWeeks") t.lastCompletedWeekKey = wkKey;
      else if (t.frequency === "monthly" || t.frequency === "monthly_last_day" || t.frequency === "everyXMonths") t.lastCompletedMonthKey = monthKey(todayDate);
      else if (t.frequency === "yearly") t.lastCompletedYear = todayDate.getFullYear();
      else t.lastCompletedDayKey = todayKey; // daily, days, everyXDays

      t.snoozeUntilKey = null;

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
      daysOfWeek: Array.isArray(t.daysOfWeek) ? [...t.daysOfWeek] : [],
      monthlyDay: (typeof t.monthlyDay === "number" ? t.monthlyDay : 1),
      everyX: (typeof t.everyX === "number" ? t.everyX : 2),
      yearlyMonth: (typeof t.yearlyMonth === "number" ? t.yearlyMonth : 0),
      yearlyDay: (typeof t.yearlyDay === "number" ? t.yearlyDay : 1),
      anchorDayKey: t.anchorDayKey || localDateStr(new Date())
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
          daysOfWeek: editDraft.frequency === "days" ? [...(editDraft.daysOfWeek||[])] : [],
          monthlyDay: editDraft.frequency === "monthly" ? clamp(Number(editDraft.monthlyDay)||1,1,31) : null,
          everyX: editDraft.frequency.startsWith("everyX") ? Math.max(1, Number(editDraft.everyX)||1) : null,
          yearlyMonth: editDraft.frequency === "yearly" ? Number(editDraft.yearlyMonth)||0 : null,
          yearlyDay: editDraft.frequency === "yearly" ? clamp(Number(editDraft.yearlyDay)||1,1,31) : null,
          anchorDayKey: editDraft.frequency.startsWith("everyX") ? (editDraft.anchorDayKey || localDateStr(new Date())) : prev.anchorDayKey
        };
      }
      return next;
    });
    setEditingTaskId(null);
    setEditDraft(null);
  }

  // Skip UI — always: Tomorrow, Next Week, Next Month
  function requestSkip(t) {
    const tomorrow = localDateStr(addDays(todayDate, 1));
    const nextWeek = localDateStr(addWeeks(todayDate, 1));
    const nextMonth = localDateStr(addMonthsClamped(todayDate, 1));
    setSkipTarget({
      taskId: t.id,
      choices: [
        { label: `Tomorrow (${tomorrow})`, key: tomorrow },
        { label: `Next Week (${nextWeek})`, key: nextWeek },
        { label: `Next Month (${nextMonth})`, key: nextMonth },
      ]
    });
  }
  function performSkip(choiceKey) {
    if (!skipTarget) return;
    setState(s => {
      const next = structuredClone(s);
      const idx = next.tasks.findIndex(x => x.id === skipTarget.taskId);
      if (idx !== -1) {
        next.tasks[idx].snoozeUntilKey = choiceKey;
      }
      return next;
    });
    setSkipTarget(null);
  }

  /* ===================== Derived UI Lists (incl. search) ===================== */

  function bySort(a,b) {
    if (sortMode === "title") return a.title.localeCompare(b.title);
    if (a.element !== b.element) return a.element.localeCompare(b.element);
    return a.title.localeCompare(b.title);
  }

  const searchLC = (taskSearch || "").toLowerCase();

  const visibleTasksBase = state.tasks
    .filter(t => filterElement === "all" ? true : t.element === filterElement)
    .filter(t => {
      if (filterOccur === "all") return true;
      const f = t.frequency;
      switch (filterOccur) {
        case "once":
        case "daily":
        case "weekly":
        case "days":
        case "monthly":
        case "monthly_last_day":
        case "everyXDays":
        case "everyXWeeks":
        case "everyXMonths":
        case "yearly":
          return f === filterOccur;
        default:
          return true;
      }
    })
    .filter(t => {
      if (!searchLC) return true;
      return (t.title || "").toLowerCase().includes(searchLC);
    });

  const dueTodayFilter = (t) => {
    const due = isDueTodayAdvanced(t, todayDate, todayKey, wkKey, todayDayIndex, state.meta.weekStartDay);
    // If snoozed date has passed/equal, auto-clear label on re-entry (no lingering "Snoozed" look)
    if (t.snoozeUntilKey && todayKey >= t.snoozeUntilKey) {
      t.snoozeUntilKey = null;
    }
    return due;
  };

  const tasksToday = visibleTasksBase
    .filter(dueTodayFilter)
    .filter(t => canCompleteNowAdvanced(t, todayDate, todayKey, wkKey, todayDayIndex, state.meta.weekStartDay))
    .sort(bySort);

  const tasksAll = visibleTasksBase.slice().sort(bySort);

  const completedToday = visibleTasksBase
    .filter(t => {
      const due = isDueTodayAdvanced(t, todayDate, todayKey, wkKey, todayDayIndex, state.meta.weekStartDay);
      const canDo = canCompleteNowAdvanced(t, todayDate, todayKey, wkKey, todayDayIndex, state.meta.weekStartDay);
      return due && !canDo;
    })
    .sort(bySort);

  /* ===================== Level values (for status bar) ===================== */
  const lvlInfo = levelInfoFromTotalXP(state.meta.xpTotal || 0);
  const xpPct = Math.max(0, Math.min(100, Math.round((lvlInfo.currentIntoLevel / lvlInfo.neededForLevel) * 100)));

  /* ===================== Library (Growlings index) ===================== */

  // Use CSV row order if provided by loader (`order`), else DEX values
  const allSpecies = useMemo(() => {
    if (!dex.ready) return [];
    if (Array.isArray(dex.order) && dex.order.length) {
      return dex.order.map(id => dex.DEX[id]).filter(Boolean);
    }
    // Fallback: deterministic by id
    return Object.values(dex.DEX || {}).sort((a,b)=> (a.csvIndex ?? 0) - (b.csvIndex ?? 0) || a.id.localeCompare(b.id));
  }, [dex]);

  function getRootId(sp) {
    let cur = sp;
    const seen = new Set();
    while (cur?.parentId) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      cur = dex.getSpecies(cur.parentId);
    }
    return cur?.id || sp.id;
  }

  // Construct per-root evolutionary display order:
  // Base → Stage1-A → all children of A (depth-first) → Stage1-B → all children of B → ...
  const libraryByElement = useMemo(() => {
    const byEl = {};
    for (const el of ELEMENTS) byEl[el] = new Map(); // rootId -> [species in desired order]

    // Precompute children adjacency & csv index
    const children = new Map(); // parentId -> [child species]
    const idToSp = new Map();
    for (const sp of allSpecies) {
      idToSp.set(sp.id, sp);
    }
    for (const sp of allSpecies) {
      if (sp.parentId) {
        const arr = children.get(sp.parentId) || [];
        arr.push(sp);
        children.set(sp.parentId, arr);
      }
    }
    // Sort children of each parent by csv index then id for stability
    for (const [pid, arr] of children.entries()) {
      arr.sort((a,b)=> (a.csvIndex ?? 0) - (b.csvIndex ?? 0) || a.id.localeCompare(b.id));
    }

    function traverseFromStage1(stage1) {
      const out = [stage1];
      const stack = [...(children.get(stage1.id) || []).slice().reverse()]; // DFS using stack
      while (stack.length) {
        const node = stack.pop();
        out.push(node);
        const kids = children.get(node.id) || [];
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      }
      return out;
    }

    // Build element -> root lines
    for (const sp of allSpecies) {
      const primary = sp?.elements?.[0];
      if (!primary || !ELEMENTS.includes(primary)) continue;
      const rootId = getRootId(sp);
      if (!byEl[primary].has(rootId)) byEl[primary].set(rootId, null); // fill later
    }

    // For each root line, build proper order
    for (const el of ELEMENTS) {
      for (const [rootId] of byEl[el].entries()) {
        const root = idToSp.get(rootId);
        if (!root) { byEl[el].set(rootId, []); continue; }
        const stage1s = (children.get(rootId) || []).slice(); // pre-sorted
        const line = [root];
        for (const s1 of stage1s) {
          line.push(...traverseFromStage1(s1));
        }
        byEl[el].set(rootId, line);
      }
    }

    return byEl;
  }, [allSpecies, dex]);

  // Owned stats
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
      for (const sp of (line || [])) {
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

  const speciesName = activeSpecies?.name || "Egg";
  const nickDisplay = activeCreature.nickname || speciesName;
  const sublabel = activeSpecies
    ? `${caps(activeSpecies.elements || [])} — ${activeSpecies.stage === 0 ? "Base" : `Stage ${activeSpecies.stage}`}`
    : "";

  // Active creature level UI
  const activeCreatureLevelInfo = activeSpecies
    ? creatureLevelInfo(activeCreature.xpTotal || 0, activeSpecies.stage || 0)
    : null;
  const activeCreaturePct = activeCreatureLevelInfo
    ? Math.max(0, Math.min(100, Math.round((activeCreatureLevelInfo.currentIntoLevel / activeCreatureLevelInfo.neededForLevel) * 100)))
    : 0;

  // Nickname editing
  const [editingNick, setEditingNick] = useState(false);
  function startEditNick() { if (activeSpecies) setEditingNick(true); }
  function saveNick(e) {
    const value = (e.target.value || "").trim();
    setState((s) => {
      const next = structuredClone(s);
      const slot = next.stable[next.activeTeam[next.activeIndex] ?? 0];
      if (!slot?.creature?.speciesId) return s;
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

  const currentEvos = activeSpecies?.evolutions || [];
  const evoCount = currentEvos.length;
  const hasEvos = evoCount > 0;
  const hasAffordable = currentEvos.some((ev) => canAfford(state.candies, ev.cost));
  const isFinal = !!activeSpecies && !hasEvos;
  const evolveSubtitle = !activeSpecies
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
                        {!!activeSpecies && (
                          <button className="btn" style={{ padding: 4, minWidth: 0 }} onClick={startEditNick} title="Edit nickname">
                            <img src="/ui/icons/16px/icon_edit.png" width="16" height="16" alt="Edit" style={{ imageRendering: "pixelated", display: "block" }} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {!!activeSpecies && <div className="small" style={{ opacity: 0.8, marginTop: 2 }}>{sublabel}</div>}
                </div>

                <div className="sprite" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap:6 }}>
                  <img
                    src={sprite}
                    alt="creature"
                    width={SPRITE_BOX_PX}
                    height={SPRITE_BOX_PX}
                    style={{ imageRendering: "pixelated" }}
                    onError={(e) => { e.currentTarget.src = "/egg.png"; }}
                  />
                  {/* Level UI below sprite, fixed width to match sprite box */}
                  {!!activeSpecies && (
                    <div style={{ display:"grid", gap:4, justifyItems:"center", width: SPRITE_BOX_PX }}>
                      <div className="small">Lv. {activeCreatureLevelInfo.level}</div>
                      <div
                        className="progress"
                        title={`${activeCreatureLevelInfo.currentIntoLevel} / ${activeCreatureLevelInfo.neededForLevel} XP`}
                        style={{ width: SPRITE_BOX_PX }}
                      >
                        <div style={{ width: `${activeCreaturePct}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Egg/Hatch — only before hatch */}
          {!activeSpecies && (
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
          {activeSpecies && (
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
                    <button key={el} className="btn" onClick={() => earnCandyDev(el)}>+5 {cap(el)} (dev)</button>
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

            {/* Search + List Controls */}
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input
                className="input"
                style={{ minWidth: 200 }}
                placeholder="Search tasks…"
                value={searchDebounce}
                onChange={(e) => setSearchDebounce(e.target.value)}
                title="Type to filter by task title"
              />
              <select className="input" value={filterElement} onChange={(e)=>setFilterElement(e.target.value)} style={{ fontFamily: "var(--font-body, inherit)" }}>
                <option value="all">All Elements</option>
                {ELEMENTS.map(el => <option key={el} value={el}>{cap(el)}</option>)}
              </select>
              <select className="input" value={sortMode} onChange={(e)=>setSortMode(e.target.value)} style={{ fontFamily: "var(--font-body, inherit)" }}>
                <option value="element">Sort by Element</option>
                <option value="title">Sort by Title</option>
              </select>
              <select className="input" value={filterOccur} onChange={(e)=>setFilterOccur(e.target.value)} style={{ fontFamily: "var(--font-body, inherit)" }}>
                <option value="all">All Frequencies</option>
                <option value="once">One-time</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="days">Specific Days</option>
                <option value="monthly">Monthly (on day)</option>
                <option value="monthly_last_day">Monthly (last day)</option>
                <option value="everyXDays">Every X days</option>
                <option value="everyXWeeks">Every X weeks</option>
                <option value="everyXMonths">Every X months</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>
          <div className="small" style={{ marginTop:4 }}>Create tasks, then complete them to earn candies, XP, and daily 💎.</div>

  {/* Add task form (compact) */}
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <input
              className="input"
              style={{ minWidth: 240 }}
              placeholder="Task title (e.g., Go for a walk)"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addTask(); }}
            />
            <select className="input" value={taskElement} onChange={(e) => setTaskElement(e.target.value)} style={{ fontFamily: "var(--font-body, inherit)" }}>
              {ELEMENTS.map(el => <option key={el} value={el}>{ELEMENT_LABEL[el]}</option>)}
            </select>
            <select className="input" value={taskDifficulty} onChange={(e) => setTaskDifficulty(e.target.value)} style={{ fontFamily: "var(--font-body, inherit)" }}>
              <option value="easy">Easy (5 XP)</option>
              <option value="med">Medium (10 XP)</option>
              <option value="hard">Hard (20 XP)</option>
            </select>
            <select className="input" value={taskFrequency} onChange={(e) => setTaskFrequency(e.target.value)} style={{ fontFamily: "var(--font-body, inherit)" }}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="days">Specific Days</option>
              <option value="once">One-time</option>
              <option value="monthly">Monthly (on day)</option>
              <option value="monthly_last_day">Monthly (last day)</option>
              <option value="everyXDays">Every X days</option>
              <option value="everyXWeeks">Every X weeks</option>
              <option value="everyXMonths">Every X months</option>
              <option value="yearly">Yearly</option>
            </select>

            {taskFrequency === "weekly" && (
              <select className="input" value={taskWeeklyDay ?? ""} onChange={(e)=>setTaskWeeklyDay(e.target.value===""?null:Number(e.target.value))} style={{ fontFamily: "var(--font-body, inherit)" }}>
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

            {taskFrequency === "monthly" && (
              <input
                className="input"
                type="number"
                min={1}
                max={31}
                value={taskMonthlyDay}
                onChange={(e)=>setTaskMonthlyDay(clamp(Number(e.target.value)||1,1,31))}
                style={{ width:80 }}
                title="Day of month (1–31)"
              />
            )}

            {taskFrequency.startsWith("everyX") && (
              <>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={taskEveryX}
                  onChange={(e)=>setTaskEveryX(Math.max(1, Number(e.target.value)||1))}
                  style={{ width:90 }}
                  title="Interval (X)"
                />
                <label className="small" style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
                  <span>Start On:</span>
                  <input
                    className="input"
                    type="date"
                    value={taskAnchorDayKey}
                    onChange={(e)=>setTaskAnchorDayKey(e.target.value || localDateStr(new Date()))}
                    style={{ width:160 }}
                    title="Anchor date for the every-X schedule"
                  />
                </label>
              </>
            )}

            {taskFrequency === "yearly" && (
              <>
                <select className="input" value={taskYearlyMonth} onChange={(e)=>setTaskYearlyMonth(Number(e.target.value))} style={{ fontFamily: "var(--font-body, inherit)" }}>
                  {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m,i)=>(
                    <option key={i} value={i}>{m}</option>
                  ))}
                </select>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={31}
                  value={taskYearlyDay}
                  onChange={(e)=>setTaskYearlyDay(clamp(Number(e.target.value)||1,1,31))}
                  style={{ width:80 }}
                  title="Day of month"
                />
              </>
            )}

            <button className="btn" onClick={addTask}>Add Task</button>
          </div>

          {/* Suggestions (collapsed by default; toggleable) */}
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
                  ? renderTaskRow(t)
                  : (
                    <div
                      key={t.id}
                      className="row"
                      onClick={()=>startEditTask(t)}
                      style={{
                        justifyContent:"space-between",
                        alignItems:"center",
                        padding:"6px 10px",
                        border:"1px solid rgba(255,255,255,0.12)",
                        borderRadius:8,
                        opacity:0.9,
                        cursor: "pointer",
                        gap: 8,
                        flexWrap: "wrap"
                      }}>
                      {/* WRAP long task titles on mobile */}
                      <div className="small" style={{ fontWeight:700, whiteSpace:"normal", wordBreak:"break-word", maxWidth:"100%" }}>
                        {t.title}
                      </div>
                      <div className="row" style={{ gap:6, flexWrap:"wrap" }}>
                        <span className="badge" style={{ background: ELEMENT_BADGE_BG[t.element] }}>{cap(t.element)}</span>
                        <span className="badge">Done</span>
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
            Track creatures you’ve collected. Unknown species show as silhouettes until owned.
          </div>

          {/* Overall summary */}
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
                        {(line || []).map(sp=>{
                          const owned = !!state.meta.pokedex?.[sp.id]?.owned;
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

      {/* Settings */}
      {showSettings && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="big">Settings</div>
          <div className="row" style={{ marginTop:8, gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <div className="small" style={{ opacity:0.9 }}>Week starts on:</div>
            <select
              className="input"
              value={state.meta.weekStartDay}
              onChange={(e)=>setState(s=>({ ...s, meta:{ ...s.meta, weekStartDay: Number(e.target.value) } }))}
              style={{ fontFamily: "var(--font-body, inherit)" }}
            >
              {DAY_SHORT.map((d,i)=><option key={i} value={i}>{d}</option>)}
            </select>
          </div>

          <div className="row" style={{ marginTop:8, gap:8, flexWrap:"wrap" }}>
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

      {/* Footer */}
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
              {activeSpecies?.name} can evolve!
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

      {/* Evolution Congrats Modal */}
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

      {/* Hatch Congrats Modal */}
      {showHatchCongrats && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.55)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:10000
        }}>
          <div className="card" style={{ maxWidth:460, width:"92%", padding:16, textAlign:"center" }}>
            <div className="big">Your egg hatched!</div>
            <div className="small" style={{ marginTop:6 }}>
              It hatched into <strong>{showHatchCongrats.to?.name || "a new creature"}</strong> 🎉
            </div>

            <div className="row" style={{ gap:16, alignItems:"center", justifyContent:"center", marginTop:12 }}>
              <div style={{ display:"grid", justifyItems:"center" }}>
                <img
                  src={"/egg.png"}
                  width="64" height="64" alt="Egg"
                  style={{ imageRendering:"pixelated" }}
                />
                <div className="small" style={{ opacity:0.85, marginTop:4 }}>Egg</div>
              </div>
              <div className="big">→</div>
              <div style={{ display:"grid", justifyItems:"center" }}>
                <img
                  src={showHatchCongrats.to?.sprite || "/egg.png"}
                  width="64" height="64" alt={showHatchCongrats.to?.name || "New"}
                  style={{ imageRendering:"pixelated" }}
                />
                <div className="small" style={{ opacity:0.85, marginTop:4 }}>{showHatchCongrats.to?.name || "—"}</div>
              </div>
            </div>

            <div className="row" style={{ marginTop:12, justifyContent:"center" }}>
              <button className="btn" onClick={()=>setShowHatchCongrats(null)}>Sweet!</button>
            </div>
          </div>
        </div>
      )}

      {/* Trainer Level Up Toast */}
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

      {/* Creature Level Up Toast (queued) */}
      {creatureLevelToast && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:10001
        }}>
          <div className="card" style={{ maxWidth:380, width:"90%", padding:16, textAlign:"center" }}>
            <div className="big">Level Up!</div>
            <div className="row" style={{ gap:10, alignItems:"center", justifyContent:"center", marginTop:8 }}>
              <img src={creatureLevelToast.sprite} width="48" height="48" style={{ imageRendering:"pixelated" }} alt="Creature" />
              <div className="small"><strong>{creatureLevelToast.name}</strong> grew to <strong>Level {creatureLevelToast.toLevel}</strong>! 🎉</div>
            </div>
            <div className="row" style={{ marginTop:12, justifyContent:"center" }}>
              <button className="btn" onClick={dismissCreatureToast}>Sweet!</button>
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

      {/* Manage Team Modal — responsive grid icons (30/page) with scroll fallback */}
      {showManageTeam && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.5)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999
        }}>
          <div className="card" style={{ maxWidth:560, width:"95%", padding:16, display:"grid", gap:10 }}>
            <div className="row" style={{ justifyContent:"space-between", alignItems:"center" }}>
              <div className="big">Manage Team (max 6)</div>
              <div className="small">Selected: {state.activeTeam.length} / 6</div>
            </div>
            <div className="small" style={{ opacity:0.9 }}>
              Tap icons to toggle selection. Use arrows to switch pages of your stable.
            </div>

            <div className="row" style={{ justifyContent:"space-between", alignItems:"center", gap:8 }}>
              <button className="btn" onClick={()=>setTeamPage(p=>Math.max(0, p-1))} disabled={teamPage===0}>‹</button>
              <div className="small">Page {teamPage+1} / {Math.max(1, Math.ceil(state.stable.length / TEAM_PAGE_SIZE))}</div>
              <button className="btn" onClick={()=>setTeamPage(p=>{
                const maxP = Math.max(0, Math.ceil(state.stable.length / TEAM_PAGE_SIZE)-1);
                return Math.min(maxP, p+1);
              })} disabled={teamPage >= Math.ceil(state.stable.length / TEAM_PAGE_SIZE)-1}>›</button>
            </div>

            {/* Scroll container prevents "Done" from being pushed off-screen on phones */}
            <div style={{ maxHeight: "60vh", overflow: "auto", paddingRight:4 }}>
              <div
                style={{
                  display:"grid",
                  // Responsive: shrink tiles automatically; no horizontal scroll
                  gridTemplateColumns:"repeat(auto-fill, minmax(72px, 1fr))",
                  gap:8
                }}
              >
                {state.stable.slice(teamPage*TEAM_PAGE_SIZE, (teamPage+1)*TEAM_PAGE_SIZE).map((slot, i) => {
                  const idx = teamPage*TEAM_PAGE_SIZE + i;
                  const chosenPos = state.activeTeam.indexOf(idx);
                  const chosen = chosenPos >= 0;
                  const sp = slot.creature?.speciesId ? dex.getSpecies(slot.creature.speciesId) : null;
                  const art = sp?.sprite || "/egg.png";
                  return (
                    <button
                      key={idx}
                      className="btn"
                      onClick={() => toggleTeamMember(idx)}
                      title={chosen ? "Remove from team" : "Add to team"}
                      style={{
                        width:"100%", height:72,
                        padding:6,
                        borderRadius:10,
                        border: chosen ? "2px solid #8ad" : "1px solid rgba(255,255,255,0.12)",
                        display:"grid",
                        placeItems:"center",
                        position:"relative"
                      }}
                    >
                      <img src={art} width="40" height="40" style={{ imageRendering:"pixelated" }} alt={sp?.name || "Egg"} />
                      {chosen && (
                        <div
                          className="small"
                          style={{
                            position:"absolute", top:4, left:4,
                            background:"rgba(20,20,40,0.8)",
                            padding:"1px 5px", borderRadius:6, border:"1px solid rgba(255,255,255,0.2)"
                          }}
                        >
                          {chosenPos+1}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="row" style={{ justifyContent:"flex-end" }}>
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
            <div className="big">Summary</div>
            {activeSpecies ? (
              <>
                <div className="row" style={{ gap:10, alignItems:"center", marginTop:8 }}>
                  <img src={sprite} width="48" height="48" style={{ imageRendering:"pixelated" }} alt={activeSpecies.name} />
                  <div>
                    <div className="small" style={{ fontWeight:700 }}>{nickDisplay}</div>
                    <div className="small" style={{ opacity:0.8 }}>{caps(activeSpecies.elements || [])}</div>
                  </div>
                </div>
                <div className="small" style={{ marginTop:10 }}>
                  Lv. {activeCreatureLevelInfo.level} — {activeCreatureLevelInfo.currentIntoLevel} / {activeCreatureLevelInfo.neededForLevel} XP
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

      {/* Skip Modal */}
      {skipTarget && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999 }}>
          <div className="card" style={{ maxWidth:360, width:"90%", padding:16 }}>
            <div className="big">Skip this occurrence?</div>
            <div className="small" style={{ marginTop:6, opacity:0.9 }}>Choose when to see it again:</div>
            <div style={{ display:"grid", gap:8, marginTop:10 }}>
              {skipTarget.choices.map((c, i)=>(
                <button key={i} className="btn" onClick={()=>performSkip(c.key)}>{c.label}</button>
              ))}
            </div>
            <div className="row" style={{ marginTop:10, justifyContent:"flex-end" }}>
              <button className="btn" onClick={()=>setSkipTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  /* ===== Task Row Renderer ===== */
  function renderTaskRow(t) {
    const canDo = canCompleteNowAdvanced(t, todayDate, todayKey, wkKey, todayDayIndex, state.meta.weekStartDay);

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
              <select className="input" value={editDraft.element} onChange={(e)=>setEditDraft(d=>({ ...d, element: e.target.value }))} style={{ fontFamily: "var(--font-body, inherit)" }}>
                {ELEMENTS.map(el => <option key={el} value={el}>{ELEMENT_LABEL[el]}</option>)}
              </select>
              <select className="input" value={editDraft.difficulty} onChange={(e)=>setEditDraft(d=>({ ...d, difficulty: e.target.value }))} style={{ fontFamily: "var(--font-body, inherit)" }}>
                <option value="easy">Easy (5 XP)</option>
                <option value="med">Medium (10 XP)</option>
                <option value="hard">Hard (20 XP)</option>
              </select>
              <select className="input" value={editDraft.frequency} onChange={(e)=>setEditDraft(d=>({ ...d, frequency: e.target.value }))} style={{ fontFamily: "var(--font-body, inherit)" }}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="days">Specific Days</option>
                <option value="once">One-time</option>
                <option value="monthly">Monthly (on day)</option>
                <option value="monthly_last_day">Monthly (last day)</option>
                <option value="everyXDays">Every X days</option>
                <option value="everyXWeeks">Every X weeks</option>
                <option value="everyXMonths">Every X months</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>

            {editDraft.frequency === "weekly" && (
              <select className="input" value={editDraft.weeklyDay ?? ""} onChange={(e)=>setEditDraft(d=>({ ...d, weeklyDay: e.target.value===""?null:Number(e.target.value) }))} style={{ fontFamily: "var(--font-body, inherit)" }}>
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
                          return {
                            ...ed,
                            daysOfWeek: on
                              ? ed.daysOfWeek.filter(x => x !== i)
                              : [...(ed.daysOfWeek || []), i],
                          };
                        });
                      }}
                    />
                    {d}
                  </label>
                ))}
              </div>
            )}

            {editDraft.frequency === "monthly" && (
              <input
                className="input"
                type="number"
                min={1}
                max={31}
                value={editDraft.monthlyDay}
                onChange={(e)=>setEditDraft(d=>({ ...d, monthlyDay: clamp(Number(e.target.value)||1,1,31) }))}
                style={{ width: 90 }}
                title="Day of month (1–31)"
              />
            )}

            {editDraft.frequency && editDraft.frequency.startsWith("everyX") && (
              <div className="row" style={{ gap:6, flexWrap:"wrap" }}>
                <label className="small" style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
                  <span>X:</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={editDraft.everyX}
                    onChange={(e)=>setEditDraft(d=>({ ...d, everyX: Math.max(1, Number(e.target.value)||1) }))}
                    style={{ width: 90 }}
                    title="Interval (X)"
                  />
                </label>
                <label className="small" style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
                  <span>Start On:</span>
                  <input
                    className="input"
                    type="date"
                    value={editDraft.anchorDayKey}
                    onChange={(e)=>setEditDraft(d=>({ ...d, anchorDayKey: e.target.value || localDateStr(new Date()) }))}
                    style={{ width: 160 }}
                    title="Anchor date for the every-X schedule"
                  />
                </label>
              </div>
            )}

            {editDraft.frequency === "yearly" && (
              <div className="row" style={{ gap:6, flexWrap:"wrap" }}>
                <select
                  className="input"
                  value={editDraft.yearlyMonth}
                  onChange={(e)=>setEditDraft(d=>({ ...d, yearlyMonth: Number(e.target.value) }))}
                  style={{ fontFamily: "var(--font-body, inherit)" }}
                >
                  {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m,i)=>(
                    <option key={i} value={i}>{m}</option>
                  ))}
                </select>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={31}
                  value={editDraft.yearlyDay}
                  onChange={(e)=>setEditDraft(d=>({ ...d, yearlyDay: clamp(Number(e.target.value)||1,1,31) }))}
                  style={{ width: 90 }}
                  title="Day of month"
                />
              </div>
            )}
          </div>

          <div className="row" style={{ gap:6, alignItems:"center" }}>
            <button className="btn" onClick={saveEdit}>Save</button>
            <button className="btn" onClick={cancelEdit}>Cancel</button>
            <button
              className="btn"
              onClick={()=>{
                if (confirm("Delete this task? This cannot be undone.")) {
                  deleteTask(t.id);
                  cancelEdit();
                }
              }}
              title="Delete task"
            >
              Delete
            </button>
          </div>
        </div>
      );
    }

    // View mode
    const freqText = (() => {
      switch (t.frequency) {
        case "once": return "One-time";
        case "daily": return "Daily";
        case "weekly": return t.weeklyDay == null ? "Weekly" : `Weekly (${DAY_SHORT[t.weeklyDay]})`;
        case "days": return `Days: ${(t.daysOfWeek||[]).map(i=>DAY_SHORT[i]).join(", ") || "—"}`;
        case "monthly": return t.monthlyDay ? `Monthly (day ${t.monthlyDay})` : "Monthly";
        case "monthly_last_day": return "Monthly (last day)";
        case "everyXDays": return `Every ${t.everyX} day${t.everyX===1?"":"s"}`;
        case "everyXWeeks": return `Every ${t.everyX} week${t.everyX===1?"":"s"}`;
        case "everyXMonths": return `Every ${t.everyX} month${t.everyX===1?"":"s"}`;
        case "yearly": return t.yearlyMonth!=null && t.yearlyDay!=null
          ? `Yearly (${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][t.yearlyMonth]} ${t.yearlyDay})`
          : "Yearly";
        default: return "—";
      }
    })();

    const snoozed = !!t.snoozeUntilKey && todayKey < t.snoozeUntilKey;

    return (
      <div
        key={t.id}
        className="row"
        style={{
          justifyContent:"space-between",
          alignItems:"center",
          padding:"6px 10px",
          border:"1px solid rgba(255,255,255,0.12)",
          borderRadius:8,
          gap:8,
          flexWrap:"wrap"
        }}
      >
        <div style={{ minWidth: 200, flex: 1 }}>
          {/* WRAP long task titles instead of overflowing */}
          <div className="small" style={{ fontWeight:700, whiteSpace:"normal", wordBreak:"break-word", maxWidth:"100%" }}>
            {t.title}
          </div>
          <div className="row" style={{ gap:6, marginTop:4, flexWrap:"wrap" }}>
            <span className="badge" style={{ background: ELEMENT_BADGE_BG[t.element] }}>{cap(t.element)}</span>
            <span className="badge">{freqText}</span>
            {snoozed && <span className="badge">Snoozed until {t.snoozeUntilKey}</span>}
            {!canDo && isDueTodayAdvanced(t, todayDate, todayKey, wkKey, todayDayIndex, state.meta.weekStartDay) && (
              <span className="badge">Done Today</span>
            )}
          </div>
        </div>

        <div className="row" style={{ gap:6, flexWrap:"wrap" }}>
          <button
            className="btn"
            onClick={()=>canDo && completeTask(t.id)}
            disabled={!canDo}
            title={canDo ? "Complete task" : "Not available again yet"}
          >
            {canDo ? "Complete" : "—"}
          </button>
          <button className="btn" onClick={()=>requestSkip(t)} title="Skip this occurrence">Skip</button>
          <button className="btn" onClick={()=>startEditTask(t)} title="Edit task">Edit</button>
          <button
            className="btn"
            onClick={()=>{
              if (confirm("Delete this task? This cannot be undone.")) deleteTask(t.id);
            }}
            title="Delete task"
          >
            Delete
          </button>
        </div>
      </div>
    );
  }
}
