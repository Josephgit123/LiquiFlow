import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { db as defaultDb } from '../config/firebaseAdmin.js';
import { requireAdminAuth } from '../middleware/authMiddleware.js';
import { processChargeback } from '../services/chargebackService.js';
import { processRefund } from '../services/refundService.js';
import { logAdminAction, listAuditLogs } from '../services/auditLogService.js';
import {
  listMerchantsForAdmin,
  updateMerchantAccountStatus,
  updateMerchantTierOverride,
} from '../services/merchantAdminService.js';
import { updateRiskConfig, validateRiskConfigBody } from '../services/riskConfigService.js';
import { listRefundQueue, denyRefund } from '../services/refundQueueService.js';
import { executeSettlementBatch } from '../services/settlementBatchService.js';
import { computeAdminAnalytics } from '../services/adminAnalyticsService.js';
import { updatePlatformSettings, MAX_PLATFORM_FEE_PERCENT } from '../services/platformSettingsService.js';

function parsePagination(query) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

function validateChargebackBody(body) {
  const errors = [];
  const b = body || {};

  if (!b.transactionId || typeof b.transactionId !== 'string') {
    errors.push({ field: 'transactionId', message: 'transactionId is required and must be a non-empty string.' });
  }
  if (
    b.disputeAmount !== undefined &&
    b.disputeAmount !== null &&
    (typeof b.disputeAmount !== 'number' || !Number.isFinite(b.disputeAmount) || b.disputeAmount <= 0)
  ) {
    errors.push({ field: 'disputeAmount', message: 'disputeAmount, if provided, must be a positive number.' });
  }
  if (b.reason !== undefined && b.reason !== null && typeof b.reason !== 'string') {
    errors.push({ field: 'reason', message: 'reason, if provided, must be a string.' });
  }
  if (!b.idempotencyKey || typeof b.idempotencyKey !== 'string') {
    errors.push({ field: 'idempotencyKey', message: 'idempotencyKey is required and must be a non-empty string.' });
  }

  return errors;
}

// ---- 1. Merchant Manager — status control ----
const STATUS_ALLOWLIST = ['accountStatus', 'reason'];
const VALID_ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED'];

function validateStatusBody(body) {
  const errors = [];
  const b = body || {};
  const disallowed = Object.keys(b).filter((k) => !STATUS_ALLOWLIST.includes(k));
  if (disallowed.length > 0) {
    errors.push({
      field: disallowed.join(', '),
      message: `Only ${STATUS_ALLOWLIST.join(', ')} may be set on this route — rejected: ${disallowed.join(', ')}.`,
    });
  }
  if (!b.accountStatus || !VALID_ACCOUNT_STATUSES.includes(b.accountStatus)) {
    errors.push({ field: 'accountStatus', message: `accountStatus is required and must be one of ${VALID_ACCOUNT_STATUSES.join(', ')}.` });
  }
  if (!b.reason || typeof b.reason !== 'string') {
    errors.push({ field: 'reason', message: 'reason is required and must be a non-empty string.' });
  }
  return errors;
}

// ---- 2. Merchant Configuration — tier override ----
// tierOverride is a field DISTINCT from currentRiskTier — see
// merchantAdminService.js's updateMerchantTierOverride doc comment for why
// (currentRiskTier is the onboarding-time computed baseline and is never
// null, so it can't double as the "null means no override" signal
// riskEngine.resolveEffectiveTier needs).
const VALID_TIER_OVERRIDE_VALUES = ['LOW', 'MEDIUM', 'HIGH', null];

function validateTierOverrideBody(body) {
  const errors = [];
  const b = body || {};
  const disallowed = Object.keys(b).filter((k) => k !== 'tierOverride');
  if (disallowed.length > 0) {
    errors.push({
      field: disallowed.join(', '),
      message: `Only tierOverride may be set on this route — rejected: ${disallowed.join(', ')}.`,
    });
  }
  if (!('tierOverride' in b) || !VALID_TIER_OVERRIDE_VALUES.includes(b.tierOverride)) {
    errors.push({ field: 'tierOverride', message: 'tierOverride is required and must be LOW, MEDIUM, HIGH, or null.' });
  }
  return errors;
}

// ---- 4. Refund Queue — approve/deny body validation ----
function validateApproveBody(body) {
  const errors = [];
  const b = body || {};
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

function validateDenyBody(body) {
  const errors = [];
  const b = body || {};
  if (!b.reason || typeof b.reason !== 'string') {
    errors.push({ field: 'reason', message: 'reason is required and must be a non-empty string.' });
  }
  return errors;
}

// ---- 5. Settlement Engine ----
function validateSettlementBody(body) {
  const errors = [];
  const b = body || {};
  if (b.merchantIds !== undefined && !Array.isArray(b.merchantIds)) {
    errors.push({ field: 'merchantIds', message: 'merchantIds, if provided, must be an array of strings.' });
  }
  if (b.amounts !== undefined && (typeof b.amounts !== 'object' || b.amounts === null || Array.isArray(b.amounts))) {
    errors.push({ field: 'amounts', message: 'amounts, if provided, must be a plain object keyed by merchantId.' });
  }
  return errors;
}

// ---- 10. Platform Settings ----
function validateSettingsBody(body) {
  const errors = [];
  const b = body || {};
  if (
    typeof b.platformFeePercent !== 'number' ||
    !Number.isFinite(b.platformFeePercent) ||
    b.platformFeePercent < 0 ||
    b.platformFeePercent > MAX_PLATFORM_FEE_PERCENT
  ) {
    errors.push({
      field: 'platformFeePercent',
      message: `platformFeePercent is required and must be a number in [0, ${MAX_PLATFORM_FEE_PERCENT}].`,
    });
  }
  if (
    typeof b.defaultVaultMaturityDays !== 'number' ||
    !Number.isFinite(b.defaultVaultMaturityDays) ||
    b.defaultVaultMaturityDays <= 0
  ) {
    errors.push({ field: 'defaultVaultMaturityDays', message: 'defaultVaultMaturityDays is required and must be a positive number.' });
  }
  if (typeof b.maintenanceMode !== 'boolean') {
    errors.push({ field: 'maintenanceMode', message: 'maintenanceMode is required and must be a boolean.' });
  }
  return errors;
}

export function createAdminRoutes({ db }) {
  const router = Router();

  // POST /api/admin/login
  // Hardcoded credential check against env vars, entirely separate from
  // Firebase Authentication (CLAUDE.md invariant #7: admin isolation).
  router.post('/login', (req, res) => {
    const { accessId, accessToken } = req.body || {};

    if (accessId !== env.ROOT_ADMIN_ACCESS_ID || accessToken !== env.ROOT_ADMIN_ACCESS_TOKEN) {
      return res.status(401).json({ message: 'Invalid admin access credentials.' });
    }

    const token = jwt.sign({ role: 'ADMIN' }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
    });

    res.status(200).json({ token });
  });

  // GET /api/admin/session
  router.get('/session', requireAdminAuth, (req, res) => {
    res.status(200).json({ valid: true, role: req.admin.role });
  });

  // ---- 6. Chargeback Simulator (Step 11's route, response formatting
  // extended only — chargebackService.js itself is untouched) ----
  // POST /api/admin/chargebacks
  router.post('/chargebacks', requireAdminAuth, async (req, res, next) => {
    try {
      const validationErrors = validateChargebackBody(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: validationErrors });
      }

      const { transactionId, disputeAmount, reason, idempotencyKey } = req.body;

      const originalTxSnap = await db.collection('transactions').doc(transactionId).get();
      if (!originalTxSnap.exists) {
        return res.status(404).json({ message: 'Transaction not found.' });
      }

      const actorId = req.admin.role || 'ADMIN';

      const chargeback = await processChargeback(db, {
        transactionId,
        disputeAmount,
        reason,
        idempotencyKey,
        actorId,
      });

      // Simulator-friendly summary line — response formatting only, no
      // change to chargebackService.js's own logic or return value shape.
      const totalDrawn = chargeback.reserveDraw + chargeback.remainderDraw;
      const summary =
        chargeback.remainderDraw > 0
          ? `Clawed back $${totalDrawn.toFixed(2)} — $${chargeback.reserveDraw.toFixed(2)} from reserve, $${chargeback.remainderDraw.toFixed(2)} from available liquid.`
          : `Clawed back $${chargeback.reserveDraw.toFixed(2)} entirely from reserve.`;

      const statusCode = chargeback.wasIdempotentReplay ? 200 : 201;
      return res.status(statusCode).json({
        chargebackTransactionId: chargeback.chargebackTransactionId,
        originalTransactionId: chargeback.originalTransactionId,
        reserveDraw: chargeback.reserveDraw,
        remainderDraw: chargeback.remainderDraw,
        newAvailableLiquid: chargeback.newAvailableLiquid,
        newLockedEscrow: chargeback.newLockedEscrow,
        wasIdempotentReplay: chargeback.wasIdempotentReplay,
        summary,
      });
    } catch (err) {
      if (/original transaction .* not found/.test(err.message)) {
        return res.status(404).json({ message: 'Transaction not found.' });
      }
      if (/is not eligible for chargeback/.test(err.message)) {
        return res.status(409).json({ message: err.message });
      }
      if (/exceeds the original transaction's amountGross/.test(err.message)) {
        return res.status(400).json({ message: err.message });
      }
      next(err);
    }
  });

  // ---- 1. Merchant Manager ----

  // GET /api/admin/merchants
  router.get('/merchants', requireAdminAuth, async (req, res, next) => {
    try {
      const { accountStatus, industryVector } = req.query;
      const { limit, offset } = parsePagination(req.query);
      const result = await listMerchantsForAdmin(db, { accountStatus, industryVector, limit, offset });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/admin/merchants/:merchantId/status
  router.patch('/merchants/:merchantId/status', requireAdminAuth, async (req, res, next) => {
    try {
      const { merchantId } = req.params;
      const validationErrors = validateStatusBody(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: validationErrors });
      }

      const { accountStatus, reason } = req.body;
      const actorId = req.admin.role || 'ADMIN';

      const merchant = await updateMerchantAccountStatus(db, { merchantId, accountStatus, reason, actorId });
      return res.status(200).json(merchant);
    } catch (err) {
      if (/not found/.test(err.message)) {
        return res.status(404).json({ message: 'Merchant not found.' });
      }
      next(err);
    }
  });

  // ---- 2. Merchant Configuration (per-merchant tier override) ----

  // PATCH /api/admin/merchants/:merchantId/tier-override
  router.patch('/merchants/:merchantId/tier-override', requireAdminAuth, async (req, res, next) => {
    try {
      const { merchantId } = req.params;
      const validationErrors = validateTierOverrideBody(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: validationErrors });
      }

      const { tierOverride } = req.body;
      const actorId = req.admin.role || 'ADMIN';

      const merchant = await updateMerchantTierOverride(db, { merchantId, tierOverride, actorId });
      return res.status(200).json(merchant);
    } catch (err) {
      if (/not found/.test(err.message)) {
        return res.status(404).json({ message: 'Merchant not found.' });
      }
      next(err);
    }
  });

  // ---- 3. Risk Engine Configurator ----
  // CRITICAL: see riskConfigService.js's header comment — this endpoint
  // persists weights to Firestore but has ZERO EFFECT on live scoring
  // until riskEngine.js is refactored in a dedicated future session. The
  // liveInScoring: false / warning fields below surface that directly in
  // the API response, not just in code comments, so no consumer can
  // mistake this for a completed feature.

  // PUT /api/admin/risk-config
  router.put('/risk-config', requireAdminAuth, async (req, res, next) => {
    try {
      const validationErrors = validateRiskConfigBody(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: validationErrors });
      }

      const { industryWeights, geoWeights, velocityWeight, tierBoundaries } = req.body;
      const actorId = req.admin.role || 'ADMIN';

      const config = await updateRiskConfig(db, { industryWeights, geoWeights, velocityWeight, tierBoundaries, actorId });
      return res.status(200).json({
        ...config,
        liveInScoring: false,
        warning:
          'This configuration is persisted but has NO EFFECT on live transaction scoring yet — riskEngine.js still uses hardcoded weights (Step 6). A dedicated future session must refactor riskEngine.js to read from /system_configuration before this becomes live.',
      });
    } catch (err) {
      next(err);
    }
  });

  // ---- 4. Refund Queue ----

  // GET /api/admin/refunds/queue
  router.get('/refunds/queue', requireAdminAuth, async (req, res, next) => {
    try {
      const { limit, offset } = parsePagination(req.query);
      const result = await listRefundQueue(db, { limit, offset });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/admin/refunds/:transactionId/approve
  // Thin: validates, calls refundService.processRefund() directly (no
  // reimplemented liquidity check or balance logic), logs the action.
  router.post('/refunds/:transactionId/approve', requireAdminAuth, async (req, res, next) => {
    try {
      const { transactionId } = req.params;
      const validationErrors = validateApproveBody(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: validationErrors });
      }

      const originalTxSnap = await db.collection('transactions').doc(transactionId).get();
      if (!originalTxSnap.exists) {
        return res.status(404).json({ message: 'Transaction not found.' });
      }
      const merchantId = originalTxSnap.data().merchantId;
      const { refundAmount, reason, idempotencyKey } = req.body;
      const actorId = req.admin.role || 'ADMIN';

      const refund = await processRefund(db, { merchantId, transactionId, refundAmount, reason, idempotencyKey });

      await logAdminAction(db, {
        actorId,
        actionType: 'ADMIN_APPROVED_REFUND',
        targetId: transactionId,
        beforeState: { status: originalTxSnap.data().status },
        afterState: {
          status: 'REFUNDED',
          refundAmount: refund.refundAmount,
          newAvailableLiquid: refund.newAvailableLiquid,
        },
      });

      const statusCode = refund.wasIdempotentReplay ? 200 : 201;
      return res.status(statusCode).json(refund);
    } catch (err) {
      if (/is not eligible for refund/.test(err.message)) {
        return res.status(409).json({ message: err.message });
      }
      if (/exceeds availableLiquid|must exactly equal/.test(err.message)) {
        return res.status(422).json({ message: err.message });
      }
      next(err);
    }
  });

  // POST /api/admin/refunds/:transactionId/deny
  // No balance change, no refundService call — logs the denial and
  // notifies the merchant.
  router.post('/refunds/:transactionId/deny', requireAdminAuth, async (req, res, next) => {
    try {
      const { transactionId } = req.params;
      const validationErrors = validateDenyBody(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: validationErrors });
      }

      const { reason } = req.body;
      const actorId = req.admin.role || 'ADMIN';

      const result = await denyRefund(db, { transactionId, reason, actorId });
      return res.status(200).json(result);
    } catch (err) {
      if (/not found/.test(err.message)) {
        return res.status(404).json({ message: 'Transaction not found.' });
      }
      next(err);
    }
  });

  // ---- 5. Settlement Engine (voluntary payout batch) ----
  // POST /api/admin/settlements/execute-batch
  router.post('/settlements/execute-batch', requireAdminAuth, async (req, res, next) => {
    try {
      const validationErrors = validateSettlementBody(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: validationErrors });
      }

      const { merchantIds, amounts } = req.body || {};
      const actorId = req.admin.role || 'ADMIN';

      const result = await executeSettlementBatch(db, { merchantIds, amounts, actorId });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // ---- 8. Audit Logs ----
  // GET /api/admin/audit-logs — read-only, never writes.
  // /system_audit_logs is append-only (CLAUDE.md invariant #1).
  router.get('/audit-logs', requireAdminAuth, async (req, res, next) => {
    try {
      const { actionType, actorId, dateFrom, dateTo } = req.query;
      const { limit, offset } = parsePagination(req.query);
      const result = await listAuditLogs(db, { actionType, actorId, dateFrom, dateTo, limit, offset });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // ---- 9. Analytics ----
  // GET /api/admin/analytics — live query-time aggregation (see
  // adminAnalyticsService.js header for the scale caveat).
  router.get('/analytics', requireAdminAuth, async (req, res, next) => {
    try {
      const analytics = await computeAdminAnalytics(db);
      return res.status(200).json(analytics);
    } catch (err) {
      next(err);
    }
  });

  // ---- 10. Platform Settings ----
  // PUT /api/admin/settings
  router.put('/settings', requireAdminAuth, async (req, res, next) => {
    try {
      const validationErrors = validateSettingsBody(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: validationErrors });
      }

      const { platformFeePercent, defaultVaultMaturityDays, maintenanceMode } = req.body;
      const actorId = req.admin.role || 'ADMIN';

      const settings = await updatePlatformSettings(db, {
        platformFeePercent,
        defaultVaultMaturityDays,
        maintenanceMode,
        actorId,
      });
      return res.status(200).json(settings);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createAdminRoutes({ db: defaultDb });
