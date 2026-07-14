import { Router } from 'express';
import { db as defaultDb } from '../config/firebaseAdmin.js';
import { requireMerchantAuth } from '../middleware/authMiddleware.js';

// Both routes below reuse requireMerchantAuth directly as their token
// verification step, rather than introducing a separate "decode token"
// helper. requireMerchantAuth already does exactly that (verifies the
// Firebase ID token, exposes { uid, email } on req.merchant, 401s on
// missing/invalid) without assuming any /users or /merchants document
// exists — it makes no Firestore reads of its own. That makes it safe to
// use ahead of registration, when /users/{uid} may not exist yet.

export function createAuthRoutes({ db }) {
  const router = Router();

  // GET /api/auth/session
  // Verifies the Firebase ID token and confirms the corresponding
  // /users/{uid} document exists. Called once on app mount to hydrate
  // AuthContext before rendering protected views.
  router.get('/session', requireMerchantAuth, async (req, res, next) => {
    try {
      const { uid } = req.merchant;

      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) {
        // Firebase Auth succeeded but registration was never completed (or
        // failed partway) — a legitimate, expected state the frontend
        // detects and redirects on, not an error.
        return res.status(200).json({ needsRegistration: true });
      }

      return res.status(200).json(userSnap.data());
    } catch (err) {
      next(err);
    }
  });

  // POST /api/auth/register
  // Creates the initial /users/{uid} document after Firebase Auth sign-up.
  // Deliberately does NOT create /merchants/{merchantId} — that write
  // happens once the onboarding wizard completes, since the opening risk
  // tier depends on the wizard's answers (API_DOCUMENTATION.md).
  router.post('/register', requireMerchantAuth, async (req, res, next) => {
    try {
      // uid and email come EXCLUSIVELY from the verified token. Any
      // uid/email/role in the request body is never read, not even for
      // validation.
      const { uid, email } = req.merchant;

      if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'role')) {
        console.warn(
          `[authRoutes] POST /register from uid ${uid} included a client-supplied "role" field (${JSON.stringify(
            req.body.role
          )}). Ignored — this endpoint only ever creates MERCHANT-role users; admin identity is issued separately (CLAUDE.md invariant #7).`
        );
      }

      const userRef = db.collection('users').doc(uid);
      const existingSnap = await userRef.get();
      if (existingSnap.exists) {
        // Idempotent retry (e.g. a client re-calling register after a
        // dropped response) — return the existing document rather than
        // erroring or duplicating.
        return res.status(200).json(existingSnap.data());
      }

      const userDoc = {
        uid,
        email,
        role: 'MERCHANT',
        createdAt: new Date(),
      };
      await userRef.set(userDoc);

      return res.status(201).json(userDoc);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createAuthRoutes({ db: defaultDb });
