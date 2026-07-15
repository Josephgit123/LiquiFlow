import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import apiRouter from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { db } from './config/firebaseAdmin.js';
import { startVaultScheduler } from './services/vaultScheduler.js';

const app = express();

app.use(cors({ origin: env.CORS_ORIGIN }));
app.use(express.json());

app.use('/api', apiRouter);

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`liquiflow-backend listening on port ${env.PORT} (${env.NODE_ENV})`);
});

// Gated so test/CI runs don't spin up a stray background timer.
if (env.ENABLE_VAULT_SCHEDULER) {
  startVaultScheduler(db);
}

export default app;
