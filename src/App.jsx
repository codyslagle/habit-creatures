import { useEffect, useMemo, useState } from "react";
import { loadDexFromCSV, ELEMENTS } from "./data/csvDexLoader";

const blankTally = () => ({
  fire: 0, water: 0, earth: 0, air: 0, light: 0, metal: 0, heart: 0,
});

const loadState = () => {
  try {
    const raw = localStorage.getItem("hc-state");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const saveState = (s) =>
  localStorage.setItem("hc-state", JSON.stringify(s));

const initialState = {
  candies: { fire: 0, water: 0, earth: 0, air: 0, light: 0, metal: 0, heart: 0 },
  egg: { progress: 0, cost: 5, element: null, tally: blankTally() },
  creature: { speciesId: null, nickname: null },
};

function pickDominantElement(availableCandies, validElements) {
  const counts = validElements.map((e) => ({
    e,
    n: availableCandies[e] || 0,
  }));
  counts.sort((a, b) => b.n - a.n);
  const top = counts[0];
  if (!top || top.n === 0) return null;
  const ties = counts.filter((c) => c.n === top.n).map((c) => c.e);
  return ties[Math.floor(Math.random() * ties.length)];
}

function canAfford(candies, cost) {
  return Object.entries(cost).every(
    ([el, amt]) => (candies[el] || 0) >= amt
  );
}

export default function App() {
  const [state, setState] = useState(() => loadState() || initialState);
  const [dex, setDex] = useState({
    DEX: {},
    getSpecies: () => null,
    findBaseByElement: () => null,
    ready: false,
  });

  // Load DEX data once
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
    return () => {
      active = false;
    };
  }, []);

  // Persist state
  useEffect(() => {
    saveState(state);
  }, [state]);

  const creature = state.creature.speciesId
    ? dex.getSpecies(state.creature.speciesId)
    : null;

  function earnCandy(el) {
    setState((s) => ({
      ...s,
      candies: { ...s.candies, [el]: s.candies[el] + 1 },
    }));
  }

  function feedCandy(el) {
    setState((s) => {
      if (s.creature.speciesId) return s;
      if (s.egg.progress >= s.egg.cost) return s;
      if (s.candies[el] <= 0) return s;

      const next = structuredClone(s);
      next.candies[el]--;
      next.egg.progress += 1;
      next.egg.tally[el] += 1;
      return next;
    });
  }

  function hatchIfReady() {
    setState((s) => {
      if (s.creature.speciesId || s.egg.progress < s.egg.cost) return s;
      const dominant = pickDominantElement(s.egg.tally, ELEMENTS) || "fire";
      const base = dex.findBaseByElement(dominant);
      if (!base) return s;

      return {
        ...s,
        egg: { progress: 0, cost: s.egg.cost, element: dominant, tally: blankTally() },
        creature: { speciesId: base.id, nickname: null },
      };
    });
  }

  function evolve() {
    setState((s) => {
      if (!s.creature.speciesId) return s;
      const current = dex.getSpecies(s.creature.speciesId);
      if (!current?.evolutions?.length) return s;

      // Which evolutions can we afford
      const affordable = current.evolutions.filter((ev) =>
        canAfford(s.candies, ev.cost)
      );
      if (!affordable.length) return s;

      // Pick first affordable branch (simple rule)
      const chosen = affordable[0];
      const next = structuredClone(s);

      // Deduct candies
      Object.entries(chosen.cost).forEach(([el, amt]) => {
        next.candies[el] = Math.max(0, (next.candies[el] || 0) - amt);
      });

      next.creature.speciesId = chosen.to;
      return next;
    });
  }

  const sprite = useMemo(() => {
    if (!creature) return "/egg.png";
    return creature.sprite || `/sprites/${creature.id}.png`;
  }, [creature]);

  const progressPct = Math.round((state.egg.progress / state.egg.cost) * 100);
  const eggIsFull = state.egg.progress >= state.egg.cost;

  const speciesName = creature?.name || "Egg";
  const sublabel = creature
    ? `${creature.elements.join(" / ")} — ${
        creature.stage === 0 ? "Base" : `Stage ${creature.stage}`
      }`
    : "";

  if (!dex.ready) {
    return (
      <div className="container">
        <div className="card">
          <div className="big">Loading Growlings data…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="big">Growlings — Habit Hatchlings (MVP)</div>
        <div className="small">Data Source: Spreadsheet</div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div className="small">Current</div>
            <div className="big">{speciesName}</div>
            {!!creature && (
              <div className="small" style={{ opacity: 0.8, marginTop: 2 }}>
                {sublabel}
              </div>
            )}
          </div>
          <div className="sprite">
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
        <div style={{ marginTop: 12 }}>
          <div className="small">Egg progress</div>
          <div className="progress"><div style={{ width: `${progressPct}%` }} /></div>
          <div className="small" style={{ marginTop: 6 }}>
            {state.egg.progress}/{state.egg.cost}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            {ELEMENTS.map((el) => (
              <button
                key={el}
                className="btn"
                disabled={!!creature || eggIsFull}
                onClick={() => feedCandy(el)}
              >
                Feed {el}
              </button>
            ))}
            <button
              className="btn"
              disabled={!!creature || !eggIsFull}
              onClick={hatchIfReady}
            >
              Hatch
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="big">Tasks</div>
        <div className="small">Earn candies</div>
        <div className="row" style={{ marginTop: 8 }}>
          {ELEMENTS.map((el) => (
            <button key={el} className="btn" onClick={() => earnCandy(el)}>
              Task: {el}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          {ELEMENTS.map((el) => (
            <span key={el} className="badge">
              {el}: {state.candies[el]}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="big">Evolve</div>
        <div className="small">Meet the required candy costs to evolve</div>
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="btn"
            onClick={evolve}
            disabled={!creature || !(creature.evolutions?.length)}
          >
            Evolve
          </button>
          <button className="btn" onClick={() => setState(initialState)}>
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
