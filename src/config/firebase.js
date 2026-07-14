import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Client-side Firebase config values (apiKey, authDomain, etc.) are public
// identifiers, not secrets — they're necessarily embedded in the client
// bundle and are safe by design; access control is enforced by Firestore
// security rules (firebase/firestore.rules), not by hiding these values.
// This is the ONLY Firebase config this app needs client-side. Contrast
// with GOOGLE_GENERATIVE_AI_API_KEY (backend/.env.example), which is a
// real secret and must never appear in a VITE_* variable or this bundle.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const firebaseApp = initializeApp(firebaseConfig);

// Merchant identity only (CLAUDE.md invariant #7) — never used for admin
// sessions, which are a separate JWT issued by POST /api/admin/login and
// held in AdminAuthContext, entirely outside Firebase Auth.
export const auth = getAuth(firebaseApp);
export const googleProvider = new GoogleAuthProvider();

// Firestore client instance — READ-ONLY use throughout this app
// (onSnapshot listeners for live balance/vault/ticket/notification
// updates). All writes go through the backend API; firestore.rules denies
// direct client writes structurally, so this is enforced at two layers,
// not just convention.
export const db = getFirestore(firebaseApp);
