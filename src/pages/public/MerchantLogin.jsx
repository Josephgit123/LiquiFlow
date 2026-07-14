import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext.jsx';
import { getFirebaseAuthErrorMessage } from '../../utils/firebaseAuthErrors.js';
import GoogleAuthButton from '../../components/common/GoogleAuthButton.jsx';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export default function MerchantLogin() {
  const navigate = useNavigate();
  const { login, loginWithGoogle, firebaseUser, loading, needsOnboarding, merchantProfile } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Routes an already-authenticated (or just-authenticated) merchant based
  // on GET /api/auth/session's needsRegistration (handled inside
  // AuthContext automatically) and GET /api/merchants/me's needsOnboarding
  // — two distinct backend checks, both resolved by AuthContext before
  // `loading` goes false.
  useEffect(() => {
    if (loading || !firebaseUser) return;
    if (needsOnboarding) {
      navigate('/merchant/onboarding', { replace: true });
    } else if (merchantProfile) {
      navigate('/merchant/dashboard', { replace: true });
    }
  }, [loading, firebaseUser, needsOnboarding, merchantProfile, navigate]);

  function validate() {
    const errors = {};
    if (!EMAIL_REGEX.test(email)) errors.email = 'Enter a valid email address.';
    if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setSubmitError(getFirebaseAuthErrorMessage(err));
      setSubmitting(false);
    }
  }

  async function handleGoogle() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      setSubmitError(getFirebaseAuthErrorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="flex flex-col gap-6"
    >
      <div>
        <h1 className="text-lg font-semibold">Merchant Login</h1>
        <p className="mt-1 text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
          Sign in to your LiquiFlow workspace.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div>
          <label htmlFor="email" className="mb-1 block text-xs font-medium text-ink-secondary-light dark:text-ink-secondary-dark">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-border-token-light bg-surface-light px-3 py-2 text-sm outline-none focus:border-accent-liquid dark:border-border-token-dark dark:bg-surface-dark"
          />
          {fieldErrors.email && <p className="mt-1 text-xs text-accent-alert">{fieldErrors.email}</p>}
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-xs font-medium text-ink-secondary-light dark:text-ink-secondary-dark">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-border-token-light bg-surface-light px-3 py-2 text-sm outline-none focus:border-accent-liquid dark:border-border-token-dark dark:bg-surface-dark"
          />
          {fieldErrors.password && <p className="mt-1 text-xs text-accent-alert">{fieldErrors.password}</p>}
        </div>

        {submitError && <p className="text-sm text-accent-alert">{submitError}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-accent-liquid px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-ink-muted-light dark:text-ink-muted-dark">
        <div className="h-px flex-1 bg-border-token-light dark:bg-border-token-dark" />
        or
        <div className="h-px flex-1 bg-border-token-light dark:bg-border-token-dark" />
      </div>

      <GoogleAuthButton onClick={handleGoogle} disabled={submitting} />

      <p className="text-center text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
        Don&apos;t have an account?{' '}
        <Link to="/register" className="font-medium text-accent-liquid hover:underline">
          Register
        </Link>
      </p>
    </motion.div>
  );
}
