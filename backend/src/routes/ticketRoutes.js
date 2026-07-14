import { Router } from 'express';
import { db as defaultDb } from '../config/firebaseAdmin.js';
import { requireMerchantAuth, requireAdminAuth, requireMerchantOrAdminAuth } from '../middleware/authMiddleware.js';
import {
  createTicket,
  listTickets,
  getTicketWithMessages,
  addTicketMessage,
  resolveTicket,
  VALID_PRIORITIES,
  VALID_STATUSES,
} from '../services/ticketService.js';

// Fields a client must never set directly on ticket creation — status is
// always OPEN at creation and only ever changes via the reply-transition
// rules or the admin-only /status endpoint below, never a client-supplied
// value on this route.
const IGNORED_TICKET_FIELDS = ['ticketId', 'merchantId', 'status', 'createdAt', 'updatedAt'];

function validateCreateTicketBody(body) {
  const errors = [];
  const b = body || {};

  if (!b.subject || typeof b.subject !== 'string') {
    errors.push({ field: 'subject', message: 'subject is required and must be a non-empty string.' });
  }
  if (!b.priority || !VALID_PRIORITIES.includes(b.priority)) {
    errors.push({
      field: 'priority',
      message: `priority is required and must be one of ${VALID_PRIORITIES.join(', ')}.`,
    });
  }
  if (!b.description || typeof b.description !== 'string') {
    errors.push({ field: 'description', message: 'description is required and must be a non-empty string.' });
  }

  return errors;
}

export function createTicketRoutes({ db }) {
  const router = Router();

  // POST /api/tickets — merchant only
  router.post('/', requireMerchantAuth, async (req, res, next) => {
    try {
      const merchantId = req.merchant.uid;

      const presentIgnored = IGNORED_TICKET_FIELDS.filter((field) => field in (req.body || {}));
      if (presentIgnored.length > 0) {
        console.warn(
          `[ticketRoutes] POST / from merchant ${merchantId} included ignored field(s): ${presentIgnored.join(
            ', '
          )}. These are always server-computed and were discarded.`
        );
      }

      const validationErrors = validateCreateTicketBody(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: validationErrors });
      }

      const { subject, priority, description } = req.body;
      const ticket = await createTicket(db, { merchantId, subject, priority, description });
      return res.status(201).json(ticket);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/tickets — merchant sees their own; admin sees all, paginated.
  // One route branching on caller role via requireMerchantOrAdminAuth,
  // chosen over two separately-guarded routes, since the response shape,
  // filtering, and pagination logic are identical either way — only the
  // merchantId scope passed to listTickets differs.
  router.get('/', requireMerchantOrAdminAuth, async (req, res, next) => {
    try {
      const { status } = req.query;
      if (status && !VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          message: 'Validation failed.',
          errors: [{ field: 'status', message: `status, if provided, must be one of ${VALID_STATUSES.join(', ')}.` }],
        });
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const isAdmin = !!req.admin;
      const merchantId = isAdmin ? undefined : req.merchant.uid;

      const result = await listTickets(db, { merchantId, status, limit, offset });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/tickets/:ticketId — ownership-checked for merchants (404, not
  // 403, if it belongs to someone else — same pattern as Step 12/13's
  // ownership checks); admins can view any ticket. Includes the message
  // subcollection directly in the response body (chosen over a separate
  // GET /:ticketId/messages endpoint, since a ticket's thread is always
  // read together with the ticket itself in both the merchant and admin
  // UI — no use case here needs the ticket without its messages).
  router.get('/:ticketId', requireMerchantOrAdminAuth, async (req, res, next) => {
    try {
      const { ticketId } = req.params;
      const isAdmin = !!req.admin;
      const requireOwnerMerchantId = isAdmin ? null : req.merchant.uid;

      const result = await getTicketWithMessages(db, { ticketId, requireOwnerMerchantId });
      if (!result) {
        return res.status(404).json({ message: 'Ticket not found.' });
      }
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/tickets/:ticketId/messages — both merchant and admin;
  // ownership-checked for merchants.
  router.post('/:ticketId/messages', requireMerchantOrAdminAuth, async (req, res, next) => {
    try {
      const { ticketId } = req.params;
      const isAdmin = !!req.admin;
      // authorId/authorRole come exclusively from the verified token —
      // never from the request body.
      const authorId = isAdmin ? req.admin.role || 'ADMIN' : req.merchant.uid;
      const authorRole = isAdmin ? 'ADMIN' : 'MERCHANT';
      const requireOwnerMerchantId = isAdmin ? null : req.merchant.uid;

      const body = req.body ? req.body.body : undefined;
      if (!body || typeof body !== 'string') {
        return res.status(400).json({
          message: 'Validation failed.',
          errors: [{ field: 'body', message: 'body is required and must be a non-empty string.' }],
        });
      }

      const result = await addTicketMessage(db, { ticketId, authorId, authorRole, body, requireOwnerMerchantId });
      return res.status(201).json(result);
    } catch (err) {
      if (/not found|does not belong to merchant/.test(err.message)) {
        // Same not-403 pattern as elsewhere — a ticket that doesn't exist
        // and one that belongs to someone else look identical to the caller.
        return res.status(404).json({ message: 'Ticket not found.' });
      }
      next(err);
    }
  });

  // PATCH /api/tickets/:ticketId/status — admin only.
  router.patch('/:ticketId/status', requireAdminAuth, async (req, res, next) => {
    try {
      const { ticketId } = req.params;
      const { status } = req.body || {};

      // RESOLVED is currently the ONLY status value this endpoint accepts.
      // OPEN and PENDING only ever occur via ticket creation or the reply
      // transition rules in addTicketMessage — never as a direct
      // admin-settable value here. Do not loosen this to accept
      // OPEN/PENDING without a deliberate design decision (see the session
      // deliverable — this restriction is intentional, not an oversight).
      if (status !== 'RESOLVED') {
        return res.status(400).json({
          message: 'Validation failed.',
          errors: [
            { field: 'status', message: 'status must be exactly "RESOLVED" — this endpoint accepts no other value.' },
          ],
        });
      }

      const ticket = await resolveTicket(db, { ticketId });
      return res.status(200).json(ticket);
    } catch (err) {
      if (/not found/.test(err.message)) {
        return res.status(404).json({ message: 'Ticket not found.' });
      }
      next(err);
    }
  });

  return router;
}

export default createTicketRoutes({ db: defaultDb });
