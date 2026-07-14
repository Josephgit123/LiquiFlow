import { Router } from 'express';
import { db as defaultDb } from '../config/firebaseAdmin.js';
import { requireMerchantOrAdminAuth } from '../middleware/authMiddleware.js';
import { listNotifications, markNotificationRead } from '../services/notificationService.js';

export function createNotificationRoutes({ db }) {
  const router = Router();

  // GET /api/notifications — merchant sees their own (merchantId match)
  // plus any targetRole-wide notifications relevant to them; admin sees
  // admin-targeted ones. Paginated (limit/offset), same convention as
  // GET /api/tickets.
  router.get('/', requireMerchantOrAdminAuth, async (req, res, next) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const isAdmin = !!req.admin;
      const merchantId = isAdmin ? undefined : req.merchant.uid;

      const result = await listNotifications(db, { merchantId, isAdmin, limit, offset });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/notifications/:notificationId/read — ownership-checked
  // (404, not 403, if it doesn't belong to the caller — same pattern used
  // throughout this session). Only `read` is mutable through this route,
  // and only ever to `true` — any other field, or read: false, is
  // rejected outright rather than silently ignored.
  router.patch('/:notificationId/read', requireMerchantOrAdminAuth, async (req, res, next) => {
    try {
      const { notificationId } = req.params;
      const isAdmin = !!req.admin;
      const merchantId = isAdmin ? undefined : req.merchant.uid;

      const bodyKeys = Object.keys(req.body || {});
      const isAcceptableBody = bodyKeys.length === 0 || (bodyKeys.length === 1 && req.body.read === true);
      if (!isAcceptableBody) {
        return res.status(400).json({
          message: 'Validation failed.',
          errors: [{ field: bodyKeys.join(', '), message: 'Only an empty body or { read: true } is accepted by this route.' }],
        });
      }

      const notification = await markNotificationRead(db, { notificationId, merchantId, isAdmin });
      return res.status(200).json(notification);
    } catch (err) {
      if (/not found|does not belong to the caller/.test(err.message)) {
        return res.status(404).json({ message: 'Notification not found.' });
      }
      next(err);
    }
  });

  return router;
}

export default createNotificationRoutes({ db: defaultDb });
