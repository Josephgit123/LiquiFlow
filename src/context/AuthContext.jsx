import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { auth, googleProvider } from '../config/firebase.js';
import { apiFetch } from '../services/apiClient.js';

const AuthContext = createContext(undefined);

/**
 * Merchant-side auth + profile state. Combines TWO genuinely separate
 * backend checks (confirmed against the real route files, not assumed —
 * the build brief's "route based on GET /api/auth/session's
 * needsOnboarding/needsRegistration flags" conflates them, but they are
 * two different endpoints):
 *   1. GET /api/auth/session (Step 12) -> { needsRegistration: true } or
 *      the /users doc.
 *   2. GET /api/merchants/me (Step 13) -> { needsOnboarding: true } or the
 *      merged /merchants + /merchant_balances profile.
 * Both are re-checked in refreshProfile() after every Firebase auth state
 * change, via the single onAuthStateChanged listener below — login(),
 * register(), and loginWithGoogle() only ever trigger the Firebase call;
 * they never touch backend state directly, so there is one consistent
 * place to reason about post-auth sync regardless of which method the
 * user signed in with.
 */
export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [userDoc, setUserDoc] = useState(null);
  const [needsRegistration, setNeedsRegistration] = useState(false);
  const [merchantProfile, setMerchantProfile] = useState(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) return;

    let session = await apiFetch('/auth/session');
    if (session.needsRegistration) {
      // POST /api/auth/register needs no body fields — uid/email come
      // exclusively from the verified token (Step 12) — and is idempotent,
      // so it's safe to call automatically here, covering both a fresh
      // email/password sign-up and a first-time Google popup uniformly.
      session = await apiFetch('/auth/register', { method: 'POST' });
    }
    setUserDoc(session);
    setNeedsRegistration(false);

    const profile = await apiFetch('/merchants/me');
    if (profile.needsOnboarding) {
      setNeedsOnboarding(true);
      setMerchantProfile(null);
    } else {
      setNeedsOnboarding(false);
      setMerchantProfile(profile);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthError(null);

      if (!user) {
        setUserDoc(null);
        setMerchantProfile(null);
        setNeedsRegistration(false);
        setNeedsOnboarding(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        await refreshProfile();
      } catch (err) {
        setAuthError(err.message || 'Failed to load account profile.');
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, [refreshProfile]);

  const login = useCallback(async (email, password) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const loginWithGoogle = useCallback(async () => {
    await signInWithPopup(auth, googleProvider);
  }, []);

  const register = useCallback(async (email, password) => {
    await createUserWithEmailAndPassword(auth, email, password);
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  const value = {
    firebaseUser,
    userDoc,
    needsRegistration,
    merchantProfile,
    needsOnboarding,
    loading,
    authError,
    login,
    loginWithGoogle,
    register,
    logout,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
