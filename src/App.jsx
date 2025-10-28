import { useEffect, useMemo, useState } from "react";

const ELEMENTS = ["fire","water","earth","air","light","metal","heart"];

// helper to create a zeroed tally for all elements
const blankTally = () => ({ fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 });

const loadState = () => {
  try {
    const raw = localStorage.getItem("hc-state");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const saveState = (s) => localStorage.setItem("hc-state", JSON.stringify(s));

const initialState = {
  candies: { fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 },
  // add a tally so we know what was FED during incubation
  egg: { progress: 0, cost: 5, element: null, tally: blankTally() },
  creature: { stage: 0, baseElement: null }
};

function pickDominantElement(availableCandies, validElements) {
  const counts = validElements.map(e => ({ e, n: availableCandies[e] || 0 }));
  counts.sort((a,b)=>b.n-a.n);
  const top = counts[0];
  if (!top || top.n === 0) return null;
  const ties = counts.filter(c => c.n === top.n).map(c=>c.e);
  return ties[Math.floor(Math.random()*ties.length)];
}

export default function App() {
  const [state, setState] = useState(()=> loadState() || initialState);
  useEffect(()=> { saveState(state); }, [state]);

  function earnCandy(el) {
    setState(s => ({ ...s, candies: { ...s.candies, [el]: s.candies[el]+1 }}));
  }

  // Prevent feeding beyond max; only tally/consume when there's room
  function feedCandy(el) {
    setState(s=>{
      // can't feed if creature already exists OR egg is already full
      if (s.creature.stage > 0 || s.egg.progress >= s.egg.cost) return s;
      if (s.candies[el] <= 0) return s;

      const next = structuredClone(s);
      next.candies[el]--;
      next.egg.progress += 1;              // guaranteed < cost due to guard
      next.egg.tally[el] += 1;             // record feed for hatch element decision
      return next;
    });
  }

  // choose dominant element from tally (not remaining bag), then reset tally
  function hatchIfReady() {
    setState(s=>{
      if (s.creature.stage>0 || s.egg.progress < s.egg.cost) return s;
      const dominant = pickDominantElement(s.egg.tally, ELEMENTS) || "fire";
      return {
        ...s,
        egg:{ progress:0, cost:s.egg.cost, element:dominant, tally: blankTally() },
        creature:{ stage:0, baseElement:dominant}
      };
    });
  }

  // evolve cost = 10
  function evolve() {
    setState(s=>{
      if (!s.creature.baseElement || s.creature.stage!==0) return s;
      const base=s.creature.baseElement;
      if (s.candies[base] < 10) return s;
      const next=structuredClone(s);
      next.candies[base] -= 10;
      next.creature.stage = 1;
      return next;
    });
  }

  // choose correct sprite by stage
  const sprite = useMemo(()=>{
    const el = state.creature.baseElement;
    const stage = state.creature.stage;

    if (!el) return "/egg.png";
    if (stage === 0) return `/slime-${el}.png`;
    if (stage === 1) return `/stage1-${el}.png`;

    return "/egg.png"; // fallback until Stage 2 exists
  }, [state.creature.baseElement, state.creature.stage]);

  const progressPct = Math.round((state.egg.progress/state.egg.cost)*100);
  const eggIsFull = state.egg.progress >= state.egg.cost;

  return (
    <div className="container">
      <div className="card" style={{marginBottom:12}}>
        <div className="big">Growlings — Habit Hatchlings (MVP)</div>
        <div className="small">Tap tasks to earn candies. Feed to hatch.</div>
      </div>

      <div className="card" style={{marginBottom:12}}>
        <div className="row" style={{alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div className="small">Current</div>
            <div className="big">
              {!state.creature.baseElement
                ? "Egg"
                : state.creature.stage === 0
                ? `${state.creature.baseElement} Slime`
                : `${state.creature.baseElement} — Stage 1`}
            </div>
          </div>
          <div className="sprite">
            <img src={sprite} alt="creature" width="64" height="64"/>
          </div>
        </div>
        <div style={{marginTop:12}}>
          <div className="small">Egg progress</div>
          <div className="progress"><div style={{width:`${progressPct}%`}} /></div>
          <div className="small" style={{marginTop:6}}>{state.egg.progress}/{state.egg.cost}</div>
          <div className="row" style={{marginTop:8}}>
            {ELEMENTS.map(el=>(
              <button
                key={el}
                className="btn"
                disabled={!!state.creature.baseElement || eggIsFull}
                onClick={()=>feedCandy(el)}
              >
                Feed {el}
              </button>
            ))}
            <button
              className="btn"
              disabled={!!state.creature.baseElement || !eggIsFull}
              onClick={hatchIfReady}
            >
              Hatch
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{marginBottom:12}}>
        <div className="big">Tasks</div>
        <div className="small">Earn candies</div>
        <div className="row" style={{marginTop:8}}>
          {ELEMENTS.map(el=>(
            <button key={el} className="btn" onClick={()=>earnCandy(el)}>Task: {el}</button>
          ))}
        </div>
        <div className="row" style={{marginTop:12}}>
          {ELEMENTS.map(el=>(
            <span key={el} className="badge">{el}: {state.candies[el]}</span>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="big">Evolve</div>
        <div className="small">10 candies needed</div>
        <div className="row" style={{marginTop:8}}>
          <button
            className="btn"
            onClick={evolve}
            disabled={
              !state.creature.baseElement ||
              state.creature.stage !== 0 ||
              state.candies[state.creature.baseElement] < 10
            }
          >
            Evolve
          </button>
          <button className="btn" onClick={()=>setState(initialState)}>Reset</button>
        </div>
      </div>
    </div>
  );
}
