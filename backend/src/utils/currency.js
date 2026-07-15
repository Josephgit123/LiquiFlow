// Enforces the two-decimal float discipline (CLAUDE.md invariant #3).
// Always call this at the point of calculation, before any monetary
// value reaches a Firestore write.
export function normalizeCurrency(value) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(numeric)) {
    throw new TypeError(`normalizeCurrency: "${value}" is not a valid number.`);
  }
  return Number(numeric.toFixed(2));
}
