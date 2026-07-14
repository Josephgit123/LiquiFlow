import { Router } from 'express';

import healthRoutes from './healthRoutes.js';
import authRoutes from './authRoutes.js';
import adminRoutes from './adminRoutes.js';
import merchantRoutes from './merchantRoutes.js';
import transactionRoutes from './transactionRoutes.js';
import vaultRoutes from './vaultRoutes.js';
import aiRoutes from './aiRoutes.js';
import webhookRoutes from './webhookRoutes.js';
import ticketRoutes from './ticketRoutes.js';
import notificationRoutes from './notificationRoutes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/merchants', merchantRoutes);
router.use('/transactions', transactionRoutes);
router.use('/vault', vaultRoutes);
router.use('/ai', aiRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/tickets', ticketRoutes);
router.use('/notifications', notificationRoutes);

export default router;
