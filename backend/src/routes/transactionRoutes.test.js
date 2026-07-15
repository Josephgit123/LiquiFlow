import express from 'express';
import request from 'supertest';
import { createTransactionRoutes } from './transactionRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { FakeFirestore } from '../services/testUtils/fakeFirestore.js';

// Avoids real Firebase Admin SDK initialization (which needs real creds)
// for the module-level `import { db } from '../config/firebaseAdmin.js'`
// in transactionRoutes.js — unused in tests since createTransactionRoutes
// is always called here with an injected FakeFirestore instance instead.
jest.mock('../config/firebaseAdmin.js', () => ({ db: {}, auth: {} }));

// errorHandler.js reads env.NODE_ENV directly; env.js itself throws at
// import time unless ROOT_ADMIN_ACCESS_ID/JWT_SECRET/Firebase creds are
// set, which have no place in a unit test — mock it instead of requiring
// dummy real-looking secrets.
jest.mock('../config/env.js', () => ({ env: { NODE_ENV: 'test' } }));

// Fakes requireMerchantAuth so tests can authenticate as any merchant by
// setting `Authorization: Bearer <uid>`, without real Firebase ID tokens.
jest.mock('../middleware/authMiddleware.js', () => ({
  requireMerchantAuth: (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const uid = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!uid) {
      return res.status(401).json({ message: 'Missing merchant bearer token.' });
    }
    req.merchant = { uid, email: `${uid}@test.com` };
    next();
  },
  requireAdminAuth: (req, res, next) => next(),
}));

function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.use('/api/transactions', createTransactionRoutes({ db }));
  app.use(errorHandler);
  return app;
}

async function seedMerchant(
  db,
  {
    merchantId = 'm1',
    accountStatus = 'ACTIVE',
    industryVector = 'GROCERY',
    currency = 'USD',
    availableLiquid = 0,
    lockedEscrow = 0,
  } = {}
) {
  await db.collection('merchants').doc(merchantId).set({ merchantId, accountStatus, industryVector });
  await db.collection('merchant_balances').doc(merchantId).set({
    merchantId,
    availableLiquid,
    lockedEscrow,
    totalWithdrawn: 0,
    currency,
    lastUpdated: new Date(),
  });
}

function validBody(overrides = {}) {
  return {
    amountGross: 1000,
    cardFingerprint: 'fp_abc123',
    cardIssuerCountry: 'US',
    ipCountry: 'US',
    idempotencyKey: 'evt_1',
    ...overrides,
  };
}

describe('POST /api/transactions/capture — happy path', () => {
  test('valid payload from an ACTIVE merchant produces 201 with the correct LOW-tier split', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/transactions/capture')
      .set('Authorization', 'Bearer m1')
      .send(validBody());

    expect(res.status).toBe(201);
    expect(res.body.riskScoreCalculated).toBe(0);
    expect(res.body.effectiveTier).toBe('LOW');
    expect(res.body.wasOverridden).toBe(false);
    expect(res.body.wasIdempotentReplay).toBe(false);
    expect(res.body.splitLiquidAmount).toBe(930);
    expect(res.body.splitReserveAmount).toBe(50);
    expect(res.body.platformFeeDeduction).toBe(20);
    expect(res.body.vaultId).not.toBeNull();
    expect(res.body.transactionId).toBeTruthy();
  });
});

describe('POST /api/transactions/capture — client-supplied risk fields are ignored', () => {
  test('riskScoreCalculated and effectiveTier in the body have zero effect on the result', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);
    const app = buildApp(db);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/transactions/capture')
      .set('Authorization', 'Bearer m1')
      .send({
        ...validBody({ idempotencyKey: 'evt_spoof_risk' }),
        riskScoreCalculated: 999,
        effectiveTier: 'HIGH',
      });

    expect(res.status).toBe(201);
    expect(res.body.riskScoreCalculated).toBe(0); // genuinely computed, not 999
    expect(res.body.effectiveTier).toBe('LOW'); // genuinely resolved, not HIGH
    expect(res.body.splitReserveAmount).toBe(50); // LOW tier's 5%, not HIGH tier's 30%
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe('POST /api/transactions/capture — onboarding gate', () => {
  test('a non-ACTIVE merchant is rejected with 403 before any settlement logic runs', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { accountStatus: 'PENDING' });
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/transactions/capture')
      .set('Authorization', 'Bearer m1')
      .send(validBody());

    expect(res.status).toBe(403);
    expect(db.store.readAll('transactions')).toHaveLength(0);
    expect(db.store.readAll('reserve_vault')).toHaveLength(0);
    expect(db.store.readAll('merchant_balances')[0].data.availableLiquid).toBe(0);
  });
});

describe('POST /api/transactions/capture — input validation', () => {
  test('missing required fields are rejected with 400 and field-level detail', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/transactions/capture')
      .set('Authorization', 'Bearer m1')
      .send({ amountGross: 100 });

    expect(res.status).toBe(400);
    expect(res.body.errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(['cardFingerprint', 'cardIssuerCountry', 'ipCountry', 'idempotencyKey'])
    );
  });

  test('a malformed geo field is rejected rather than assumed to match', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/transactions/capture')
      .set('Authorization', 'Bearer m1')
      .send(validBody({ ipCountry: '' }));

    expect(res.status).toBe(400);
    expect(res.body.errors.some((e) => e.field === 'ipCountry')).toBe(true);
  });

  test('a non-positive amountGross is rejected', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/transactions/capture')
      .set('Authorization', 'Bearer m1')
      .send(validBody({ amountGross: 0 }));

    expect(res.status).toBe(400);
    expect(res.body.errors.some((e) => e.field === 'amountGross')).toBe(true);
  });
});

describe('POST /api/transactions/capture — idempotency', () => {
  test('a repeated idempotencyKey returns 200 with wasIdempotentReplay true and does not double-credit', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);
    const app = buildApp(db);
    const body = validBody({ idempotencyKey: 'evt_dup' });

    const first = await request(app).post('/api/transactions/capture').set('Authorization', 'Bearer m1').send(body);
    const second = await request(app).post('/api/transactions/capture').set('Authorization', 'Bearer m1').send(body);

    expect(first.status).toBe(201);
    expect(first.body.wasIdempotentReplay).toBe(false);
    expect(second.status).toBe(200);
    expect(second.body.wasIdempotentReplay).toBe(true);
    expect(second.body.transactionId).toBe(first.body.transactionId);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(930);
    expect(db.store.readAll('transactions')).toHaveLength(1);
  });
});

describe('POST /api/transactions/capture — merchantId spoofing', () => {
  test('a merchantId in the request body is ignored; the transaction is attributed to the token uid', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { merchantId: 'm1' });
    await seedMerchant(db, { merchantId: 'someone-else' });
    const app = buildApp(db);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/transactions/capture')
      .set('Authorization', 'Bearer m1')
      .send({ ...validBody({ idempotencyKey: 'evt_spoof_merchant' }), merchantId: 'someone-else' });

    warnSpy.mockRestore();

    expect(res.status).toBe(201);

    const txSnap = await db.collection('transactions').doc(res.body.transactionId).get();
    expect(txSnap.data().merchantId).toBe('m1');

    const otherBalance = await db.collection('merchant_balances').doc('someone-else').get();
    expect(otherBalance.data().availableLiquid).toBe(0); // untouched
  });
});

async function seedCapturedTransaction(db, { transactionId, merchantId, amountGross, status = 'CAPTURED' }) {
  await db.collection('transactions').doc(transactionId).set({
    transactionId,
    merchantId,
    amountGross,
    riskScoreCalculated: 10,
    splitLiquidAmount: amountGross * 0.95,
    splitReserveAmount: amountGross * 0.05,
    platformFeeDeduction: 0,
    status,
    receiptHash: 'tx_hash_seed',
    timestamp: new Date(),
  });
}

function refundBody(overrides = {}) {
  return {
    transactionId: 'tx1',
    refundAmount: 1000,
    reason: 'customer request',
    idempotencyKey: 'rf_1',
    ...overrides,
  };
}

describe('POST /api/transactions/refund — happy path', () => {
  test('a valid refund on a CAPTURED transaction returns 201 with the correct fields', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { availableLiquid: 1000 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 1000 });
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/transactions/refund')
      .set('Authorization', 'Bearer m1')
      .send(refundBody());

    expect(res.status).toBe(201);
    expect(res.body.originalTransactionId).toBe('tx1');
    expect(res.body.refundAmount).toBe(1000);
    expect(res.body.newAvailableLiquid).toBe(0);
    expect(res.body.wasIdempotentReplay).toBe(false);
    expect(res.body.refundTransactionId).toBeTruthy();
  });
});

describe('POST /api/transactions/refund — validation', () => {
  test('missing required fields are rejected with 400', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { availableLiquid: 1000 });
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/transactions/refund')
      .set('Authorization', 'Bearer m1')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.errors.map((e) => e.field)).toEqual(
      expect.arrayContaining(['transactionId', 'refundAmount', 'idempotencyKey'])
    );
  });
});

describe('POST /api/transactions/refund — ownership', () => {
  test('a transaction belonging to a different merchant returns 404 without leaking details', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { merchantId: 'm1', availableLiquid: 1000 });
    await seedMerchant(db, { merchantId: 'someone-else', availableLiquid: 1000 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'someone-else', amountGross: 1000 });
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/transactions/refund')
      .set('Authorization', 'Bearer m1')
      .send(refundBody());

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Transaction not found.');
    expect(JSON.stringify(res.body)).not.toMatch(/someone-else/);

    const otherBalance = await db.collection('merchant_balances').doc('someone-else').get();
    expect(otherBalance.data().availableLiquid).toBe(1000); // untouched
  });

  test('a nonexistent transactionId returns 404', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { availableLiquid: 1000 });
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/transactions/refund')
      .set('Authorization', 'Bearer m1')
      .send(refundBody({ transactionId: 'does-not-exist' }));

    expect(res.status).toBe(404);
  });
});

describe('POST /api/transactions/refund — eligibility and liquidity', () => {
  test('a transaction already REFUNDED is rejected with 409', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { availableLiquid: 1000 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 1000, status: 'REFUNDED' });
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/transactions/refund')
      .set('Authorization', 'Bearer m1')
      .send(refundBody());

    expect(res.status).toBe(409);
  });

  test('a transaction already DISPUTED is rejected with 409', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { availableLiquid: 1000 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 1000, status: 'DISPUTED' });
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/transactions/refund')
      .set('Authorization', 'Bearer m1')
      .send(refundBody());

    expect(res.status).toBe(409);
  });

  test('refundAmount exceeding availableLiquid is rejected with 422', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { availableLiquid: 500 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 1000 });
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/transactions/refund')
      .set('Authorization', 'Bearer m1')
      .send(refundBody());

    expect(res.status).toBe(422);
  });

  test('refundAmount not matching the original amountGross is rejected with 422', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { availableLiquid: 1000 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 1000 });
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/transactions/refund')
      .set('Authorization', 'Bearer m1')
      .send(refundBody({ refundAmount: 500 }));

    expect(res.status).toBe(422);
  });
});

describe('POST /api/transactions/refund — idempotency', () => {
  test('a repeated idempotencyKey returns 200 with wasIdempotentReplay true and does not double-subtract', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { availableLiquid: 1000 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 1000 });
    const app = buildApp(db);
    const body = refundBody();

    const first = await request(app).post('/api/transactions/refund').set('Authorization', 'Bearer m1').send(body);
    const second = await request(app).post('/api/transactions/refund').set('Authorization', 'Bearer m1').send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.wasIdempotentReplay).toBe(true);
    expect(second.body.refundTransactionId).toBe(first.body.refundTransactionId);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(0);
  });
});

describe('POST /api/transactions/refund — ignored client fields', () => {
  test('a client-supplied merchantId/availableLiquid in the body has zero effect', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { merchantId: 'm1', availableLiquid: 1000 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 1000 });
    const app = buildApp(db);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/transactions/refund')
      .set('Authorization', 'Bearer m1')
      .send({ ...refundBody({ idempotencyKey: 'rf_spoof' }), merchantId: 'someone-else', availableLiquid: 999999 });

    warnSpy.mockRestore();

    expect(res.status).toBe(201);
    expect(res.body.newAvailableLiquid).toBe(0); // computed from real balance, not the spoofed value
  });
});

async function seedTransactionWithFields(db, { transactionId, merchantId, riskScoreCalculated, status = 'CAPTURED', timestamp }) {
  await db.collection('transactions').doc(transactionId).set({
    transactionId,
    merchantId,
    amountGross: 500,
    riskScoreCalculated,
    splitLiquidAmount: 450,
    splitReserveAmount: 50,
    platformFeeDeduction: 0,
    status,
    receiptHash: 'tx_hash_seed',
    timestamp,
  });
}

describe('GET /api/transactions', () => {
  test('lists only the caller\'s own transactions, paginated', async () => {
    const db = new FakeFirestore();
    await seedTransactionWithFields(db, { transactionId: 't1', merchantId: 'm1', riskScoreCalculated: 10, timestamp: new Date('2026-01-01') });
    await seedTransactionWithFields(db, { transactionId: 't2', merchantId: 'm2', riskScoreCalculated: 10, timestamp: new Date('2026-01-02') });
    const app = buildApp(db);

    const res = await request(app).get('/api/transactions').set('Authorization', 'Bearer m1');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].transactionId).toBe('t1');
  });

  test('filters by status, riskMin/riskMax, and dateFrom/dateTo', async () => {
    const db = new FakeFirestore();
    await seedTransactionWithFields(db, { transactionId: 't1', merchantId: 'm1', riskScoreCalculated: 20, status: 'CAPTURED', timestamp: new Date('2026-01-01') });
    await seedTransactionWithFields(db, { transactionId: 't2', merchantId: 'm1', riskScoreCalculated: 50, status: 'REFUNDED', timestamp: new Date('2026-02-01') });
    await seedTransactionWithFields(db, { transactionId: 't3', merchantId: 'm1', riskScoreCalculated: 80, status: 'CAPTURED', timestamp: new Date('2026-03-01') });
    const app = buildApp(db);

    const res = await request(app)
      .get('/api/transactions?status=REFUNDED&riskMin=30&riskMax=70&dateFrom=2026-01-15&dateTo=2026-02-15')
      .set('Authorization', 'Bearer m1');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].transactionId).toBe('t2');
  });

  test('rejects an invalid status with 400', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const res = await request(app).get('/api/transactions?status=BOGUS').set('Authorization', 'Bearer m1');

    expect(res.status).toBe(400);
  });

  test('requires a merchant bearer token', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const res = await request(app).get('/api/transactions');

    expect(res.status).toBe(401);
  });
});
