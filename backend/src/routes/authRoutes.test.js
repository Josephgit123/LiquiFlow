import express from 'express';
import request from 'supertest';
import { createAuthRoutes } from './authRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { FakeFirestore } from '../services/testUtils/fakeFirestore.js';

// Unlike transactionRoutes.test.js/adminRoutes.test.js, this suite does NOT
// mock authMiddleware.js — the auth flow itself is what's under test here.
// Instead it fakes Firebase Auth's verifyIdToken: any token other than the
// INVALID_TOKEN sentinel decodes successfully, with uid set to the token
// string itself (so a test can address "the merchant with uid m1" just by
// sending `Bearer m1`). This exercises the real requireMerchantAuth
// middleware, including its actual 401 handling.
const INVALID_TOKEN = 'invalid-token';

jest.mock('../config/firebaseAdmin.js', () => ({
  db: {},
  auth: {
    verifyIdToken: async (token) => {
      if (!token || token === 'invalid-token') {
        throw new Error('Firebase ID token verification failed.');
      }
      return { uid: token, email: `${token}@test.com` };
    },
  },
}));

// errorHandler.js reads env.NODE_ENV directly; env.js itself throws at
// import time unless Firebase/JWT/admin secrets are set, which have no
// place in a unit test.
jest.mock('../config/env.js', () => ({ env: { NODE_ENV: 'test' } }));

function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRoutes({ db }));
  app.use(errorHandler);
  return app;
}

describe('POST /api/auth/register', () => {
  test('valid token, no existing /users doc — creates the doc with role forced to MERCHANT, returns 201', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const res = await request(app).post('/api/auth/register').set('Authorization', 'Bearer m1');

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ uid: 'm1', email: 'm1@test.com', role: 'MERCHANT' });
    expect(res.body.createdAt).toBeTruthy();

    const userSnap = await db.collection('users').doc('m1').get();
    expect(userSnap.exists).toBe(true);
    expect(userSnap.data().role).toBe('MERCHANT');
  });

  test('a body with role: ADMIN or a spoofed uid is ignored; the created doc uses the token uid and role MERCHANT', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', 'Bearer m2')
      .send({ uid: 'someone-else', email: 'spoofed@test.com', role: 'ADMIN' });

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    expect(res.status).toBe(201);
    expect(res.body.uid).toBe('m2');
    expect(res.body.email).toBe('m2@test.com');
    expect(res.body.role).toBe('MERCHANT');

    const userSnap = await db.collection('users').doc('m2').get();
    expect(userSnap.exists).toBe(true);
    expect(userSnap.data().uid).toBe('m2');
    expect(userSnap.data().role).toBe('MERCHANT');

    const spoofedSnap = await db.collection('users').doc('someone-else').get();
    expect(spoofedSnap.exists).toBe(false);
  });

  test('calling register twice with the same token returns the existing doc (200) rather than erroring or duplicating', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const first = await request(app).post('/api/auth/register').set('Authorization', 'Bearer m3');
    const second = await request(app).post('/api/auth/register').set('Authorization', 'Bearer m3');

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  test('missing or invalid token is rejected with 401', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const missing = await request(app).post('/api/auth/register');
    expect(missing.status).toBe(401);

    const invalid = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${INVALID_TOKEN}`);
    expect(invalid.status).toBe(401);
  });
});

describe('GET /api/auth/session', () => {
  test('valid token with an existing /users doc — returns 200 with the document', async () => {
    const db = new FakeFirestore();
    await db.collection('users').doc('m1').set({
      uid: 'm1',
      email: 'm1@test.com',
      role: 'MERCHANT',
      createdAt: new Date(),
    });
    const app = buildApp(db);

    const res = await request(app).get('/api/auth/session').set('Authorization', 'Bearer m1');

    expect(res.status).toBe(200);
    expect(res.body.uid).toBe('m1');
    expect(res.body.role).toBe('MERCHANT');
    expect(res.body.needsRegistration).toBeUndefined();
  });

  test('valid token but no /users doc — returns 200 with needsRegistration: true, not an error', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const res = await request(app).get('/api/auth/session').set('Authorization', 'Bearer m4');

    expect(res.status).toBe(200);
    expect(res.body.needsRegistration).toBe(true);
  });

  test('missing or invalid token is rejected with 401', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const missing = await request(app).get('/api/auth/session');
    expect(missing.status).toBe(401);

    const invalid = await request(app)
      .get('/api/auth/session')
      .set('Authorization', `Bearer ${INVALID_TOKEN}`);
    expect(invalid.status).toBe(401);
  });
});
