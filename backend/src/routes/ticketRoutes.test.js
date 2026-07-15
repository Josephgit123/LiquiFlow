import express from 'express';
import request from 'supertest';
import { createTicketRoutes } from './ticketRoutes.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { FakeFirestore } from '../services/testUtils/fakeFirestore.js';

jest.mock('../config/firebaseAdmin.js', () => ({ db: {}, auth: {} }));
jest.mock('../config/env.js', () => ({ env: { NODE_ENV: 'test' } }));

// Fakes all three auth guards without real Firebase/JWT verification.
// Convention for this suite: a bearer token starting with "admin-" is
// treated as an admin caller; any other token is treated as the merchant
// uid directly (same "token IS the uid" convention as
// transactionRoutes.test.js/adminRoutes.test.js).
jest.mock('../middleware/authMiddleware.js', () => {
  function extractToken(req) {
    const authHeader = req.headers.authorization || '';
    return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  }
  return {
    requireMerchantAuth: (req, res, next) => {
      const uid = extractToken(req);
      if (!uid) return res.status(401).json({ message: 'Missing merchant bearer token.' });
      req.merchant = { uid, email: `${uid}@test.com` };
      next();
    },
    requireAdminAuth: (req, res, next) => {
      const token = extractToken(req);
      if (!token) return res.status(401).json({ message: 'Missing admin bearer token.' });
      req.admin = { role: 'ADMIN' };
      next();
    },
    requireMerchantOrAdminAuth: (req, res, next) => {
      const token = extractToken(req);
      if (!token) return res.status(401).json({ message: 'Missing bearer token.' });
      if (token.startsWith('admin-')) {
        req.admin = { role: 'ADMIN' };
      } else {
        req.merchant = { uid: token, email: `${token}@test.com` };
      }
      next();
    },
  };
});

function buildApp(db) {
  const app = express();
  app.use(express.json());
  app.use('/api/tickets', createTicketRoutes({ db }));
  app.use(errorHandler);
  return app;
}

function ticketBody(overrides = {}) {
  return {
    subject: 'Payout delayed',
    priority: 'HIGH',
    description: 'My payout has not arrived.',
    ...overrides,
  };
}

describe('POST /api/tickets — happy path', () => {
  test('a merchant creates a ticket with status OPEN, scoped to their merchantId', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const res = await request(app).post('/api/tickets').set('Authorization', 'Bearer m1').send(ticketBody());

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('OPEN');
    expect(res.body.merchantId).toBe('m1');
  });
});

describe('POST /api/tickets — validation and spoofing', () => {
  test('missing priority is rejected with 400', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', 'Bearer m1')
      .send({ subject: 'x', description: 'y' });

    expect(res.status).toBe(400);
    expect(res.body.errors.some((e) => e.field === 'priority')).toBe(true);
  });

  test('a client-supplied status is ignored; the ticket is still created as OPEN', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', 'Bearer m1')
      .send({ ...ticketBody(), status: 'RESOLVED' });

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('OPEN');
  });
});

describe('POST /api/tickets/:ticketId/messages — status transitions', () => {
  test('an admin reply transitions an OPEN ticket to PENDING', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);
    const created = await request(app).post('/api/tickets').set('Authorization', 'Bearer m1').send(ticketBody());

    const res = await request(app)
      .post(`/api/tickets/${created.body.ticketId}/messages`)
      .set('Authorization', 'Bearer admin-token')
      .send({ body: 'Looking into this now.' });

    expect(res.status).toBe(201);
    expect(res.body.ticket.status).toBe('PENDING');
    expect(res.body.message.authorRole).toBe('ADMIN');
  });

  test('a merchant reply on a RESOLVED ticket reopens it to PENDING', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);
    const created = await request(app).post('/api/tickets').set('Authorization', 'Bearer m1').send(ticketBody());
    await request(app)
      .patch(`/api/tickets/${created.body.ticketId}/status`)
      .set('Authorization', 'Bearer admin-token')
      .send({ status: 'RESOLVED' });

    const res = await request(app)
      .post(`/api/tickets/${created.body.ticketId}/messages`)
      .set('Authorization', 'Bearer m1')
      .send({ body: 'This is not actually resolved.' });

    expect(res.status).toBe(201);
    expect(res.body.ticket.status).toBe('PENDING');
  });
});

describe('PATCH /api/tickets/:ticketId/status — admin only', () => {
  test('an admin resolves a ticket', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);
    const created = await request(app).post('/api/tickets').set('Authorization', 'Bearer m1').send(ticketBody());

    const res = await request(app)
      .patch(`/api/tickets/${created.body.ticketId}/status`)
      .set('Authorization', 'Bearer admin-token')
      .send({ status: 'RESOLVED' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('RESOLVED');
  });

  test('a status value other than RESOLVED is rejected with 400', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);
    const created = await request(app).post('/api/tickets').set('Authorization', 'Bearer m1').send(ticketBody());

    const res = await request(app)
      .patch(`/api/tickets/${created.body.ticketId}/status`)
      .set('Authorization', 'Bearer admin-token')
      .send({ status: 'OPEN' });

    expect(res.status).toBe(400);
  });

  test('a missing bearer token is rejected with 401', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);
    const created = await request(app).post('/api/tickets').set('Authorization', 'Bearer m1').send(ticketBody());

    const res = await request(app)
      .patch(`/api/tickets/${created.body.ticketId}/status`)
      .send({ status: 'RESOLVED' });

    expect(res.status).toBe(401);
  });
});

describe('ownership — a merchant cannot view or reply to another merchant\'s ticket', () => {
  test('GET /:ticketId returns 404, not 403, with no data leaked', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);
    const created = await request(app).post('/api/tickets').set('Authorization', 'Bearer m1').send(ticketBody());

    const res = await request(app)
      .get(`/api/tickets/${created.body.ticketId}`)
      .set('Authorization', 'Bearer m2');

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/Payout delayed/);
  });

  test('POST /:ticketId/messages returns 404', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);
    const created = await request(app).post('/api/tickets').set('Authorization', 'Bearer m1').send(ticketBody());

    const res = await request(app)
      .post(`/api/tickets/${created.body.ticketId}/messages`)
      .set('Authorization', 'Bearer m2')
      .send({ body: 'Not my ticket.' });

    expect(res.status).toBe(404);
  });

  test('admin can view any ticket', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);
    const created = await request(app).post('/api/tickets').set('Authorization', 'Bearer m1').send(ticketBody());

    const res = await request(app)
      .get(`/api/tickets/${created.body.ticketId}`)
      .set('Authorization', 'Bearer admin-token');

    expect(res.status).toBe(200);
    expect(res.body.ticket.ticketId).toBe(created.body.ticketId);
    expect(res.body.messages).toEqual([]);
  });
});

describe('GET /api/tickets — scoping', () => {
  test('a merchant only sees their own tickets; an admin sees all', async () => {
    const db = new FakeFirestore();
    const app = buildApp(db);
    await request(app).post('/api/tickets').set('Authorization', 'Bearer m1').send(ticketBody({ subject: 'm1 ticket' }));
    await request(app).post('/api/tickets').set('Authorization', 'Bearer m2').send(ticketBody({ subject: 'm2 ticket' }));

    const merchantView = await request(app).get('/api/tickets').set('Authorization', 'Bearer m1');
    expect(merchantView.status).toBe(200);
    expect(merchantView.body.items).toHaveLength(1);
    expect(merchantView.body.items[0].subject).toBe('m1 ticket');

    const adminView = await request(app).get('/api/tickets').set('Authorization', 'Bearer admin-token');
    expect(adminView.status).toBe(200);
    expect(adminView.body.items).toHaveLength(2);
  });
});
