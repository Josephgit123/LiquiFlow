import { createTicket, addTicketMessage, resolveTicket } from './ticketService.js';
import { FakeFirestore } from './testUtils/fakeFirestore.js';

function ticketParams(overrides = {}) {
  return {
    merchantId: 'm1',
    subject: 'Payout delayed',
    priority: 'HIGH',
    description: 'My payout has not arrived.',
    ...overrides,
  };
}

describe('createTicket', () => {
  test('creates a ticket with status OPEN, scoped to the given merchantId', async () => {
    const db = new FakeFirestore();

    const ticket = await createTicket(db, ticketParams());

    expect(ticket.status).toBe('OPEN');
    expect(ticket.merchantId).toBe('m1');
    expect(ticket.ticketId).toBeTruthy();
    expect(ticket.createdAt).toBeInstanceOf(Date);

    const snap = await db.collection('tickets').doc(ticket.ticketId).get();
    expect(snap.exists).toBe(true);
    expect(snap.data().status).toBe('OPEN');
  });
});

describe('addTicketMessage — status transitions', () => {
  test('an ADMIN reply on an OPEN ticket transitions status to PENDING', async () => {
    const db = new FakeFirestore();
    const ticket = await createTicket(db, ticketParams());

    const result = await addTicketMessage(db, {
      ticketId: ticket.ticketId,
      authorId: 'ADMIN',
      authorRole: 'ADMIN',
      body: 'Looking into this now.',
    });

    expect(result.ticket.status).toBe('PENDING');
    const snap = await db.collection('tickets').doc(ticket.ticketId).get();
    expect(snap.data().status).toBe('PENDING');
  });

  test('a MERCHANT reply on an OPEN ticket leaves status unchanged', async () => {
    const db = new FakeFirestore();
    const ticket = await createTicket(db, ticketParams());

    const result = await addTicketMessage(db, {
      ticketId: ticket.ticketId,
      authorId: 'm1',
      authorRole: 'MERCHANT',
      body: 'Any update?',
    });

    expect(result.ticket.status).toBe('OPEN');
  });

  test('a MERCHANT reply on a RESOLVED ticket reopens it to PENDING', async () => {
    const db = new FakeFirestore();
    const ticket = await createTicket(db, ticketParams());
    await resolveTicket(db, { ticketId: ticket.ticketId });

    const result = await addTicketMessage(db, {
      ticketId: ticket.ticketId,
      authorId: 'm1',
      authorRole: 'MERCHANT',
      body: 'This is not actually resolved.',
    });

    expect(result.ticket.status).toBe('PENDING');
    const snap = await db.collection('tickets').doc(ticket.ticketId).get();
    expect(snap.data().status).toBe('PENDING');
  });
});

describe('addTicketMessage — ownership', () => {
  test('rejects a reply from a merchant who does not own the ticket', async () => {
    const db = new FakeFirestore();
    const ticket = await createTicket(db, ticketParams({ merchantId: 'm1' }));

    await expect(
      addTicketMessage(db, {
        ticketId: ticket.ticketId,
        authorId: 'm2',
        authorRole: 'MERCHANT',
        body: 'Not my ticket.',
        requireOwnerMerchantId: 'm2',
      })
    ).rejects.toThrow(/does not belong to merchant/);
  });
});

describe('addTicketMessage — concurrency (the case the subcollection design solves)', () => {
  test('two messages written concurrently by different authors are both preserved as separate subcollection documents', async () => {
    const db = new FakeFirestore();
    const ticket = await createTicket(db, ticketParams());

    const [resultA, resultB] = await Promise.all([
      addTicketMessage(db, {
        ticketId: ticket.ticketId,
        authorId: 'm1',
        authorRole: 'MERCHANT',
        body: 'Message from the merchant.',
      }),
      addTicketMessage(db, {
        ticketId: ticket.ticketId,
        authorId: 'ADMIN',
        authorRole: 'ADMIN',
        body: 'Message from an admin.',
      }),
    ]);

    expect(resultA.message.messageId).not.toBe(resultB.message.messageId);

    const messagesSnap = await db.collection('tickets').doc(ticket.ticketId).collection('messages').get();
    expect(messagesSnap.docs).toHaveLength(2);
    const bodies = messagesSnap.docs.map((d) => d.data().body).sort();
    expect(bodies).toEqual(['Message from an admin.', 'Message from the merchant.'].sort());

    // The admin reply is what determines the final status here (PENDING),
    // regardless of write order, since neither message was lost or
    // overwritten by the other.
    const ticketSnap = await db.collection('tickets').doc(ticket.ticketId).get();
    expect(ticketSnap.data().status).toBe('PENDING');
  });
});

describe('resolveTicket', () => {
  test('sets status to RESOLVED', async () => {
    const db = new FakeFirestore();
    const ticket = await createTicket(db, ticketParams());

    const result = await resolveTicket(db, { ticketId: ticket.ticketId });

    expect(result.status).toBe('RESOLVED');
    const snap = await db.collection('tickets').doc(ticket.ticketId).get();
    expect(snap.data().status).toBe('RESOLVED');
  });

  test('rejects a nonexistent ticketId', async () => {
    const db = new FakeFirestore();
    await expect(resolveTicket(db, { ticketId: 'does-not-exist' })).rejects.toThrow(/not found/);
  });
});
