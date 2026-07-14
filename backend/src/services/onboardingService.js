import { computeRiskScore, getTierForScore } from './riskEngine.js';

// GAP: riskEngine.js does not export its industry/entity/currency enum
// lists directly (INDUSTRY_WEIGHTS is a private module constant), so these
// are duplicated here from CLAUDE.md's ground-truth tables and
// DATABASE_SCHEMA.md's /merchants and /merchant_balances field notes. Keep
// in sync with riskEngine.js's INDUSTRY_WEIGHTS if that table ever changes
// — this file must only reuse riskEngine's exported functions, never
// reimplement scoring logic itself.
export const VALID_ENTITY_TYPES = ['LLC', 'C_CORP', 'SOLE_PROP'];
export const VALID_INDUSTRY_VECTORS = ['GROCERY', 'ELECTRONICS', 'GAMING', 'CRYPTO'];
export const VALID_CURRENCIES = ['USD', 'EUR', 'INR'];

function validateParams(params) {
  const p = params || {};

  if (!p.merchantId || typeof p.merchantId !== 'string') {
    throw new Error('processOnboarding: merchantId must be a non-empty string.');
  }
  if (!p.businessName || typeof p.businessName !== 'string') {
    throw new Error('processOnboarding: businessName must be a non-empty string.');
  }
  if (!VALID_ENTITY_TYPES.includes(p.entityType)) {
    throw new Error(
      `processOnboarding: entityType must be one of ${VALID_ENTITY_TYPES.join(', ')}, got "${p.entityType}".`
    );
  }
  if (!VALID_INDUSTRY_VECTORS.includes(p.industryVector)) {
    throw new Error(
      `processOnboarding: industryVector must be one of ${VALID_INDUSTRY_VECTORS.join(', ')}, got "${p.industryVector}".`
    );
  }
  if (!p.targetVolume || typeof p.targetVolume !== 'string') {
    throw new Error('processOnboarding: targetVolume must be a non-empty string.');
  }
  if (!VALID_CURRENCIES.includes(p.currency)) {
    throw new Error(
      `processOnboarding: currency must be one of ${VALID_CURRENCIES.join(', ')}, got "${p.currency}".`
    );
  }

  return p;
}

/**
 * Atomic onboarding-wizard completion: creates the paired /merchants and
 * /merchant_balances documents in a single db.runTransaction. Neither
 * collection is one of CLAUDE.md invariant #1's append-only collections,
 * but wrapping both writes atomically here prevents an orphaned /merchants
 * doc without its required paired /merchant_balances doc — a state
 * settlementService.js already assumes can't happen (it throws if the
 * balance doc is missing).
 *
 * One-shot, not idempotent-by-design like capture/refund/chargeback: there
 * is no idempotencyKey here. A merchant whose accountStatus is already
 * ACTIVE is rejected outright — onboarding materially changes financial
 * state (creates the balance doc) and must never silently re-run. A
 * /merchants doc that exists but is still PENDING (e.g. a prior attempt
 * that failed partway) is allowed to proceed and be overwritten, since
 * nothing financial has happened yet in that state.
 */
export async function processOnboarding(db, params) {
  const { merchantId, businessName, entityType, industryVector, targetVolume, currency } =
    validateParams(params);

  const merchantRef = db.collection('merchants').doc(merchantId);
  const balanceRef = db.collection('merchant_balances').doc(merchantId);

  return db.runTransaction(async (transaction) => {
    const merchantSnap = await transaction.get(merchantRef);

    if (merchantSnap.exists && merchantSnap.data().accountStatus === 'ACTIVE') {
      throw new Error(
        `processOnboarding: merchant "${merchantId}" has already completed onboarding (accountStatus is ACTIVE) — onboarding is one-shot and cannot be repeated.`
      );
    }

    // Deliberate no-mismatch placeholder: no real transaction geography
    // exists yet at onboarding time (no card/IP has ever been seen for
    // this merchant), so cardIssuerCountry/ipCountry are passed as
    // identical placeholder strings purely to hold the geo-mismatch and
    // high-risk-region flags at their safest (zero) value and isolate the
    // industry-only baseline this step needs. This is NOT a real
    // geographic risk assessment — every actual captured transaction
    // computes its own real score from real card/IP data via
    // transactionRoutes.js's /capture handler, independently of this
    // baseline.
    const initialScore = computeRiskScore({
      industryVector,
      cardIssuerCountry: 'MATCH_PLACEHOLDER',
      ipCountry: 'MATCH_PLACEHOLDER',
      isHighRiskRegion: false,
      velocityFlag: false,
    });
    const initialTier = getTierForScore(initialScore);

    const merchantDoc = {
      merchantId,
      businessName,
      entityType,
      industryVector,
      targetVolume,
      // currentRiskTier is the computed baseline tier, set here once and
      // otherwise read-only/display — it is NOT the admin-override field.
      // That's the separate, nullable tierOverride field below (Step 15
      // correction: an admin override can never safely reuse this field,
      // since it's never null post-onboarding — see
      // merchantAdminService.js's updateMerchantTierOverride).
      currentRiskTier: initialTier.tier,
      accumulatedRiskPoints: initialScore,
      accountStatus: 'ACTIVE',
      tierOverride: null,
    };
    transaction.set(merchantRef, merchantDoc);

    // lastUpdated uses a plain Date rather than FieldValue.serverTimestamp().
    // Unlike settlementService.js/refundService.js/chargebackService.js,
    // which mutate an EXISTING balance doc repeatedly and need a canonical
    // server clock for correct ordering across concurrent writers, this
    // path creates the balance doc exactly once, and the caller needs the
    // literal written value back in the response without a second read —
    // a FieldValue sentinel would otherwise leak into the API response
    // instead of resolving to a real timestamp.
    const now = new Date();
    const balanceDoc = {
      merchantId,
      availableLiquid: 0,
      lockedEscrow: 0,
      totalWithdrawn: 0,
      currency,
      lastUpdated: now,
    };
    transaction.set(balanceRef, balanceDoc);

    return { merchant: merchantDoc, balance: balanceDoc };
  });
}
