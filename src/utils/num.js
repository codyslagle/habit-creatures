export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const totalCost = (ev) => Object.values(ev?.cost || {}).reduce((a,b)=>a+(b||0), 0);
export const CREATURE_STAGE_MULT = { 0: 1.0, 1: 1.15, 2: 1.30 };
