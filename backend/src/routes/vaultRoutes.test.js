import express from 'express';
import request from 'supertest';
import { createVaultRoutes } from './vaultRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { FakeFirestore } from '../services/testUtils/fakeFirestore.js';

jest.mock('../config/firebaseAdmin.js', () => ({ db: {}, auth: {} }));
jest.mock('../config/env.js', () => ({ env: { NODE_ENV: 'test' } }));

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
  app.use('/api/vault', createVaultRoutes({ db }));
  app.use(errorHandler);
  return app;
}

async function seedCapsule(db, { vaultId, merchantId, releaseDate, isMatured = false }) {
  await db.collection('reserve_vault').doc(vaultId).set({
    vaultId,
    merchantId,
    associatedTransactionId: `tx_${vaultId}`,
    amountLocked: 100,
    releaseDate,
    isMatured,
    createdAt: new Date(),
  });
}

describe('GET /api/vault', () => {
  test('lists only the caller\'s own capsules, soonest-maturing first', async () => {
    const db = new FakeFirestore();
    await seedCapsule(db, { vaultId: 'v1', merchantId: 'm1', releaseDate: new Date('2026-03-01') });
    await seedCapsule(db, { vaultId: 'v2', merchantId: 'm1', releaseDate: new Date('2026-01-01') });
    await seedCapsule(db, { vaultId: 'v3', merchantId: 'm2', releaseDate: new Date('2026-02-01') });
    const app = buildApp(db);

    const res = await request(app).get('/api/vault').set('Authorization', 'Bearer m1');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].vaultId).toBe('v2');
  });

  test('filters by isMatured', async () => {
    const db = new FakeFirestore();
    await seedCapsule(db, { vaultId: 'v1', merchantId: 'm1', releaseDate: new Date('2026-01-01'), isMatured: true });
    await seedCapsule(db, { vaultId: 'v2', merchantId: 'm1', releaseDate: new Date('2026-02-01'), isMatured: false });
    const app = buildApp(db);

    const res = await request(app).get('/api/vault?isMatured=true').set('Authorization', 'Bearer m1');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].vaultId).toBe('v1');
  });

  test('rejects an invalid isMatured value with 400', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const res = await request(app).get('/api/vault?isMatured=maybe').set('Authorization', 'Bearer m1');

    expect(res.status).toBe(400);
  });

  test('requires a merchant bearer token', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const res = await request(app).get('/api/vault');

    expect(res.status).toBe(401);
  });
});

describe('POST /api/vault/sweep-matured — still scaffolded', () => {
  test('returns the scaffolded placeholder response', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const res = await request(app).post('/api/vault/sweep-matured').set('Authorization', 'Bearer m1');

    expect(res.status).toBe(202);
  });
});
