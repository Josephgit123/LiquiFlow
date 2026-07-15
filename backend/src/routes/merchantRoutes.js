import { Router } from 'express';
import { db as defaultDb } from '../config/firebaseAdmin.js';
import { requireMerchantAuth } from '../middleware/authMiddleware.js';
import {
  processOnboarding,
  VALID_ENTITY_TYPES,
  VALID_INDUSTRY_VECTORS,
  VALID_CURRENCIES,
} from '../services/onboardingService.js';

// ASSUMPTION, flagged for review: merchantId === the Firebase uid,
// throughout this file. DATABASE_SCHEMA.md doesn't explicitly say whether
// merchantId is the uid or a separately generated ID, but the ERD shows a
// strict 1:1 relationship between /users and /merchants, and this
// assumption avoids needing a separate merchantId<->uid lookup collection.

const IGNORED_ONBOARDING_FIELDS = [
  'merchantId',
  'accountStatus',
  'currentRiskTier',
  'accumulatedRiskPoints',
  'availableLiquid',
  'lockedEscrow',
  'totalWithdrawn',
];

function validateOnboardingBody(body) {
  const errors = [];
  const b = body || {};

  if (!b.businessName || typeof b.businessName !== 'string') {
    errors.push({ field: 'businessName', message: 'businessName is required and must be a non-empty string.' });
  }
  if (!b.entityType || !VALID_ENTITY_TYPES.includes(b.entityType)) {
    errors.push({
      field: 'entityType',
      message: `entityType is required and must be one of ${VALID_ENTITY_TYPES.join(', ')}.`,
    });
  }
  if (!b.industryVector || !VALID_INDUSTRY_VECTORS.includes(b.industryVector)) {
    errors.push({
      field: 'industryVector',
      message: `industryVector is required and must be one of ${VALID_INDUSTRY_VECTORS.join(', ')}.`,
    });
  }
  if (!b.targetVolume || typeof b.targetVolume !== 'string') {
    errors.push({ field: 'targetVolume', message: 'targetVolume is required and must be a non-empty string.' });
  }
  if (!b.currency || !VALID_CURRENCIES.includes(b.currency)) {
    errors.push({
      field: 'currency',
      message: `currency is required and must be one of ${VALID_CURRENCIES.join(', ')}.`,
    });
  }

  return errors;
}

// INVENTED SHAPE, flagged for review/expansion: neither DATABASE_SCHEMA.md
// nor API_DOCUMENTATION.md defines what "linked funding/gateway metadata"
// actually contains. This minimal three-field shape is a reasonable
// placeholder guess, not a final contract.
const FUNDING_ALLOWLIST = ['payoutBankLast4', 'payoutBankCountry', 'connectedGatewayProvider'];

function validateFundingBody(body) {
  const errors = [];
  const b = body || {};
  const bodyKeys = Object.keys(b);

  if (bodyKeys.length === 0) {
    errors.push({ field: 'body', message: 'At least one funding field must be provided.' });
  }

  // Unknown fields are rejected outright, not silently dropped — silently
  // ignoring could mask a client bug that thinks it's updating a field it
  // isn't.
  const disallowedKeys = bodyKeys.filter((key) => !FUNDING_ALLOWLIST.includes(key));
  if (disallowedKeys.length > 0) {
    errors.push({
      field: disallowedKeys.join(', '),
      message: `Field(s) outside the allowed funding metadata set (${FUNDING_ALLOWLIST.join(
        ', '
      )}) were rejected: ${disallowedKeys.join(', ')}.`,
    });
  }

  for (const key of FUNDING_ALLOWLIST) {
    if (key in b && (typeof b[key] !== 'string' || !b[key])) {
      errors.push({ field: key, message: `${key}, if provided, must be a non-empty string.` });
    }
  }

  return errors;
}

export function createMerchantRoutes({ db }) {
  const router = Router();

  // GET /api/merchants/me
  // Backs the Core Command Dashboard and Risk Profile Monitor views.
  router.get('/me', requireMerchantAuth, async (req, res, next) => {
    try {
      const merchantId = req.merchant.uid;

      const merchantSnap = await db.collection('merchants').doc(merchantId).get();
      if (!merchantSnap.exists) {
        // Registered (Step 12) but hasn't completed the onboarding wizard —
        // an expected state the frontend routes on, same pattern as Step
        // 12's needsRegistration flag, not a generic error.
        return res.status(200).json({ needsOnboarding: true });
      }

      const balanceSnap = await db.collection('merchant_balances').doc(merchantId).get();
      if (!balanceSnap.exists) {
        // processOnboarding always writes both documents atomically in one
        // runTransaction, so this indicates a genuine data-integrity
        // problem, not an expected state — surfaced as a 500 via the error
        // handler rather than a special-cased response.
        throw new Error(
          `GET /merchants/me: merchant "${merchantId}" has a /merchants doc with no paired /merchant_balances doc.`
        );
      }

      return res.status(200).json({
        ...merchantSnap.data(),
        ...balanceSnap.data(),
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/merchants/onboard
  // Onboarding-wizard completion endpoint. Neither API_DOCUMENTATION.md nor
  // navConfig.js implies a specific API path for this (navConfig.js only
  // has the frontend page at /merchant/onboarding) — this session
  // introduces POST /api/merchants/onboard, matching this codebase's
  // established `/api/<resource>` convention.
  router.post('/onboard', requireMerchantAuth, async (req, res, next) => {
    try {
      const merchantId = req.merchant.uid;

      const presentIgnoredFields = IGNORED_ONBOARDING_FIELDS.filter((field) => field in (req.body || {}));
      if (presentIgnoredFields.length > 0) {
        console.warn(
          `[merchantRoutes] POST /onboard from uid ${merchantId} included ignored field(s): ${presentIgnoredFields.join(
            ', '
          )}. These are always server-computed and were discarded.`
        );
      }

      const validationErrors = validateOnboardingBody(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: validationErrors });
      }

      const { businessName, entityType, industryVector, targetVolume, currency } = req.body;

      const result = await processOnboarding(db, {
        merchantId,
        businessName,
        entityType,
        industryVector,
        targetVolume,
        currency,
      });

      return res.status(201).json({ merchant: result.merchant, balance: result.balance });
    } catch (err) {
      if (/already completed onboarding/.test(err.message)) {
        return res.status(409).json({ message: err.message });
      }
      next(err);
    }
  });

  // PATCH /api/merchants/me/funding
  router.patch('/me/funding', requireMerchantAuth, async (req, res, next) => {
    try {
      const merchantId = req.merchant.uid;

      const merchantSnap = await db.collection('merchants').doc(merchantId).get();
      if (!merchantSnap.exists) {
        return res.status(404).json({ message: 'Merchant profile not found — complete onboarding first.' });
      }
      if (merchantSnap.data().accountStatus !== 'ACTIVE') {
        return res.status(409).json({
          message: `Merchant accountStatus is "${
            merchantSnap.data().accountStatus
          }", not ACTIVE — cannot configure funding before onboarding completes.`,
        });
      }

      const validationErrors = validateFundingBody(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: validationErrors });
      }

      // This route can ONLY EVER write the narrow funding-metadata
      // allowlist above — never accountStatus, currentRiskTier, or
      // accumulatedRiskPoints (onboarding/admin-only fields), and never
      // anything in /merchant_balances (exclusively mutated by the Phase 2
      // financial services under a runTransaction). The update object is
      // built explicitly field-by-field from the allowlist rather than
      // passing req.body through, so a validation bug can never
      // accidentally widen what this route is able to write.
      const updateData = {};
      for (const key of FUNDING_ALLOWLIST) {
        if (key in req.body) {
          updateData[key] = req.body[key];
        }
      }

      await db.collection('merchants').doc(merchantId).update(updateData);

      return res.status(200).json({ merchantId, ...updateData });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createMerchantRoutes({ db: defaultDb });
