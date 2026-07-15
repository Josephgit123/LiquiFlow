import jwt from 'jsonwebtoken';
import { auth } from '../config/firebaseAdmin.js';
import { env } from '../config/env.js';

// Verifies a Firebase ID token. Merchant-facing routes only — never shares
// a code path with requireAdminAuth (CLAUDE.md invariant #7: admin isolation).
export async function requireMerchantAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Missing merchant bearer token.' });
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    req.merchant = { uid: decoded.uid, email: decoded.email };
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired merchant token.' });
  }
}

// Verifies the signed admin JWT issued by POST /api/admin/login. Merchant
// auth never feeds into this path, and this path never touches Firebase Auth.
export function requireAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Missing admin bearer token.' });
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (decoded.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Token is not an admin token.' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired admin token.' });
  }
}

// A small number of routes (tickets, notifications) are readable/writable
// by BOTH merchants and admins, with the response scoped differently per
// caller. Express has no built-in "try guard A, else guard B" combinator,
// so this tries the admin JWT first (cheap, synchronous, no network call),
// then falls back to Firebase ID token verification — reusing the exact
// same two verification primitives requireAdminAuth/requireMerchantAuth
// already call, not a third decoding path. Most routes should still use
// requireMerchantAuth or requireAdminAuth directly, since they already
// know which caller type to expect; reach for this only when a route
// genuinely serves both.
export async function requireMerchantOrAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Missing bearer token.' });
  }

  try {
    const decodedAdmin = jwt.verify(token, env.JWT_SECRET);
    if (decodedAdmin.role === 'ADMIN') {
      req.admin = decodedAdmin;
      return next();
    }
  } catch (adminErr) {
    // Not a valid admin JWT — fall through and try a merchant token.
  }

  try {
    const decodedMerchant = await auth.verifyIdToken(token);
    req.merchant = { uid: decodedMerchant.uid, email: decodedMerchant.email };
    return next();
  } catch (merchantErr) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
}
