export const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
export const caps = (arr) => arr.map(cap).join(" / ");
export const pluralize = (n, one, many) => (n === 1 ? one : many);
export const formatCost = (cost = {}) => {
  const parts = Object.entries(cost)
    .filter(([,amt]) => amt > 0)
    .map(([el,amt]) => `${amt} ${cap(el)}`);
  return parts.length ? parts.join(" + ") : "—";
};
