import { Router } from 'express';
import { db as defaultDb } from '../config/firebaseAdmin.js';
import { requireMerchantAuth } from '../middleware/authMiddleware.js';
import { listVaultCapsulesForMerchant } from '../services/vaultQueryService.js';

export function createVaultRoutes({ db }) {
  const router = Router();

  // GET /api/vault
  // Lists the calling merchant's /reserve_vault capsules
  // (API_DOCUMENTATION.md) — backs the Maturity Vault Interface, whose
  // cards render a live countdown to each capsule's releaseDate
  // client-side. isMatured, if provided ('true'/'false'), filters to only
  // matured or only still-locked capsules. Stays thin: delegates the
  // actual query to vaultQueryService.js, never touching
  // vaultService.js's sweep/creation logic.
  router.get('/', requireMerchantAuth, async (req, res, next) => {
    try {
      const merchantId = req.merchant.uid;

      let isMatured;
      if (req.query.isMatured === 'true') isMatured = true;
      else if (req.query.isMatured === 'false') isMatured = false;
      else if (req.query.isMatured !== undefined) {
        return res.status(400).json({
          message: 'Validation failed.',
          errors: [{ field: 'isMatured', message: 'isMatured, if provided, must be "true" or "false".' }],
        });
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

      const result = await listVaultCapsulesForMerchant(db, { merchantId, isMatured, limit, offset });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/vault/sweep-matured
  // Still scaffolded — NOT implemented in this session. The automatic
  // 60-second background sweep (vaultScheduler.js, Step 9) already
  // matures capsules server-side; nothing in the Phase 4 frontend plan
  // calls this on-demand endpoint directly, so it's left as-is rather than
  // built speculatively.
  router.post('/sweep-matured', requireMerchantAuth, (req, res) => {
    res.status(202).json({ message: 'Scaffolded: on-demand matured-capsule sweep not yet implemented.' });
  });

  return router;
}

export default createVaultRoutes({ db: defaultDb });
