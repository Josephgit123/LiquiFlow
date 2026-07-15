import express from 'express';
import request from 'supertest';
import { createMerchantRoutes } from './merchantRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { FakeFirestore } from '../services/testUtils/fakeFirestore.js';

// Avoids real Firebase Admin SDK initialization for the module-level
// `import { db } from '../config/firebaseAdmin.js'` in merchantRoutes.js —
// unused in tests since createMerchantRoutes is always called here with an
// injected FakeFirestore instance instead.
jest.mock('../config/firebaseAdmin.js', () => ({ db: {}, auth: {} }));

// errorHandler.js reads env.NODE_ENV directly; env.js itself throws at
// import time unless Firebase/JWT/admin secrets are set, which have no
// place in a unit test.
jest.mock('../config/env.js', () => ({ env: { NODE_ENV: 'test' } }));

// Fakes requireMerchantAuth so tests can authenticate as any merchant by
// setting `Authorization: Bearer <uid>`, without real Firebase ID tokens —
// same pattern as adminRoutes.test.js/transactionRoutes.test.js, since this
// suite is about the merchant-profile/onboarding business logic, not the
// auth flow itself (that's covered in authRoutes.test.js).
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
  app.use('/api/merchants', createMerchantRoutes({ db }));
  app.use(errorHandler);
  return app;
}

function onboardBody(overrides = {}) {
  return {
    businessName: 'Acme Co',
    entityType: 'LLC',
    industryVector: 'GAMING',
    targetVolume: '10k-50k',
    currency: 'USD',
    ...overrides,
  };
}

describe('GET /api/merchants/me — before onboarding', () => {
  test('returns 200 with needsOnboarding: true when no /merchants doc exists', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const res = await request(app).get('/api/merchants/me').set('Authorization', 'Bearer m1');

    expect(res.status).toBe(200);
    expect(res.body.needsOnboarding).toBe(true);
    expect(db.store.readAll('merchants')).toHaveLength(0);
  });
});

describe('POST /api/merchants/onboard — happy path', () => {
  test('a GAMING merchant onboards successfully with the correct risk baseline', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/merchants/onboard')
      .set('Authorization', 'Bearer m1')
      .send(onboardBody());

    expect(res.status).toBe(201);
    expect(res.body.merchant.accumulatedRiskPoints).toBe(25);
    expect(res.body.merchant.currentRiskTier).toBe('LOW');
    expect(res.body.merchant.accountStatus).toBe('ACTIVE');
    expect(res.body.balance.availableLiquid).toBe(0);
    expect(res.body.balance.lockedEscrow).toBe(0);
    expect(res.body.balance.totalWithdrawn).toBe(0);
    expect(res.body.balance.currency).toBe('USD');
  });
});

describe('POST /api/merchants/onboard — validation', () => {
  test('an invalid industryVector is rejected with 400 and nothing is written', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/merchants/onboard')
      .set('Authorization', 'Bearer m2')
      .send(onboardBody({ industryVector: 'CASINO' }));

    expect(res.status).toBe(400);
    expect(res.body.errors.some((e) => e.field === 'industryVector')).toBe(true);
    expect(db.store.readAll('merchants')).toHaveLength(0);
    expect(db.store.readAll('merchant_balances')).toHaveLength(0);
  });

  test('an invalid entityType is rejected with 400', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/merchants/onboard')
      .set('Authorization', 'Bearer m2')
      .send(onboardBody({ entityType: 'PARTNERSHIP' }));

    expect(res.status).toBe(400);
    expect(res.body.errors.some((e) => e.field === 'entityType')).toBe(true);
  });
});

describe('POST /api/merchants/onboard — spoofed server-controlled fields', () => {
  test('client-supplied accountStatus/currentRiskTier are ignored; server-computed values are used', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/merchants/onboard')
      .set('Authorization', 'Bearer m3')
      .send({ ...onboardBody(), accountStatus: 'SUSPENDED', currentRiskTier: 'HIGH', accumulatedRiskPoints: 999 });

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    expect(res.status).toBe(201);
    expect(res.body.merchant.accountStatus).toBe('ACTIVE');
    expect(res.body.merchant.currentRiskTier).toBe('LOW');
    expect(res.body.merchant.accumulatedRiskPoints).toBe(25);
  });
});

describe('POST /api/merchants/onboard — one-shot', () => {
  test('onboarding an already-ACTIVE merchant a second time is rejected with 409, nothing overwritten', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const first = await request(app)
      .post('/api/merchants/onboard')
      .set('Authorization', 'Bearer m4')
      .send(onboardBody());
    const second = await request(app)
      .post('/api/merchants/onboard')
      .set('Authorization', 'Bearer m4')
      .send(onboardBody({ businessName: 'Different Name', industryVector: 'CRYPTO' }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);

    const merchantSnap = await db.collection('merchants').doc('m4').get();
    expect(merchantSnap.data().businessName).toBe('Acme Co');
    expect(merchantSnap.data().industryVector).toBe('GAMING');
  });
});

describe('GET /api/merchants/me — after onboarding', () => {
  test('returns the merged profile + balance data', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    await request(app)
      .post('/api/merchants/onboard')
      .set('Authorization', 'Bearer m5')
      .send(onboardBody({ currency: 'INR' }));

    const res = await request(app).get('/api/merchants/me').set('Authorization', 'Bearer m5');

    expect(res.status).toBe(200);
    expect(res.body.needsOnboarding).toBeUndefined();
    expect(res.body.businessName).toBe('Acme Co');
    expect(res.body.currentRiskTier).toBe('LOW');
    expect(res.body.availableLiquid).toBe(0);
    expect(res.body.currency).toBe('INR');
  });
});

describe('PATCH /api/merchants/me/funding', () => {
  test('a valid allowlisted field updates successfully and leaves other fields untouched', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);
    await request(app).post('/api/merchants/onboard').set('Authorization', 'Bearer m6').send(onboardBody());

    const res = await request(app)
      .patch('/api/merchants/me/funding')
      .set('Authorization', 'Bearer m6')
      .send({ payoutBankLast4: '4242' });

    expect(res.status).toBe(200);
    expect(res.body.payoutBankLast4).toBe('4242');

    const merchantSnap = await db.collection('merchants').doc('m6').get();
    expect(merchantSnap.data().payoutBankLast4).toBe('4242');
    expect(merchantSnap.data().businessName).toBe('Acme Co'); // untouched
    expect(merchantSnap.data().currentRiskTier).toBe('LOW'); // untouched

    const balanceSnap = await db.collection('merchant_balances').doc('m6').get();
    expect(balanceSnap.data().availableLiquid).toBe(0); // untouched
  });

  test('a field outside the allowlist (e.g. currentRiskTier or availableLiquid) is rejected with 400, nothing written', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);
    await request(app).post('/api/merchants/onboard').set('Authorization', 'Bearer m7').send(onboardBody());

    const res = await request(app)
      .patch('/api/merchants/me/funding')
      .set('Authorization', 'Bearer m7')
      .send({ currentRiskTier: 'HIGH', availableLiquid: 999999 });

    expect(res.status).toBe(400);

    const merchantSnap = await db.collection('merchants').doc('m7').get();
    expect(merchantSnap.data().currentRiskTier).toBe('LOW');

    const balanceSnap = await db.collection('merchant_balances').doc('m7').get();
    expect(balanceSnap.data().availableLiquid).toBe(0);
  });

  test('funding update before onboarding completes (no /merchants doc) returns 404', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const res = await request(app)
      .patch('/api/merchants/me/funding')
      .set('Authorization', 'Bearer m8')
      .send({ payoutBankLast4: '1234' });

    expect(res.status).toBe(404);
  });

  test('funding update when the merchant exists but is not yet ACTIVE returns 409', async () => {
    const db = new FakeFirestore();
    await db.collection('merchants').doc('m9').set({
      merchantId: 'm9',
      businessName: 'Partial',
      entityType: 'LLC',
      industryVector: 'GROCERY',
      targetVolume: '1k-10k',
      currentRiskTier: 'LOW',
      accumulatedRiskPoints: 0,
      accountStatus: 'PENDING',
    });
    const app = buildApp(db);

    const res = await request(app)
      .patch('/api/merchants/me/funding')
      .set('Authorization', 'Bearer m9')
      .send({ payoutBankLast4: '1234' });

    expect(res.status).toBe(409);
  });
});
