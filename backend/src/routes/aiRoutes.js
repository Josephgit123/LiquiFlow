import { Router } from 'express';
import { requireMerchantAuth } from '../middleware/authMiddleware.js';

const router = Router();

// POST /api/ai/copilot
router.post('/copilot', requireMerchantAuth, (req, res) => {
  res.status(202).json({ message: 'Scaffolded: Gemini AI Copilot wiring not yet implemented.' });
});

export default router;
