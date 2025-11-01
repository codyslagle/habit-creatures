export const xpToLevel = (level) => Math.round(100 * Math.pow(1.25, Math.max(0, level - 1)));
export function levelInfoFromTotalXP(totalXP) {
  let level = 1, spent = 0, need = xpToLevel(level);
  while (totalXP >= spent + need) { spent += need; level += 1; need = xpToLevel(level); }
  return { level, currentIntoLevel: totalXP - spent, neededForLevel: need, xpToNext: need - (totalXP - spent) };
}
export const nextLevelAt = (level) => xpToLevel(level);
export function creatureLevelInfo(totalXP, stage=0, multMap={0:1.0,1:1.15,2:1.30}) {
  let level = 1, spent = 0; const mult = multMap[String(stage)] ?? 1.0;
  const needAt = (lv) => Math.round(xpToLevel(lv) * mult);
  let need = needAt(level);
  while (totalXP >= spent + need) { spent += need; level += 1; need = needAt(level); }
  return { level, currentIntoLevel: totalXP - spent, neededForLevel: need, xpToNext: need - (totalXP - spent) };
}
