import express from 'express';
import request from 'supertest';
import { createNotificationRoutes } from './notificationRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { createNotification } from '../services/notificationService.js';
import { FakeFirestore } from '../services/testUtils/fakeFirestore.js';

jest.mock('../config/firebaseAdmin.js', () => ({ db: {}, auth: {} }));
jest.mock('../config/env.js', () => ({ env: { NODE_ENV: 'test' } }));

// Same convention as ticketRoutes.test.js: a bearer token starting with
// "admin-" is an admin caller; any other token is the merchant uid itself.
jest.mock('../middleware/authMiddleware.js', () => ({
  requireMerchantOrAdminAuth: (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Missing bearer token.' });
    if (token.startsWith('admin-')) {
      req.admin = { role: 'ADMIN' };
    } else {
      req.merchant = { uid: token, email: `${token}@test.com` };
    }
    next();
  },
  requireMerchantAuth: (req, res, next) => next(),
  requireAdminAuth: (req, res, next) => next(),
}));

function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', createNotificationRoutes({ db }));
  app.use(errorHandler);
  return app;
}

describe('GET /api/notifications — scoping', () => {
  test('a merchant sees their own notifications plus MERCHANT-wide broadcasts, not another merchant\'s or admin ones', async () => {
    const db = new FakeFirestore();
    await createNotification(db, { targetRole: 'MERCHANT', merchantId: 'm1', message: 'For m1', category: 'X' });
    await createNotification(db, { targetRole: 'MERCHANT', merchantId: 'm2', message: 'For m2', category: 'X' });
    await createNotification(db, { targetRole: 'MERCHANT', merchantId: null, message: 'Broadcast', category: 'X' });
    await createNotification(db, { targetRole: 'ADMIN', merchantId: null, message: 'For admins', category: 'X' });
    const app = buildApp(db);

    const res = await request(app).get('/api/notifications').set('Authorization', 'Bearer m1');

    expect(res.status).toBe(200);
    expect(res.body.items.map((n) => n.message).sort()).toEqual(['Broadcast', 'For m1'].sort());
  });

  test('an admin sees only admin-targeted notifications', async () => {
    const db = new FakeFirestore();
    await createNotification(db, { targetRole: 'MERCHANT', merchantId: 'm1', message: 'For m1', category: 'X' });
    await createNotification(db, { targetRole: 'ADMIN', merchantId: null, message: 'For admins', category: 'X' });
    const app = buildApp(db);

    const res = await request(app).get('/api/notifications').set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.items.map((n) => n.message)).toEqual(['For admins']);
  });
});

describe('PATCH /api/notifications/:notificationId/read', () => {
  test('a merchant marks their own notification read', async () => {
    const db = new FakeFirestore();
    const notification = await createNotification(db, {
      targetRole: 'MERCHANT',
      merchantId: 'm1',
      message: 'For m1',
      category: 'X',
    });
    const app = buildApp(db);

    const res = await request(app)
      .patch(`/api/notifications/${notification.notificationId}/read`)
      .set('Authorization', 'Bearer m1')
      .send({ read: true });

    expect(res.status).toBe(200);
    expect(res.body.read).toBe(true);
  });

  test('a merchant marking another merchant\'s notification as read gets 404, no data leaked', async () => {
    const db = new FakeFirestore();
    const notification = await createNotification(db, {
      targetRole: 'MERCHANT',
      merchantId: 'm2',
      message: 'Secret for m2',
      category: 'X',
    });
    const app = buildApp(db);

    const res = await request(app)
      .patch(`/api/notifications/${notification.notificationId}/read`)
      .set('Authorization', 'Bearer m1')
      .send({ read: true });

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/Secret for m2/);
  });

  test('a field other than read is rejected with 400', async () => {
    const db = new FakeFirestore();
    const notification = await createNotification(db, {
      targetRole: 'MERCHANT',
      merchantId: 'm1',
      message: 'For m1',
      category: 'X',
    });
    const app = buildApp(db);

    const res = await request(app)
      .patch(`/api/notifications/${notification.notificationId}/read`)
      .set('Authorization', 'Bearer m1')
      .send({ message: 'tampered' });

    expect(res.status).toBe(400);
  });

  test('a nonexistent notificationId returns 404', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const res = await request(app)
      .patch('/api/notifications/does-not-exist/read')
      .set('Authorization', 'Bearer m1')
      .send({ read: true });

    expect(res.status).toBe(404);
  });
});
