export const SAVE_VERSION = 8;
export const blankTally = () => ({ fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 });
export const blankXPByEl = () => ({ fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 });

export const initialState = {
  candies: { fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 },
  stable: [{ egg: { progress: 0, cost: 3, element: null, tally: blankTally() },
             creature: { speciesId: null, nickname: null, happiness: null, xpTotal: 0, xpByElement: blankXPByEl() } }],
  activeTeam: [0],
  activeIndex: 0,
  tasks: [],
  meta: {
    lastSeenISO: null, saveVersion: SAVE_VERSION, lastActionLocalDate: null,
    lastGemAwardDayKey: null, streak: 0, xpTotal: 0,
    xpByElement: { fire:0, water:0, earth:0, air:0, light:0, metal:0, heart:0 },
    devOffsetDays: 0, weekStartDay: 0, level: 1, gems: 0, pokedex: {}
  }
};
