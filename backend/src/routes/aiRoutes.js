import { Router } from 'express';
import { db as defaultDb } from '../config/firebaseAdmin.js';
import { requireMerchantOrAdminAuth } from '../middleware/authMiddleware.js';
import { generateCopilotReply } from '../services/aiCopilotService.js';

function validateCopilotBody(body) {
  const errors = [];
  const b = body || {};
  if (!b.message || typeof b.message !== 'string' || !b.message.trim()) {
    errors.push({ field: 'message', message: 'message is required and must be a non-empty string.' });
  }
  if (b.history !== undefined && !Array.isArray(b.history)) {
    errors.push({ field: 'history', message: 'history, if provided, must be an array.' });
  }
  return errors;
}

export function createAiRoutes({ db }) {
  const router = Router();

  // POST /api/ai/copilot — available to both merchant and admin callers
  // (requireMerchantOrAdminAuth), each getting a context snapshot scoped
  // to what they're allowed to see (their own balance/transactions, or
  // platform-wide analytics) — never the other's.
  router.post('/copilot', requireMerchantOrAdminAuth, async (req, res, next) => {
    try {
      const validationErrors = validateCopilotBody(req.body);
      if (validationErrors.length > 0) {
        return res.status(400).json({ message: 'Validation failed.', errors: validationErrors });
      }

      const isAdmin = !!req.admin;
      const merchantId = isAdmin ? undefined : req.merchant.uid;
      const { message, history } = req.body;

      const result = await generateCopilotReply(db, { message, history, merchantId, isAdmin });
      return res.status(200).json({ reply: result.reply });
    } catch (err) {
      if (err.code === 'AI_NOT_CONFIGURED') {
        return res.status(503).json({ message: err.message });
      }
      next(err);
    }
  });

  return router;
}

export default createAiRoutes({ db: defaultDb });
