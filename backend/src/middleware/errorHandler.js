import { env } from '../config/env.js';

// Unified error-interceptor. Must be mounted last, after all routes.
export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const body = { message: err.message || 'Internal server error.' };

  if (env.NODE_ENV !== 'production') {
    body.stack = err.stack;
  }

  res.status(status).json(body);
}
