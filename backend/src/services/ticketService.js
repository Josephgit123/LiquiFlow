// GAP: PAYMENT_FLOW.md's Support Ticket Workflow and DATABASE_SCHEMA.md's
// /tickets section are both explicitly marked "inferred from workflow
// spec" — there is no complete existing contract to fill in here. The
// priority enum and every status-transition rule below are this session's
// own invented business rules, not derived from any doc, and are flagged
// for confirmation in the session deliverable.

export const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
export const VALID_STATUSES = ['OPEN', 'PENDING', 'RESOLVED'];

function validateCreateParams(params) {
  const p = params || {};

  if (!p.merchantId || typeof p.merchantId !== 'string') {
    throw new Error('createTicket: merchantId must be a non-empty string.');
  }
  if (!p.subject || typeof p.subject !== 'string') {
    throw new Error('createTicket: subject must be a non-empty string.');
  }
  if (!VALID_PRIORITIES.includes(p.priority)) {
    throw new Error(`createTicket: priority must be one of ${VALID_PRIORITIES.join(', ')}, got "${p.priority}".`);
  }
  if (!p.description || typeof p.description !== 'string') {
    throw new Error('createTicket: description must be a non-empty string.');
  }

  return p;
}

/**
 * Creates a support ticket. A single-document write — no atomicity
 * concern with any other collection, so a plain (non-transactional) set()
 * is enough, unlike addTicketMessage below.
 */
export async function createTicket(db, params) {
  const { merchantId, subject, priority, description } = validateCreateParams(params);

  const ticketRef = db.collection('tickets').doc();
  const now = new Date();
  const ticketDoc = {
    ticketId: ticketRef.id,
    merchantId,
    subject,
    priority,
    description,
    status: 'OPEN',
    createdAt: now,
    updatedAt: now,
  };

  await ticketRef.set(ticketDoc);
  return ticketDoc;
}

/**
 * merchantId: pass to scope to one merchant (the merchant-facing list
 * view); omit/undefined for an admin's cross-merchant list. status:
 * optional exact-match filter. Paginated via a simple limit/offset — no
 * pagination shape is specified anywhere in the docs for this collection,
 * so this mirrors the same limit/offset convention used for notifications.
 *
 * GAP: a merchantId+status equality filter combined with an orderBy on a
 * third field (createdAt) needs a Firestore composite index, the same
 * category of open item flagged for /reserve_vault and /card_velocity_log
 * in Phase 2 — not yet added to firebase/firestore.indexes.json.
 */
export async function listTickets(db, { merchantId, status, limit = 20, offset = 0 } = {}) {
  let query = db.collection('tickets');
  if (merchantId) {
    query = query.where('merchantId', '==', merchantId);
  }
  if (status) {
    query = query.where('status', '==', status);
  }
  query = query.orderBy('createdAt', 'desc').limit(offset + limit + 1);

  const snap = await query.get();
  const matched = snap.docs.map((d) => d.data());
  const page = matched.slice(offset, offset + limit);
  const hasMore = matched.length > offset + limit;

  return { items: page, limit, offset, hasMore };
}

/**
 * Returns { ticket, messages } or null if the ticket doesn't exist OR
 * (when requireOwnerMerchantId is set) belongs to a different merchant —
 * both map to the same null so the caller can return an identical 404
 * either way, never leaking which case applies (same not-403 pattern as
 * Step 12/13's ownership checks).
 */
export async function getTicketWithMessages(db, { ticketId, requireOwnerMerchantId } = {}) {
  if (!ticketId || typeof ticketId !== 'string') {
    throw new Error('getTicketWithMessages: ticketId must be a non-empty string.');
  }

  const ticketSnap = await db.collection('tickets').doc(ticketId).get();
  if (!ticketSnap.exists) {
    return null;
  }
  const ticket = ticketSnap.data();

  if (requireOwnerMerchantId && ticket.merchantId !== requireOwnerMerchantId) {
    return null;
  }

  const messagesSnap = await db
    .collection('tickets')
    .doc(ticketId)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .get();

  return { ticket, messages: messagesSnap.docs.map((d) => d.data()) };
}

function validateMessageParams(params) {
  const p = params || {};

  if (!p.ticketId || typeof p.ticketId !== 'string') {
    throw new Error('addTicketMessage: ticketId must be a non-empty string.');
  }
  if (!p.authorId || typeof p.authorId !== 'string') {
    throw new Error('addTicketMessage: authorId must be a non-empty string.');
  }
  if (p.authorRole !== 'MERCHANT' && p.authorRole !== 'ADMIN') {
    throw new Error(`addTicketMessage: authorRole must be MERCHANT or ADMIN, got "${p.authorRole}".`);
  }
  if (!p.body || typeof p.body !== 'string') {
    throw new Error('addTicketMessage: body must be a non-empty string.');
  }

  return p;
}

/**
 * Appends a reply to /tickets/{ticketId}/messages and applies the
 * (invented, flagged) status-transition rules, inside a single
 * db.runTransaction — chosen over a batch because the transition rule
 * depends on the ticket's CURRENT status, which must be read first; a
 * batch can't read, only write blindly, so a transaction is required here
 * for correctness, not merely for atomicity. This also gives the fix for
 * the DATABASE_SCHEMA.md deviation real teeth: two concurrent replies each
 * re-read the ticket inside their own transaction attempt, and Firestore's
 * optimistic-concurrency retry (re-reading the just-committed status) means
 * neither reply is lost and the final status reflects whichever committed
 * last — impossible to get right with a single shared array field updated
 * via read-modify-write.
 *
 * Status-transition rules (invented — not specified in PAYMENT_FLOW.md,
 * flagged for confirmation):
 *   - An ADMIN reply always sets status to PENDING (no-op if already
 *     PENDING) — something is now awaiting merchant attention.
 *   - A MERCHANT reply on a RESOLVED ticket reopens it to PENDING.
 *   - A MERCHANT reply on an OPEN or PENDING ticket leaves status
 *     unchanged.
 *   - RESOLVED is only ever set explicitly via resolveTicket(), never as a
 *     side effect of a reply.
 */
export async function addTicketMessage(db, params) {
  const { ticketId, authorId, authorRole, body, requireOwnerMerchantId } = validateMessageParams(params);

  const ticketRef = db.collection('tickets').doc(ticketId);
  // Generated once, outside the transaction's retry loop (same pattern
  // settlementService.js uses for txRef) — so a retried attempt reuses the
  // same message ID rather than minting a new candidate each time.
  const messageRef = ticketRef.collection('messages').doc();

  return db.runTransaction(async (transaction) => {
    const ticketSnap = await transaction.get(ticketRef);
    if (!ticketSnap.exists) {
      throw new Error(`addTicketMessage: ticket "${ticketId}" not found.`);
    }
    const ticket = ticketSnap.data();

    if (requireOwnerMerchantId && ticket.merchantId !== requireOwnerMerchantId) {
      throw new Error(
        `addTicketMessage: ticket "${ticketId}" does not belong to merchant "${requireOwnerMerchantId}".`
      );
    }

    let newStatus = ticket.status;
    if (authorRole === 'ADMIN') {
      newStatus = 'PENDING';
    } else if (ticket.status === 'RESOLVED') {
      newStatus = 'PENDING';
    }

    const now = new Date();
    const messageDoc = { messageId: messageRef.id, authorId, authorRole, body, createdAt: now };
    transaction.set(messageRef, messageDoc);
    transaction.update(ticketRef, { status: newStatus, updatedAt: now });

    return { message: messageDoc, ticket: { ...ticket, status: newStatus, updatedAt: now } };
  });
}

/**
 * Explicit admin resolution — the ONLY way a ticket's status becomes
 * RESOLVED. A single-document update with no cross-collection atomicity
 * concern, so a plain (non-transactional) update() is enough, same as
 * merchantRoutes.js's funding-metadata update.
 */
export async function resolveTicket(db, { ticketId } = {}) {
  if (!ticketId || typeof ticketId !== 'string') {
    throw new Error('resolveTicket: ticketId must be a non-empty string.');
  }

  const ticketRef = db.collection('tickets').doc(ticketId);
  const ticketSnap = await ticketRef.get();
  if (!ticketSnap.exists) {
    throw new Error(`resolveTicket: ticket "${ticketId}" not found.`);
  }

  const now = new Date();
  await ticketRef.update({ status: 'RESOLVED', updatedAt: now });

  return { ...ticketSnap.data(), status: 'RESOLVED', updatedAt: now };
}
