import admin from 'firebase-admin';
import { env } from './env.js';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      // .env files store the key with literal "\n" sequences.
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

export const db = admin.firestore();
export const auth = admin.auth();
// Same project's default bucket (matches VITE_FIREBASE_STORAGE_BUCKET on
// the client) — used only for merchant/admin profile photo uploads via the
// Admin SDK; the client never writes to Storage directly (storage.rules
// denies all client read/write, mirroring firestore.rules' write posture).
export const bucket = admin.storage().bucket();
export default admin;
