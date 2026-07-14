import { logAdminAction } from './auditLogService.js';

// CRITICAL SCOPE LIMITATION — read this before treating this endpoint as
// "live": riskEngine.js (Step 6) has industry/geo/velocity weights and
// tier boundaries HARDCODED as module constants (INDUSTRY_WEIGHTS,
// GEO_MISMATCH_WEIGHT, HIGH_RISK_REGION_WEIGHT, VELOCITY_WEIGHT,
// TIER_TABLE) — it does not read from /system_configuration at all. This
// service persists new weight values to Firestore, but they have ZERO
// EFFECT on actual transaction scoring until riskEngine.js is refactored,
// in a dedicated future session with full regression testing, to read
// from /system_configuration instead of its hardcoded constants. That
// refactor is NOT attempted here — it's a structural change to
// already-tested Phase 2 code and riskEngine.js is on this session's
// do-not-modify list. Never present this endpoint to a real admin as
// having live effect on scoring until that follow-up work is done.

const REQUIRED_INDUSTRIES = ['GROCERY', 'ELECTRONICS', 'GAMING', 'CRYPTO'];
const RISK_CONFIG_DOC_ID = 'riskWeights';
const MAX_SINGLE_WEIGHT = 100;

function validateWeight(value, fieldName, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_SINGLE_WEIGHT) {
    errors.push({ field: fieldName, message: `${fieldName} must be a number in [0, ${MAX_SINGLE_WEIGHT}], got ${value}.` });
  }
}

/**
 * Body-shape validation returning field-level errors (400-friendly),
 * mirroring the route-layer validation pattern used throughout this
 * codebase. Per the spec's "must balance mathematically" rule: rejects
 * negative values and any single factor exceeding 100 outright. Does NOT
 * additionally reject the worst-case STACKED total (e.g. CRYPTO + mismatch
 * + high-risk + velocity) exceeding 100 — riskEngine.js's own runtime
 * clamp (Math.min(100, Math.max(0, rawScore))) already handles that
 * defensively, and duplicating that clamping decision here would risk
 * drifting out of sync with riskEngine.js's actual implementation
 * (CLAUDE.md invariant #9: scoring changes belong in riskEngine.js AND
 * PAYMENT_FLOW.md together, not reimplemented at the config-write layer).
 *
 * tierBoundaries shape ({ lowMax, mediumMax }, HIGH implicitly ending at
 * 100) is invented — the spec doesn't define one — flagged for review.
 */
export function validateRiskConfigBody(body) {
  const errors = [];
  const b = body || {};

  const industryWeights = b.industryWeights || {};
  for (const key of REQUIRED_INDUSTRIES) {
    validateWeight(industryWeights[key], `industryWeights.${key}`, errors);
  }
  const extraIndustryKeys = Object.keys(industryWeights).filter((k) => !REQUIRED_INDUSTRIES.includes(k));
  if (extraIndustryKeys.length > 0) {
    errors.push({
      field: 'industryWeights',
      message: `Unknown industry key(s) not in ${REQUIRED_INDUSTRIES.join(', ')}: ${extraIndustryKeys.join(', ')}.`,
    });
  }

  const geoWeights = b.geoWeights || {};
  validateWeight(geoWeights.mismatch, 'geoWeights.mismatch', errors);
  validateWeight(geoWeights.highRiskRegion, 'geoWeights.highRiskRegion', errors);

  validateWeight(b.velocityWeight, 'velocityWeight', errors);

  const tierBoundaries = b.tierBoundaries || {};
  const { lowMax, mediumMax } = tierBoundaries;
  if (typeof lowMax !== 'number' || !Number.isFinite(lowMax) || lowMax < 1 || lowMax >= 100) {
    errors.push({ field: 'tierBoundaries.lowMax', message: 'tierBoundaries.lowMax must be a number in [1, 99].' });
  }
  if (typeof mediumMax !== 'number' || !Number.isFinite(mediumMax) || mediumMax <= (lowMax ?? 0) || mediumMax >= 100) {
    errors.push({
      field: 'tierBoundaries.mediumMax',
      message: 'tierBoundaries.mediumMax must be a number greater than lowMax and less than 100 (HIGH always ends at 100).',
    });
  }

  return errors;
}

function validateParams(params) {
  const p = params || {};
  const errors = validateRiskConfigBody(p);
  if (errors.length > 0) {
    throw new Error(`updateRiskConfig: invalid config — ${errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`);
  }
  if (!p.actorId || typeof p.actorId !== 'string') {
    throw new Error('updateRiskConfig: actorId must be a non-empty string.');
  }
  return p;
}

export async function updateRiskConfig(db, params) {
  const { industryWeights, geoWeights, velocityWeight, tierBoundaries, actorId } = validateParams(params);

  const configRef = db.collection('system_configuration').doc(RISK_CONFIG_DOC_ID);

  return db.runTransaction(async (transaction) => {
    const existingSnap = await transaction.get(configRef);
    const before = existingSnap.exists ? existingSnap.data() : null;

    const configDoc = { industryWeights, geoWeights, velocityWeight, tierBoundaries, updatedAt: new Date() };
    transaction.set(configRef, configDoc);

    await logAdminAction(db, {
      actorId,
      actionType: 'ADMIN_RISK_CONFIG_UPDATE',
      targetId: RISK_CONFIG_DOC_ID,
      beforeState: before,
      afterState: configDoc,
      transaction,
    });

    return configDoc;
  });
}
