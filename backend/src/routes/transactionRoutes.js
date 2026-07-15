import { Router } from 'express';
import { db as defaultDb } from '../config/firebaseAdmin.js';
import { requireMerchantAuth } from '../middleware/authMiddleware.js';
import { computeRiskScore, resolveEffectiveTier, checkVelocity } from '../services/riskEngine.js';
import { processTransactionSettlement } from '../services/settlementService.js';
import { processRefund } from '../services/refundService.js';
import { getPlatformFeePercent } from '../services/systemConfigService.js';
import { buildRecentTransactionLookup, recordCardVelocityEvent } from '../services/velocityLogService.js';
import { isHighRiskRegion } from '../config/highRiskRegions.js';
import { listTransactionsForMerchant, VALID_TRANSACTION_STATUSES } from '../services/transactionQueryService.js';

const ISO_COUNTRY_REGEX = /^[A-Za-z]{2}$/;

function validateListQuery(query) {
  const errors = [];
  const q = query || {};

  if (q.status && !VALID_TRANSACTION_STATUSES.includes(q.status)) {
    errors.push({ field: 'status', message: `status, if provided, must be one of ${VALID_TRANSACTION_STATUSES.join(', ')}.` });
  }
  if (q.riskMin !== undefined && (Number.isNaN(q.riskMin) || q.riskMin < 0 || q.riskMin > 100)) {
    errors.push({ field: 'riskMin', message: 'riskMin, if provided, must be a number in [0, 100].' });
  }
  if (q.riskMax !== undefined && (Number.isNaN(q.riskMax) || q.riskMax < 0 || q.riskMax > 100)) {
    errors.push({ field: 'riskMax', message: 'riskMax, if provided, must be a number in [0, 100].' });
  }
  if (q.riskMin !== undefined && q.riskMax !== undefined && q.riskMin > q.riskMax) {
    errors.push({ field: 'riskMin', message: 'riskMin must not exceed riskMax.' });
  }
  if (q.dateFrom && Number.isNaN(new Date(q.dateFrom).getTime())) {
    errors.push({ field: 'dateFrom', message: 'dateFrom, if provided, must be a valid date string.' });
  }
  if (q.dateTo && Number.isNaN(new Date(q.dateTo).getTime())) {
    errors.push({ field: 'dateTo', message: 'dateTo, if provided, must be a valid date string.' });
  }

  return errors;
}

// Fields a client must never be able to set directly — they are always
// server-computed. merchantId is included here too: even though it's
// already ignored via req.merchant.uid, a client sending it is worth a
// warning since it signals a caller assuming the wrong contract.
const IGNORED_CLIENT_FIELDS = ['merchantId', 'riskScoreCalculated', 'effectiveTier', 'riskTier', 'computedScore', 'computedTier', 'wasOverridden'];

function validateCaptureBody(body) {
  const errors = [];
  const b = body || {};

  if (typeof b.amountGross !== 'number' || !Number.isFinite(b.amountGross) || b.amountGross <= 0) {
    errors.push({ field: 'amountGross', message: 'amountGross is required and must be a positive number.' });
  }
  if (!b.cardFingerprint || typeof b.cardFingerprint !== 'string') {
    errors.push({ field: 'cardFingerprint', message: 'cardFingerprint is required and must be a non-empty string (a salted hash/token reference, never a raw PAN).' });
  }
  if (!b.cardIssuerCountry || typeof b.cardIssuerCountry !== 'string' || !ISO_COUNTRY_REGEX.test(b.cardIssuerCountry)) {
    errors.push({ field: 'cardIssuerCountry', message: 'cardIssuerCountry is required and must be a 2-letter ISO country code.' });
  }
  if (!b.ipCountry || typeof b.ipCountry !== 'string' || !ISO_COUNTRY_REGEX.test(b.ipCountry)) {
    errors.push({ field: 'ipCountry', message: 'ipCountry is required and must be a 2-letter ISO country code — never assumed to match cardIssuerCountry.' });
  }
  if (!b.idempotencyKey || typeof b.idempotencyKey !== 'string') {
    errors.push({ field: 'idempotencyKey', message: 'idempotencyKey is required and must be a non-empty string, supplied by the caller.' });
  }

  return errors;
}

// Fields a client must never be able to set directly on a refund request —
// merchantId comes from the auth token, and balance figures are always
// server-derived.
const IGNORED_REFUND_FIELDS = ['merchantId', 'availableLiquid', 'lockedEscrow', 'totalWithdrawn'];

function validateRefundBody(body) {
  const errors = [];
  const b = body || {};

  if (!b.transactionId || typeof b.transactionId !== 'string') {
    errors.push({ field: 'transactionId', message: 'transactionId is required and must be a non-empty string.' });
  }
  if (typeof b.refundAmount !== 'number' || !Number.isFinite(b.refundAmount) || b.refundAmount <= 0) {
    errors.push({ field: 'refundAmount', message: 'refundAmount is required and must be a positive number.' });
  }
  if (b.reason !== undefined && b.reason !== null && typeof b.reason !== 'string') {
    errors.push({ field: 'reason', message: 'reason, if provided, must be a string.' });
  }
  if (!b.idempotencyKey || typeof b.idempotencyKey !== 'string') {
    errors.push({ field: 'idempotencyKey', message: 'idempotencyKey is required and must be a non-empty string.' });
  }

  return errors;
}

export function createTransactionRoutes({ db }) {
  const router = Router();

  // GET /api/transactions
  // Query params per API_DOCUMENTATION.md: dateFrom, dateTo, status,
  // riskMin, riskMax, transactionId — plus limit/offset pagination,
  // matching this codebase's established { items, limit, offset, hasMore }
  // list-endpoint convention (Steps 13-15). Stays thin: parses/validates
  // query params, delegates the actual query (and its Firestore
  // range-filter limitation workaround) to transactionQueryService.js.
  router.get('/', requireMerchantAuth, async (req, res, next) => {
    try {
      const merchantId = req.merchant.uid;
      const { status, transactionId, dateFrom, dateTo } = req.query;
      const riskMin = req.query.riskMin !== undefined ? Number(req.query.riskMin) : undefined;
      const riskMax = req.query.riskMax !== undefined ? Number(req.query.riskMax) : undefined;

      const validationErrors = validateListQuery({ status, riskMin, riskMax, dateFrom, dateTo });
      if (validationErrors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: validationErrors });
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const result = await listTransactionsForMerchant(db, {
        merchantId,
        status,
        transactionId,
        dateFrom,
        dateTo,
        riskMin,
        riskMax,
        limit,
        offset,
      });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/transactions/capture
  // The core ingestion endpoint. Runs the risk scoring + atomic settlement
  // pipeline. Stays thin: validates input, reads a few merchant-scoped
  // documents to assemble parameters, then delegates all scoring/split/
  // Firestore-transaction logic to services/riskEngine.js and
  // services/settlementService.js.
  router.post('/capture', requireMerchantAuth, async (req, res, next) => {
    try {
      // merchantId comes EXCLUSIVELY from the verified auth token — a
      // merchantId in the request body is never read, not even for
      // validation, to avoid any risk of it influencing behavior.
      const merchantId = req.merchant.uid;

      const presentIgnoredFields = IGNORED_CLIENT_FIELDS.filter((field) => field in (req.body || {}));
      if (presentIgnoredFields.length > 0) {
        console.warn(
          `[transactionRoutes] POST /capture from merchant ${merchantId} included ignored field(s): ${presentIgnoredFields.join(', ')}. These are always server-computed and were discarded.`
        );
      }

      const validationErrors = validateCaptureBody(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: validationErrors });
      }

      const { amountGross, cardFingerprint, idempotencyKey } = req.body;
      const cardIssuerCountry = req.body.cardIssuerCountry.toUpperCase();
      const ipCountry = req.body.ipCountry.toUpperCase();

      const merchantSnap = await db.collection('merchants').doc(merchantId).get();
      if (!merchantSnap.exists || merchantSnap.data().accountStatus !== 'ACTIVE') {
        // This route is the sandbox transaction simulation / capture path
        // referenced in CLAUDE.md invariant #4's onboarding gate — enforced
        // here at the route level, not just hidden in the frontend UI.
        return res.status(403).json({
          message: 'Merchant account is not ACTIVE — transaction capture is blocked until onboarding completes.',
        });
      }
      const merchant = merchantSnap.data();

      const balanceSnap = await db.collection('merchant_balances').doc(merchantId).get();
      if (!balanceSnap.exists) {
        return res.status(409).json({
          message: 'Merchant balance profile not initialized — merchant must complete onboarding first.',
        });
      }
      const currency = balanceSnap.data().currency;

      const highRisk = isHighRiskRegion(cardIssuerCountry, ipCountry);

      const recentTransactionLookupFn = buildRecentTransactionLookup(db, merchantId);
      const velocityFlag = await checkVelocity(cardFingerprint, recentTransactionLookupFn);

      await recordCardVelocityEvent(db, {
        merchantId,
        cardFingerprint,
        idempotencyKey,
        occurredAt: new Date(),
      });

      // industryVector comes from the merchant's own profile — never from
      // the request body, since industry is a merchant-level attribute a
      // per-transaction payload must not be able to override.
      const riskScoreCalculated = computeRiskScore({
        industryVector: merchant.industryVector,
        cardIssuerCountry,
        ipCountry,
        isHighRiskRegion: highRisk,
        velocityFlag,
      });

      // RESOLVED (Step 15): /merchants.tierOverride is the dedicated
      // admin-override field — deliberately distinct from currentRiskTier,
      // which stays the last-computed/display baseline set once at
      // onboarding (onboardingService.js) and is never itself treated as
      // an override. null/undefined means no override is in effect; the
      // only writer of tierOverride is
      // PATCH /api/admin/merchants/:merchantId/tier-override.
      const merchantOverrideTier = merchant.tierOverride ?? null;
      const resolvedTier = resolveEffectiveTier(riskScoreCalculated, merchantOverrideTier);

      const platformFeePercent = await getPlatformFeePercent(db);

      const settlement = await processTransactionSettlement(db, {
        merchantId,
        amountGross,
        currency,
        riskScoreCalculated,
        effectiveTier: resolvedTier.effectiveTier,
        reservePercent: resolvedTier.reservePercent,
        holdDurationMs: resolvedTier.holdDurationMs,
        platformFeePercent,
        idempotencyKey,
      });

      const statusCode = settlement.wasIdempotentReplay ? 200 : 201;
      return res.status(statusCode).json({
        transactionId: settlement.transactionId,
        vaultId: settlement.vaultId,
        splitLiquidAmount: settlement.liquidAllocation,
        splitReserveAmount: settlement.reserveAllocation,
        platformFeeDeduction: settlement.feeDeduction,
        riskScoreCalculated,
        effectiveTier: resolvedTier.effectiveTier,
        wasOverridden: resolvedTier.wasOverridden,
        wasIdempotentReplay: settlement.wasIdempotentReplay,
      });
    } catch (err) {
      // settlementService's own "not initialized" check (defense in depth
      // against a TOCTOU race with the pre-check above) maps to the same
      // 409 conflict status, not a generic 500.
      if (/not initialized/.test(err.message)) {
        return res.status(409).json({ message: err.message });
      }
      // Anything else propagates to the app's errorHandler middleware
      // rather than being caught and masked here — this is a financial
      // write path and errors need to stay diagnosable.
      next(err);
    }
  });

  // POST /api/transactions/refund
  // Refunds a previously CAPTURED transaction. Mirrors /capture's style —
  // no URL param, the target transactionId is a body field. Stays thin:
  // validates input, performs the ownership/existence check, then
  // delegates all refund math and Firestore-transaction logic to
  // services/refundService.js.
  router.post('/refund', requireMerchantAuth, async (req, res, next) => {
    try {
      const merchantId = req.merchant.uid;

      const presentIgnoredFields = IGNORED_REFUND_FIELDS.filter((field) => field in (req.body || {}));
      if (presentIgnoredFields.length > 0) {
        console.warn(
          `[transactionRoutes] POST /refund from merchant ${merchantId} included ignored field(s): ${presentIgnoredFields.join(', ')}. These are always server-derived and were discarded.`
        );
      }

      const validationErrors = validateRefundBody(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: validationErrors });
      }

      const { transactionId, refundAmount, reason, idempotencyKey } = req.body;

      // Ownership/existence check happens here, outside the atomic
      // transaction — processRefund re-verifies it again inside the
      // transaction for correctness (defense in depth), but this initial
      // read lets us return a clean 404 without leaking whether a
      // transactionId belonging to another merchant exists.
      const originalTxSnap = await db.collection('transactions').doc(transactionId).get();
      if (!originalTxSnap.exists || originalTxSnap.data().merchantId !== merchantId) {
        return res.status(404).json({ message: 'Transaction not found.' });
      }

      const refund = await processRefund(db, {
        merchantId,
        transactionId,
        refundAmount,
        reason,
        idempotencyKey,
      });

      const statusCode = refund.wasIdempotentReplay ? 200 : 201;
      return res.status(statusCode).json({
        refundTransactionId: refund.refundTransactionId,
        originalTransactionId: refund.originalTransactionId,
        refundAmount: refund.refundAmount,
        newAvailableLiquid: refund.newAvailableLiquid,
        wasIdempotentReplay: refund.wasIdempotentReplay,
      });
    } catch (err) {
      if (/original transaction .* not found|does not belong to merchant/.test(err.message)) {
        // Defense-in-depth re-check inside processRefund caught a TOCTOU
        // race the route's pre-check missed — still a clean 404, no leak.
        return res.status(404).json({ message: 'Transaction not found.' });
      }
      if (/is not eligible for refund/.test(err.message)) {
        return res.status(409).json({ message: err.message });
      }
      if (/exceeds availableLiquid|must exactly equal/.test(err.message)) {
        return res.status(422).json({ message: err.message });
      }
      // Anything else (e.g. a genuine data-integrity issue like a missing
      // balance profile) propagates to the app's errorHandler middleware
      // rather than being caught and masked here.
      next(err);
    }
  });

  return router;
}

export default createTransactionRoutes({ db: defaultDb });
