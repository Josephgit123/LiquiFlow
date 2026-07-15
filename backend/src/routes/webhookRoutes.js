import { Router } from 'express';
import { requireMerchantAuth } from '../middleware/authMiddleware.js';

const router = Router();

// GET /api/webhooks
router.get('/', requireMerchantAuth, (req, res) => {
  res.status(202).json({ message: 'Scaffolded: webhook subscription listing not yet implemented.' });
});

// POST /api/webhooks
router.post('/', requireMerchantAuth, (req, res) => {
  res.status(202).json({ message: 'Scaffolded: webhook subscription registration not yet implemented.' });
});

export default router;
