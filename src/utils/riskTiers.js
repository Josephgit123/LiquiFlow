// Mirrors PAYMENT_FLOW.md's public tier table exactly — for the Landing
// Page's illustrative fee/split simulator ONLY. This is a marketing
// demonstration of LiquiFlow's publicly documented business rules,
// computed entirely client-side (no backend call). It is NOT used
// anywhere in the real transaction pipeline — that logic lives in
// backend/src/services/riskEngine.js and vaultService.js, which this
// file never touches, imports, or duplicates for real scoring purposes.
export const RISK_TIERS = [
  { id: 'LOW', label: 'Low Risk', reservePercent: 5, holdDuration: 'T+3 days' },
  { id: 'MEDIUM', label: 'Medium Risk', reservePercent: 15, holdDuration: 'T+5 days' },
  { id: 'HIGH', label: 'High Risk', reservePercent: 30, holdDuration: 'T+7 days' },
];

// Illustrative platform fee for the simulator — matches
// systemConfigService.js's DEFAULT_PLATFORM_FEE_PERCENT fallback (2%).
// Not a live-read value; the simulator makes no backend call.
export const ILLUSTRATIVE_PLATFORM_FEE_PERCENT = 2;

export function calculateIllustrativeSplit(amountGross, tier) {
  const feeDeduction = Number((amountGross * (ILLUSTRATIVE_PLATFORM_FEE_PERCENT / 100)).toFixed(2));
  const reserveAllocation = Number((amountGross * (tier.reservePercent / 100)).toFixed(2));
  const liquidAllocation = Number((amountGross - reserveAllocation - feeDeduction).toFixed(2));
  return { liquidAllocation, reserveAllocation, feeDeduction };
}
