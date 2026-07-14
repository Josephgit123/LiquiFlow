// Risk engine error-handling philosophy: prefer throwing descriptive
// errors over silent defaults whenever a required input is missing or
// malformed. This is a financial risk-scoring path — an unhandled bad
// input (unrecognized industry, out-of-range score, etc.) must stop the
// transaction pipeline upstream, not quietly produce a wrong risk score.
// Do not casually add fallback defaults to work around a caller bug.

// CLAUDE.md invariant #9: score = industry weight + geographic
// discrepancy flag + velocity multiplier, additive only, capped 0-100.
const INDUSTRY_WEIGHTS = {
  GROCERY: 0,
  ELECTRONICS: 15,
  GAMING: 25,
  CRYPTO: 40,
};

const GEO_MISMATCH_WEIGHT = 20;
const HIGH_RISK_REGION_WEIGHT = 15;
const VELOCITY_WEIGHT = 35;

const VELOCITY_WINDOW_MS = 60000;

// CLAUDE.md reference table: tier -> liquid/reserve split + hold duration.
const TIER_TABLE = {
  LOW: { liquidPercent: 95, reservePercent: 5, holdDurationMs: 259200000 }, // T+3 days
  MEDIUM: { liquidPercent: 85, reservePercent: 15, holdDurationMs: 432000000 }, // T+5 days
  HIGH: { liquidPercent: 70, reservePercent: 30, holdDurationMs: 604800000 }, // T+7 days
};

/**
 * Function 1: computeRiskScore
 * Pure, synchronous. No Firestore access — callers pass in precomputed
 * flags (isHighRiskRegion, velocityFlag) so this stays fully unit-testable.
 */
export function computeRiskScore(input) {
  const { industryVector, cardIssuerCountry, ipCountry, isHighRiskRegion, velocityFlag } =
    input || {};

  if (!industryVector || !(industryVector in INDUSTRY_WEIGHTS)) {
    throw new Error(
      `computeRiskScore: unrecognized industryVector "${industryVector}". Must be one of ${Object.keys(
        INDUSTRY_WEIGHTS
      ).join(', ')} — refusing to default to 0 to avoid under-scoring.`
    );
  }
  const industryWeight = INDUSTRY_WEIGHTS[industryVector];

  // Geographic weight: mismatch (+20) and high-risk region (+15) are
  // independent, additive flags — they STACK. A mismatched high-risk
  // region is +35 (20 + 15), not an either/or choice between the two.
  let geoWeight = 0;
  if (cardIssuerCountry !== ipCountry) {
    geoWeight += GEO_MISMATCH_WEIGHT;
  }
  if (isHighRiskRegion) {
    geoWeight += HIGH_RISK_REGION_WEIGHT;
  }

  const velocityWeight = velocityFlag ? VELOCITY_WEIGHT : 0;

  const rawScore = industryWeight + geoWeight + velocityWeight;

  // Worst case (CRYPTO 40 + mismatch 20 + high-risk 15 + velocity 35 = 110)
  // exceeds 100, so the clamp is enforced here in code — never assume the
  // weight table happens to top out at 100.
  const clamped = Math.min(100, Math.max(0, rawScore));

  return Math.round(clamped);
}

/**
 * Function 2: getTierForScore
 * Pure. Boundary reasoning: 30 is the top of LOW, 31 is the bottom of
 * MEDIUM; 65 is the top of MEDIUM, 66 is the bottom of HIGH. These are
 * inclusive on both ends per CLAUDE.md's table — do not shift by one.
 */
export function getTierForScore(score) {
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error(
      `getTierForScore: score must be a finite number in [0, 100], got ${score}.`
    );
  }

  let tier;
  if (score >= 0 && score <= 30) {
    tier = 'LOW';
  } else if (score >= 31 && score <= 65) {
    tier = 'MEDIUM';
  } else {
    // score >= 66 && score <= 100
    tier = 'HIGH';
  }

  return { tier, ...TIER_TABLE[tier] };
}

/**
 * Function 3: resolveEffectiveTier
 * Applies an admin's manual tier override (Risk Engine Configurator) on
 * top of the computed score, while preserving the original computed
 * score/tier for the audit trail and analytics — an override must never
 * cause the real risk signal to be discarded.
 */
export function resolveEffectiveTier(computedScore, merchantOverrideTier) {
  const computed = getTierForScore(computedScore);

  if (merchantOverrideTier === null || merchantOverrideTier === undefined) {
    return {
      effectiveTier: computed.tier,
      liquidPercent: computed.liquidPercent,
      reservePercent: computed.reservePercent,
      holdDurationMs: computed.holdDurationMs,
      computedScore,
      computedTier: computed.tier,
      wasOverridden: false,
    };
  }

  if (!(merchantOverrideTier in TIER_TABLE)) {
    throw new Error(
      `resolveEffectiveTier: unrecognized merchantOverrideTier "${merchantOverrideTier}". Must be one of ${Object.keys(
        TIER_TABLE
      ).join(', ')}, or null/undefined for no override.`
    );
  }

  const override = TIER_TABLE[merchantOverrideTier];

  return {
    effectiveTier: merchantOverrideTier,
    liquidPercent: override.liquidPercent,
    reservePercent: override.reservePercent,
    holdDurationMs: override.holdDurationMs,
    computedScore,
    computedTier: computed.tier,
    wasOverridden: true,
  };
}

/**
 * Function 4: checkVelocity
 * The one async, side-effecting function in this file. `cardFingerprint`
 * must be a salted hash / token reference — NEVER a raw PAN or full card
 * number. This module must never handle real card data, to keep PCI scope
 * minimal. `recentTransactionLookupFn` is injected rather than hardcoded
 * so Firestore access stays in the data layer and this stays testable
 * with a mock.
 */
export async function checkVelocity(cardFingerprint, recentTransactionLookupFn) {
  if (!cardFingerprint || typeof cardFingerprint !== 'string') {
    throw new Error('checkVelocity: cardFingerprint must be a non-empty string (salted hash/token).');
  }
  if (typeof recentTransactionLookupFn !== 'function') {
    throw new Error('checkVelocity: recentTransactionLookupFn must be an injected async function.');
  }

  const windowEndMs = Date.now();
  const windowStartMs = windowEndMs - VELOCITY_WINDOW_MS;

  const count = await recentTransactionLookupFn(cardFingerprint, windowStartMs, windowEndMs);

  // ">3 times in 60s" means the 4th occurrence trips the flag — strictly
  // greater than 3, not >= 3.
  return count > 3;
}
