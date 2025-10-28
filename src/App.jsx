import { useEffect, useMemo, useState } from "react";
import { loadDexFromCSV, ELEMENTS } from "./data/csvDexLoader";

// helpers
const blankTally = () => ({ fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 });
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const caps = (arr) => arr.map(cap).join(" / ");
const loadState = () => {
  try { const raw = localStorage.getItem("hc-state"); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
};
const saveState = (s) => localStorage.setItem("hc-state", JSON.stringify(s));
const totalCost = (ev) => Object.values(ev.cost || {}).reduce((a,b)=>a+(b||0), 0);
const canAfford = (candies, cost) => Object.entries(cost || {}).every(([el, amt]) => (candies[el] || 0) >= amt);
const formatCost = (cost) => {
  const parts = Object.entries(cost || {})
    .filter(([,amt]) => amt > 0)
    .map(([el,amt]) => `${amt} ${cap(el)}`);
  return parts.length ? parts.join(" + ") : "—";
};

const initialState = {
  candies: { fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 },
  egg: { progress: 0, cost: 5, element: null, tally: blankTally() },
  creature: { speciesId: null, nickname: null },
};

function pickDominantElement(availableCandies, validElements) {
  const counts = validElements.map(e => ({ e, n: (availableCandies?.[e] || 0) }));
  counts.sort((a,b)=>b.n-a.n);
  const top = counts[0];
  if (!top || top.n === 0) return null;
  const ties = counts.filter(c => c.n === top.n).map(c=>c.e);
  return ties[Math.floor(Math.random()*ties.length)];
}

export default function App() {
  const [state, setState] = useState(() => loadState() || initialState);
  const [dex, setDex] = useState({
    DEX: {}, getSpecies: () => null, findBaseByElement: () => null, ready: false,
  });

  // UI state for evolution chooser
  const [showEvoModal, setShowEvoModal] = useState(false);
  const [evoChoices, setEvoChoices] = useState([]); // array of { to, cost, branchBy? }

  // Load DEX (CSV) once
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

  // Persist state
  useEffect(() => { saveState(state); }, [state]);

  const creature = state.creature.speciesId ? dex.getSpecies(state.creature.speciesId) : null;

  function earnCandy(el) {
    setState((s) => ({
      ...s, candies: { ...s.candies, [el]: s.candies[el] + 1 },
    }));
  }

  function feedCandy(el) {
    setState((s) => {
      if (s.creature.speciesId) return s;               // already hatched
      if (s.egg.progress >= s.egg.cost) return s;       // egg full
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

  // New: choose evolution path when there are multiple same-cost options.
  function tryEvolve() {
    if (!creature) return;

    const evos = creature.evolutions || [];
    if (!evos.length) return;

    // Which are affordable right now?
    const affordable = evos.filter((ev) => canAfford(state.candies, ev.cost));
    if (!affordable.length) return;

    // Group affordable by total cost; choose among the cheapest bucket
    const byCost = affordable.reduce((acc, ev) => {
      const k = totalCost(ev);
      (acc[k] ||= []).push(ev);
      return acc;
    }, {});
    const cheapest = Math.min(...Object.keys(byCost).map(Number));
    const cheapestSet = byCost[cheapest];

    if (cheapestSet.length === 1) {
      // Single obvious path → evolve immediately
      confirmEvolution(cheapestSet[0]);
    } else {
      // Multiple equal-cost paths → open modal and let the player choose
      setEvoChoices(cheapestSet);
      setShowEvoModal(true);
    }
  }

  function confirmEvolution(chosen) {
    setState((s) => {
      if (!s.creature.speciesId) return s;
      const next = structuredClone(s);
      // pay candy cost
      Object.entries(chosen.cost || {}).forEach(([el, amt]) => {
        next.candies[el] = Math.max(0, (next.candies[el] || 0) - amt);
      });
      // set new species
      next.creature.speciesId = chosen.to;
      return next;
    });
    setShowEvoModal(false);
    setEvoChoices([]);
  }

  // Sprites & labels
  const sprite = useMemo(() => {
    if (!creature) return "/egg.png";
    return creature.sprite || `/sprites/${creature.id}.png`;
  }, [creature]);

  const progressPct = Math.round((state.egg.progress / state.egg.cost) * 100);
  const eggIsFull = state.egg.progress >= state.egg.cost;

  const speciesName = creature?.name || "Egg";
  const sublabel = creature
    ? `${caps(creature.elements || [])} — ${creature.stage === 0 ? "Base" : `Stage ${creature.stage}`}`
    : "";

  if (!dex.ready) {
    return (
      <div className="container">
        <div className="card"><div className="big">Loading Growlings data…</div></div>
      </div>
    );
  }

  // Evolution info
  const currentEvos = creature?.evolutions || [];
  const hasEvos = currentEvos.length > 0;
  const hasAffordable = currentEvos.some((ev) => canAfford(state.candies, ev.cost));
  const isFinal = !!creature && !hasEvos;

  const evolveSubtitle = !creature
    ? "Hatch a creature first."
    : isFinal
    ? "This Growling is in its final form."
    : "Choose your path when multiple evolutions are possible.";

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
              <>
                <div className="small" style={{ opacity: 0.8, marginTop: 2 }}>
                  {sublabel}
                </div>
                {isFinal && (
                  <div
                    className="small"
                    style={{
                      display: "inline-block",
                      marginTop: 6,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      fontWeight: 600,
                    }}
                  >
                    Final Form
                  </div>
                )}
              </>
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
          <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
            {ELEMENTS.map((el) => (
              <button
                key={el}
                className="btn"
                disabled={!!creature || eggIsFull}
                onClick={() => feedCandy(el)}
              >
                Feed {cap(el)}
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

      {/* Evolution: info + action */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="big">Evolve</div>
        <div className="small">{evolveSubtitle}</div>

        {/* Evolution options or final form note */}
        {!!creature && hasEvos && (
          <div style={{ marginTop: 10 }}>
            <div className="small" style={{ marginBottom: 6 }}>Available Evolutions</div>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              {currentEvos.map((ev, idx) => {
                const sp = dex.getSpecies(ev.to);
                const can = canAfford(state.candies, ev.cost);
                const art = sp?.sprite || "/egg.png"; // later: silhouette support
                return (
                  <div key={idx} className="row" style={{
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8,
                    opacity: can ? 1 : 0.6
                  }}>
                    <img src={art} alt={sp?.name || "Evolution"} width="32" height="32" style={{ imageRendering: "pixelated" }} />
                    <div>
                      <div className="small" style={{ fontWeight: 600 }}>{sp?.name || "???"}</div>
                      <div className="small" style={{ opacity: 0.8 }}>Cost: {formatCost(ev.cost)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!hasEvos && !!creature && (
          <div className="small" style={{ marginTop: 10, opacity: 0.85 }}>
            No further evolutions available for this species (for now).
          </div>
        )}

        <div className="row" style={{ marginTop: 10 }}>
          {isFinal ? (
            <button className="btn" disabled title="This Growling is already at its final form">
              Final Form
            </button>
          ) : (
            <button
              className="btn"
              onClick={tryEvolve}
              disabled={!creature || !hasAffordable}
              title={!creature ? "Hatch a creature first" : (!hasAffordable ? "Not enough candies yet" : "Evolve")}
            >
              {hasAffordable ? "Evolve" : "Cannot Evolve Yet"}
            </button>
          )}
          <button className="btn" onClick={() => setState(initialState)}>Reset</button>
        </div>
      </div>

      {/* Tasks */}
      <div className="card">
        <div className="big">Tasks</div>
        <div className="small">Earn candies</div>
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
          {ELEMENTS.map((el) => (
            <button key={el} className="btn" onClick={() => earnCandy(el)}>
              Task: {cap(el)}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}>
          {ELEMENTS.map((el) => (
            <span key={el} className="badge">{cap(el)}: {state.candies[el]}</span>
          ))}
        </div>
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
              Which path would you like {creature?.name} to take?
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              {evoChoices.map((ev, i) => {
                const sp = dex.getSpecies(ev.to);
                const art = sp?.sprite || "/egg.png"; // later: sprite_sil support
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
    </div>
  );
}
