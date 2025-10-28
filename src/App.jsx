import { useEffect, useMemo, useState } from "react";

const ELEMENTS = ["fire","water","earth","air","light","metal","heart"];

const loadState = () => {
  try {
    const raw = localStorage.getItem("hc-state");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const saveState = (s) => localStorage.setItem("hc-state", JSON.stringify(s));

const initialState = {
  candies: { fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 },
  egg: { progress: 0, cost: 5, element: null },
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

  function feedCandy(el) {
    setState(s=>{
      if (s.candies[el] <= 0 || s.creature.stage>0) return s;
      const next = structuredClone(s);
      next.candies[el]--;
      next.egg.progress = Math.min(next.egg.cost, next.egg.progress+1);
      return next;
    });
  }

  function hatchIfReady() {
    setState(s=>{
      if (s.creature.stage>0 || s.egg.progress < s.egg.cost) return s;
      const dominant = pickDominantElement(s.candies, ELEMENTS) || "fire";
      return { ...s, egg:{...s.egg,progress:0,element:dominant}, creature:{stage:0,baseElement:dominant}};
    });
  }

  function evolve() {
    setState(s=>{
      if (!s.creature.baseElement || s.creature.stage!==0) return s;
      const base=s.creature.baseElement;
      if (s.candies[base]<20) return s;
      const next=structuredClone(s);
      next.candies[base]-=20;
      next.creature.stage=1;
      return next;
    });
  }

  const sprite = useMemo(()=>{
    if (!state.creature.baseElement) return "/egg.png";
    return `/slime-${state.creature.baseElement}.png`;
  }, [state.creature.baseElement]);

  const progressPct = Math.round((state.egg.progress/state.egg.cost)*100);

  return (
    <div className="container">
      <div className="card" style={{marginBottom:12}}>
        <div className="big">Habit Creatures — MVP</div>
        <div className="small">Tap tasks to earn candies. Feed to hatch.</div>
      </div>

      <div className="card" style={{marginBottom:12}}>
        <div className="row" style={{alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div className="small">Current</div>
            <div className="big">{state.creature.baseElement ? (state.creature.stage===0?"Slime":"Stage 1") : "Egg"}</div>
          </div>
          <div className="sprite">
            <img src={sprite} alt="creature" width="96" height="96"/>
          </div>
        </div>
        <div style={{marginTop:12}}>
          <div className="small">Egg progress</div>
          <div className="progress"><div style={{width:`${progressPct}%`}} /></div>
          <div className="small" style={{marginTop:6}}>{state.egg.progress}/{state.egg.cost}</div>
          <div className="row" style={{marginTop:8}}>
            {ELEMENTS.map(el=>(
              <button key={el} className="btn" disabled={!!state.creature.baseElement} onClick={()=>feedCandy(el)}>
                Feed {el}
              </button>
            ))}
            <button className="btn" disabled={!!state.creature.baseElement || state.egg.progress<state.egg.cost} onClick={hatchIfReady}>
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
        <div className="small">20 candies needed</div>
        <div className="row" style={{marginTop:8}}>
          <button className="btn" onClick={evolve} disabled={!state.creature.baseElement || state.creature.stage!==0 || state.candies[state.creature.baseElement]<20}>
            Evolve
          </button>
          <button className="btn" onClick={()=>setState(initialState)}>Reset</button>
        </div>
      </div>
    </div>
  );
}
