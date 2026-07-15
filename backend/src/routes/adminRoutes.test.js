import express from 'express';
import request from 'supertest';
import { createAdminRoutes } from './adminRoutes.js';
import { createTransactionRoutes } from './transactionRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { processRefund } from '../services/refundService.js';
import { FakeFirestore } from '../services/testUtils/fakeFirestore.js';

jest.mock('../config/firebaseAdmin.js', () => ({ db: {}, auth: {} }));

jest.mock('../config/env.js', () => ({
  env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret', JWT_EXPIRES_IN: '12h', ROOT_ADMIN_ACCESS_ID: 'x', ROOT_ADMIN_ACCESS_TOKEN: 'y' },
}));

// Fakes both guards for this suite: an admin bearer token is any non-empty
// string (matches every other admin route test in this codebase); a
// merchant bearer token is the uid itself, needed for the cross-session
// capture-route integration test below.
jest.mock('../middleware/authMiddleware.js', () => ({
  requireAdminAuth: (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ message: 'Missing admin bearer token.' });
    }
    req.admin = { role: 'ADMIN' };
    next();
  },
  requireMerchantAuth: (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const uid = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!uid) {
      return res.status(401).json({ message: 'Missing merchant bearer token.' });
    }
    req.merchant = { uid, email: `${uid}@test.com` };
    next();
  },
  requireMerchantOrAdminAuth: (req, res, next) => next(),
}));

function buildAdminApp(db) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', createAdminRoutes({ db }));
  app.use(errorHandler);
  return app;
}

// For the cross-session capture-route gate integration test only.
function buildCombinedApp(db) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', createAdminRoutes({ db }));
  app.use('/api/transactions', createTransactionRoutes({ db }));
  app.use(errorHandler);
  return app;
}

async function seedMerchant(db, overrides = {}) {
  const merchant = {
    merchantId: 'm1',
    businessName: 'Acme Co',
    entityType: 'LLC',
    industryVector: 'GAMING',
    targetVolume: '10k-50k',
    currentRiskTier: 'LOW',
    accumulatedRiskPoints: 25,
    accountStatus: 'ACTIVE',
    ...overrides,
  };
  await db.collection('merchants').doc(merchant.merchantId).set(merchant);
  return merchant;
}

async function seedBalance(db, merchantId, { availableLiquid = 0, lockedEscrow = 0, totalWithdrawn = 0, currency = 'USD' } = {}) {
  await db.collection('merchant_balances').doc(merchantId).set({
    merchantId,
    availableLiquid,
    lockedEscrow,
    totalWithdrawn,
    currency,
    lastUpdated: new Date(),
  });
}

async function seedCapturedTransaction(db, { transactionId, merchantId, amountGross, status = 'CAPTURED' }) {
  await db.collection('transactions').doc(transactionId).set({
    transactionId,
    merchantId,
    amountGross,
    riskScoreCalculated: 10,
    splitLiquidAmount: amountGross * 0.7,
    splitReserveAmount: amountGross * 0.3,
    platformFeeDeduction: 0,
    status,
    receiptHash: 'tx_hash_seed',
    timestamp: new Date(),
  });
}

function captureBody(overrides = {}) {
  return {
    amountGross: 500,
    cardFingerprint: 'fp_abc',
    cardIssuerCountry: 'US',
    ipCountry: 'US',
    idempotencyKey: 'evt_1',
    ...overrides,
  };
}

// ============================================================
// 1. Merchant Manager
// ============================================================
describe('GET /api/admin/merchants', () => {
  test('lists merchants filtered by accountStatus, paginated', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { merchantId: 'm1', businessName: 'Alpha', accountStatus: 'ACTIVE' });
    await seedMerchant(db, { merchantId: 'm2', businessName: 'Beta', accountStatus: 'SUSPENDED' });
    const app = buildAdminApp(db);

    const res = await request(app).get('/api/admin/merchants?accountStatus=ACTIVE').set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].merchantId).toBe('m1');
  });
});

describe('PATCH /api/admin/merchants/:merchantId/status', () => {
  test('suspends a merchant, requires a reason (400 without it), and logs the action', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);
    const app = buildAdminApp(db);

    const missingReason = await request(app)
      .patch('/api/admin/merchants/m1/status')
      .set('Authorization', 'Bearer admin-token')
      .send({ accountStatus: 'SUSPENDED' });
    expect(missingReason.status).toBe(400);

    const res = await request(app)
      .patch('/api/admin/merchants/m1/status')
      .set('Authorization', 'Bearer admin-token')
      .send({ accountStatus: 'SUSPENDED', reason: 'Suspected fraud' });

    expect(res.status).toBe(200);
    expect(res.body.accountStatus).toBe('SUSPENDED');

    const logsSnap = await db.collection('system_audit_logs').get();
    expect(logsSnap.docs.some((d) => d.data().actionType === 'ADMIN_MERCHANT_STATUS_CHANGE')).toBe(true);
  });

  test('reactivates a suspended merchant', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { accountStatus: 'SUSPENDED' });
    const app = buildAdminApp(db);

    const res = await request(app)
      .patch('/api/admin/merchants/m1/status')
      .set('Authorization', 'Bearer admin-token')
      .send({ accountStatus: 'ACTIVE', reason: 'Cleared review' });

    expect(res.status).toBe(200);
    expect(res.body.accountStatus).toBe('ACTIVE');
  });

  test('rejects a body containing currentRiskTier or any other field', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);
    const app = buildAdminApp(db);

    const res = await request(app)
      .patch('/api/admin/merchants/m1/status')
      .set('Authorization', 'Bearer admin-token')
      .send({ accountStatus: 'SUSPENDED', reason: 'x', currentRiskTier: 'HIGH' });

    expect(res.status).toBe(400);
    const merchantSnap = await db.collection('merchants').doc('m1').get();
    expect(merchantSnap.data().accountStatus).toBe('ACTIVE');
  });

  // Cross-session integration check: a suspension written by THIS
  // session's admin route is enforced by Step 8's capture-route gate,
  // with no new blocking logic anywhere.
  test('INTEGRATION: a merchant suspended via this route is rejected by the existing capture-route gate', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);
    await seedBalance(db, 'm1');
    const app = buildCombinedApp(db);

    const beforeSuspend = await request(app)
      .post('/api/transactions/capture')
      .set('Authorization', 'Bearer m1')
      .send(captureBody({ idempotencyKey: 'evt_before' }));
    expect(beforeSuspend.status).toBe(201);

    const suspend = await request(app)
      .patch('/api/admin/merchants/m1/status')
      .set('Authorization', 'Bearer admin-token')
      .send({ accountStatus: 'SUSPENDED', reason: 'Suspected fraud' });
    expect(suspend.status).toBe(200);

    const afterSuspend = await request(app)
      .post('/api/transactions/capture')
      .set('Authorization', 'Bearer m1')
      .send(captureBody({ idempotencyKey: 'evt_after' }));

    expect(afterSuspend.status).toBe(403);
  });
});

// ============================================================
// 2. Merchant Configuration (tier override)
// ============================================================
describe('PATCH /api/admin/merchants/:merchantId/tier-override', () => {
  test('sets and clears a tier override, logging a distinct actionType from status changes', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { currentRiskTier: 'LOW' });
    const app = buildAdminApp(db);

    const setRes = await request(app)
      .patch('/api/admin/merchants/m1/tier-override')
      .set('Authorization', 'Bearer admin-token')
      .send({ tierOverride: 'HIGH' });
    expect(setRes.status).toBe(200);
    expect(setRes.body.tierOverride).toBe('HIGH');
    expect(setRes.body.currentRiskTier).toBe('LOW'); // baseline untouched

    const clearRes = await request(app)
      .patch('/api/admin/merchants/m1/tier-override')
      .set('Authorization', 'Bearer admin-token')
      .send({ tierOverride: null });
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.tierOverride).toBeNull();

    const logsSnap = await db.collection('system_audit_logs').get();
    const actionTypes = logsSnap.docs.map((d) => d.data().actionType);
    expect(actionTypes).toEqual(['ADMIN_TIER_OVERRIDE_CHANGE', 'ADMIN_TIER_OVERRIDE_CHANGE']);
    expect(actionTypes).not.toContain('ADMIN_MERCHANT_STATUS_CHANGE');
  });

  test('rejects a body containing accountStatus or any other field', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);
    const app = buildAdminApp(db);

    const res = await request(app)
      .patch('/api/admin/merchants/m1/tier-override')
      .set('Authorization', 'Bearer admin-token')
      .send({ tierOverride: 'HIGH', accountStatus: 'SUSPENDED' });

    expect(res.status).toBe(400);
  });

  test('INTEGRATION: an active tierOverride forces the capture route\'s effective tier regardless of the computed score', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { merchantId: 'm1', industryVector: 'GROCERY' }); // GROCERY computes to LOW (score 0)
    await seedBalance(db, 'm1');
    const app = buildCombinedApp(db);

    await request(app)
      .patch('/api/admin/merchants/m1/tier-override')
      .set('Authorization', 'Bearer admin-token')
      .send({ tierOverride: 'HIGH' });

    const res = await request(app)
      .post('/api/transactions/capture')
      .set('Authorization', 'Bearer m1')
      .send(captureBody());

    expect(res.status).toBe(201);
    expect(res.body.riskScoreCalculated).toBe(0); // computed score is still LOW-range
    expect(res.body.effectiveTier).toBe('HIGH'); // but the override forces HIGH
    expect(res.body.wasOverridden).toBe(true);
  });
});

// ============================================================
// 3. Risk Engine Configurator
// ============================================================
describe('PUT /api/admin/risk-config', () => {
  const validBody = {
    industryWeights: { GROCERY: 0, ELECTRONICS: 15, GAMING: 25, CRYPTO: 40 },
    geoWeights: { mismatch: 20, highRiskRegion: 15 },
    velocityWeight: 35,
    tierBoundaries: { lowMax: 30, mediumMax: 65 },
  };

  test('persists the config and explicitly flags it as not yet live in scoring', async () => {
    const db = new FakeFirestore();
    const app = buildAdminApp(db);

    const res = await request(app).put('/api/admin/risk-config').set('Authorization', 'Bearer admin-token').send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.liveInScoring).toBe(false);
    expect(res.body.warning).toMatch(/NO EFFECT/);

    const snap = await db.collection('system_configuration').doc('riskWeights').get();
    expect(snap.data().industryWeights.CRYPTO).toBe(40);

    const logsSnap = await db.collection('system_audit_logs').get();
    expect(logsSnap.docs.some((d) => d.data().actionType === 'ADMIN_RISK_CONFIG_UPDATE')).toBe(true);
  });

  test('rejects negative or single-factor-over-100 weights with 400', async () => {
    const db = new FakeFirestore();
    const app = buildAdminApp(db);

    const res = await request(app)
      .put('/api/admin/risk-config')
      .set('Authorization', 'Bearer admin-token')
      .send({ ...validBody, industryWeights: { ...validBody.industryWeights, CRYPTO: 500 } });

    expect(res.status).toBe(400);
  });
});

// ============================================================
// 4. Refund Queue
// ============================================================
describe('GET /api/admin/refunds/queue', () => {
  test('returns the placeholder-flagged queue', async () => {
    const db = new FakeFirestore();
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 100 });
    const app = buildAdminApp(db);

    const res = await request(app).get('/api/admin/refunds/queue').set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.isPlaceholder).toBe(true);
  });
});

describe('POST /api/admin/refunds/:transactionId/approve', () => {
  test('produces an identical financial result to calling refundService.processRefund directly, plus an audit log', async () => {
    const directDb = new FakeFirestore();
    await seedBalance(directDb, 'm1', { availableLiquid: 500 });
    await seedCapturedTransaction(directDb, { transactionId: 'tx1', merchantId: 'm1', amountGross: 500 });
    const directResult = await processRefund(directDb, {
      merchantId: 'm1',
      transactionId: 'tx1',
      refundAmount: 500,
      reason: 'customer request',
      idempotencyKey: 'rf_1',
    });

    const routeDb = new FakeFirestore();
    await seedBalance(routeDb, 'm1', { availableLiquid: 500 });
    await seedCapturedTransaction(routeDb, { transactionId: 'tx1', merchantId: 'm1', amountGross: 500 });
    const app = buildAdminApp(routeDb);
    const res = await request(app)
      .post('/api/admin/refunds/tx1/approve')
      .set('Authorization', 'Bearer admin-token')
      .send({ refundAmount: 500, reason: 'customer request', idempotencyKey: 'rf_1' });

    expect(res.status).toBe(201);
    // Same inputs, same FakeFirestore semantics -> identical financial
    // outcome (no logic drift between calling processRefund directly and
    // calling it through this admin route).
    expect(res.body.refundAmount).toBe(directResult.refundAmount);
    expect(res.body.newAvailableLiquid).toBe(directResult.newAvailableLiquid);
    expect(res.body.originalTransactionId).toBe(directResult.originalTransactionId);

    const logsSnap = await routeDb.collection('system_audit_logs').get();
    expect(logsSnap.docs.some((d) => d.data().actionType === 'ADMIN_APPROVED_REFUND')).toBe(true);
  });

  test('a nonexistent transactionId returns 404', async () => {
    const db = new FakeFirestore();
    const app = buildAdminApp(db);

    const res = await request(app)
      .post('/api/admin/refunds/does-not-exist/approve')
      .set('Authorization', 'Bearer admin-token')
      .send({ refundAmount: 100, reason: 'x', idempotencyKey: 'rf_2' });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/admin/refunds/:transactionId/deny', () => {
  test('logs the denial, does not change the transaction, and notifies the merchant', async () => {
    const db = new FakeFirestore();
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 100 });
    const app = buildAdminApp(db);

    const res = await request(app)
      .post('/api/admin/refunds/tx1/deny')
      .set('Authorization', 'Bearer admin-token')
      .send({ reason: 'Does not meet policy' });

    expect(res.status).toBe(200);

    const txSnap = await db.collection('transactions').doc('tx1').get();
    expect(txSnap.data().status).toBe('CAPTURED');

    const logsSnap = await db.collection('system_audit_logs').get();
    expect(logsSnap.docs.some((d) => d.data().actionType === 'ADMIN_DENIED_REFUND')).toBe(true);
  });

  test('requires a reason', async () => {
    const db = new FakeFirestore();
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 100 });
    const app = buildAdminApp(db);

    const res = await request(app).post('/api/admin/refunds/tx1/deny').set('Authorization', 'Bearer admin-token').send({});
    expect(res.status).toBe(400);
  });
});

// ============================================================
// 5. Settlement Engine
// ============================================================
describe('POST /api/admin/settlements/execute-batch', () => {
  test('pays out availableLiquid, increments totalWithdrawn, and logs each payout', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 800, totalWithdrawn: 0 });
    const app = buildAdminApp(db);

    const res = await request(app)
      .post('/api/admin/settlements/execute-batch')
      .set('Authorization', 'Bearer admin-token')
      .send({ merchantIds: ['m1'] });

    expect(res.status).toBe(200);
    expect(res.body.results[0].newAvailableLiquid).toBe(0);
    expect(res.body.results[0].newTotalWithdrawn).toBe(800);

    const logsSnap = await db.collection('system_audit_logs').get();
    expect(logsSnap.docs.some((d) => d.data().actionType === 'ADMIN_SETTLEMENT_PAYOUT')).toBe(true);
  });

  test('rejects an attempt to pay out more than availableLiquid (per-merchant, does not abort the batch)', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 50 });
    const app = buildAdminApp(db);

    const res = await request(app)
      .post('/api/admin/settlements/execute-batch')
      .set('Authorization', 'Bearer admin-token')
      .send({ merchantIds: ['m1'], amounts: { m1: 5000 } });

    expect(res.status).toBe(200);
    expect(res.body.results[0].skipped).toBe(true);
    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(50);
  });
});

// ============================================================
// 8. Audit Logs
// ============================================================
describe('GET /api/admin/audit-logs', () => {
  test('is read-only and paginates/filters by actionType', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);
    const app = buildAdminApp(db);

    await request(app)
      .patch('/api/admin/merchants/m1/status')
      .set('Authorization', 'Bearer admin-token')
      .send({ accountStatus: 'SUSPENDED', reason: 'x' });
    await request(app)
      .patch('/api/admin/merchants/m1/tier-override')
      .set('Authorization', 'Bearer admin-token')
      .send({ tierOverride: 'HIGH' });

    const res = await request(app)
      .get('/api/admin/audit-logs?actionType=ADMIN_TIER_OVERRIDE_CHANGE')
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].actionType).toBe('ADMIN_TIER_OVERRIDE_CHANGE');

    // The read itself created no new log entries.
    const allLogs = await db.collection('system_audit_logs').get();
    expect(allLogs.docs).toHaveLength(2);
  });
});

// ============================================================
// 9. Analytics
// ============================================================
describe('GET /api/admin/analytics', () => {
  test('returns cross-tenant aggregates', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { merchantId: 'm1', industryVector: 'GAMING' });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 100 });
    const app = buildAdminApp(db);

    const res = await request(app).get('/api/admin/analytics').set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.totalTransactions).toBe(1);
    expect(res.body.totalMerchants).toBe(1);
    expect(res.body.merchantsByIndustry.GAMING).toBe(1);
  });
});

// ============================================================
// 10. Platform Settings
// ============================================================
describe('PUT /api/admin/settings', () => {
  test('accepts a fee at or below 10% and logs the change', async () => {
    const db = new FakeFirestore();
    const app = buildAdminApp(db);

    const res = await request(app)
      .put('/api/admin/settings')
      .set('Authorization', 'Bearer admin-token')
      .send({ platformFeePercent: 10, defaultVaultMaturityDays: 5, maintenanceMode: false });

    expect(res.status).toBe(200);
    expect(res.body.platformFeePercent).toBe(10);

    const logsSnap = await db.collection('system_audit_logs').get();
    expect(logsSnap.docs.some((d) => d.data().actionType === 'ADMIN_PLATFORM_SETTINGS_UPDATE')).toBe(true);
  });

  test('rejects a fee above 10%', async () => {
    const db = new FakeFirestore();
    const app = buildAdminApp(db);

    const res = await request(app)
      .put('/api/admin/settings')
      .set('Authorization', 'Bearer admin-token')
      .send({ platformFeePercent: 12, defaultVaultMaturityDays: 5, maintenanceMode: false });

    expect(res.status).toBe(400);
  });
});

// ============================================================
// 6. Chargeback Simulator (Step 11's route — response formatting only)
// ============================================================
describe('POST /api/admin/chargebacks — extended response', () => {
  test('includes a friendlier summary field alongside the existing fields', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 200, lockedEscrow: 500 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 300 });
    const app = buildAdminApp(db);

    const res = await request(app)
      .post('/api/admin/chargebacks')
      .set('Authorization', 'Bearer admin-token')
      .send({ transactionId: 'tx1', reason: 'unauthorized', idempotencyKey: 'cb_1' });

    expect(res.status).toBe(201);
    expect(res.body.summary).toMatch(/Clawed back \$300\.00/);
  });
});
