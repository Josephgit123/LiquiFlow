import { resolveEffectiveTier } from './riskEngine.js';

// Fields the Merchant Profile page can edit directly on /merchants via
// PATCH. Deliberately excludes anything onboarding/admin/engine-owned
// (businessName, entityType, industryVector, targetVolume, currentRiskTier,
// accumulatedRiskPoints, accountStatus, tierOverride) and anything on
// /merchant_balances — matches the existing PATCH /me/funding convention
// in merchantRoutes.js of an explicit allowlist rather than passing the
// body through.
export const PROFILE_FIELD_ALLOWLIST = [
  'ownerName',
  'businessRegistrationNumber',
  'gstNumber',
  'mobileNumber',
  'address',
  'country',
  'website',
  'averageOrderValue',
];

// Fields counted toward profile completion. gstNumber/website/
// averageOrderValue are explicitly optional per the user's own field list
// ("GST (optional)") and are excluded here so a merchant can reach 100%
// without them. profilePhotoUrl and the five onboarding-collected fields
// count too, since the spec's Profile page displays all of these together
// as one profile.
const COMPLETION_FIELDS = [
  'businessName',
  'entityType',
  'industryVector',
  'targetVolume',
  'ownerName',
  'businessRegistrationNumber',
  'mobileNumber',
  'address',
  'country',
  'profilePhotoUrl',
];

function validateProfileUpdate(body) {
  const errors = [];
  const b = body || {};
  const bodyKeys = Object.keys(b);

  if (bodyKeys.length === 0) {
    errors.push({ field: 'body', message: 'At least one profile field must be provided.' });
  }

  const disallowedKeys = bodyKeys.filter((key) => !PROFILE_FIELD_ALLOWLIST.includes(key));
  if (disallowedKeys.length > 0) {
    errors.push({
      field: disallowedKeys.join(', '),
      message: `Field(s) outside the editable profile set (${PROFILE_FIELD_ALLOWLIST.join(
        ', '
      )}) were rejected: ${disallowedKeys.join(', ')}.`,
    });
  }

  // gstNumber is the one explicitly optional field (per the spec request:
  // "GST (optional)") — allowed to be an empty string/null. Every other
  // allowlisted field, if present in the body at all, must be a non-empty
  // string (averageOrderValue is the one numeric exception).
  for (const key of PROFILE_FIELD_ALLOWLIST) {
    if (!(key in b)) continue;
    if (key === 'gstNumber') {
      if (b[key] !== null && typeof b[key] !== 'string') {
        errors.push({ field: key, message: 'gstNumber, if provided, must be a string or null.' });
      }
      continue;
    }
    if (key === 'averageOrderValue') {
      if (b[key] !== null && (typeof b[key] !== 'number' || !Number.isFinite(b[key]) || b[key] < 0)) {
        errors.push({ field: key, message: 'averageOrderValue, if provided, must be a non-negative number or null.' });
      }
      continue;
    }
    if (key === 'website') {
      if (b[key] !== null && typeof b[key] !== 'string') {
        errors.push({ field: key, message: 'website, if provided, must be a string or null.' });
      }
      continue;
    }
    if (typeof b[key] !== 'string' || !b[key].trim()) {
      errors.push({ field: key, message: `${key} must be a non-empty string.` });
    }
  }

  return errors;
}

/**
 * Percentage of COMPLETION_FIELDS that are present and non-empty on the
 * merchant doc, rounded to the nearest integer. Computed on every read
 * rather than stored, so it can never drift from the underlying fields —
 * there is deliberately no profileCompletionPercentage field in Firestore.
 */
export function computeProfileCompletion(merchantData) {
  const data = merchantData || {};
  const filled = COMPLETION_FIELDS.filter((field) => {
    const value = data[field];
    return value !== undefined && value !== null && value !== '';
  });
  return Math.round((filled.length / COMPLETION_FIELDS.length) * 100);
}

/**
 * Merges /merchants + /merchant_balances (currency only — see the
 * comment on the profile PATCH route: /merchant_balances stays exclusively
 * mutated by the atomic financial services, never by this profile path)
 * plus the caller's own Firebase-token email, into the full shape the
 * Merchant Profile page needs. effectiveTier/reservePercent/holdDurationMs
 * are computed from riskEngine.resolveEffectiveTier rather than stored, so
 * an admin's tierOverride is always reflected without a second write path
 * to keep in sync.
 */
export function buildProfileView(merchantData, balanceData, email) {
  const tierInfo = resolveEffectiveTier(merchantData.accumulatedRiskPoints, merchantData.tierOverride ?? null);

  return {
    ...merchantData,
    email,
    currency: balanceData?.currency ?? null,
    currentRiskScore: merchantData.accumulatedRiskPoints,
    effectiveRiskTier: tierInfo.effectiveTier,
    reservePercentage: tierInfo.reservePercent,
    rollingSettlementDays: Math.round(tierInfo.holdDurationMs / 86400000),
    tierWasOverridden: tierInfo.wasOverridden,
    profileCompletionPercentage: computeProfileCompletion(merchantData),
  };
}

/**
 * Validates and writes an update to /merchants. Always stamps updatedAt;
 * callers are responsible for stamping createdAt once at onboarding
 * (processOnboarding), never here.
 */
export async function updateMerchantProfile(db, merchantId, body) {
  const errors = validateProfileUpdate(body);
  if (errors.length > 0) {
    const err = new Error('Validation failed.');
    err.validationErrors = errors;
    throw err;
  }

  const updateData = {};
  for (const key of PROFILE_FIELD_ALLOWLIST) {
    if (key in body) {
      updateData[key] = body[key];
    }
  }
  updateData.updatedAt = new Date();

  const merchantRef = db.collection('merchants').doc(merchantId);
  await merchantRef.update(updateData);
  return updateData;
}
