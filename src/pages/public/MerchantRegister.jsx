import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext.jsx';
import { getFirebaseAuthErrorMessage } from '../../utils/firebaseAuthErrors.js';
import GoogleAuthButton from '../../components/common/GoogleAuthButton.jsx';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export default function MerchantRegister() {
  const navigate = useNavigate();
  const { register, loginWithGoogle, firebaseUser, loading, needsOnboarding, merchantProfile } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const strength = useMemo(
    () => ({
      length: password.length >= MIN_PASSWORD_LENGTH,
      uppercase: /[A-Z]/.test(password),
      digit: /[0-9]/.test(password),
    }),
    [password]
  );

  // A brand-new account will always land on needsOnboarding right after
  // sign-up (onboarding hasn't happened yet) — POST /api/auth/register
  // itself is called automatically by AuthContext's onAuthStateChanged
  // listener, not by this page, so this effect is what actually performs
  // the "then routes to Onboarding" step once that resolves.
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
    // Only the 8-char minimum blocks submission — uppercase/digit below
    // are a client-side hint only; Firebase Auth enforces the real rule.
    if (!strength.length) {
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
      await register(email, password);
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
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="flex flex-col gap-6"
    >
      <div>
        <h1 className="text-lg font-semibold">Create Your Account</h1>
        <p className="mt-1 text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
          Firebase-secured sign-up, followed by a short onboarding wizard.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div>
          <label htmlFor="reg-email" className="mb-1 block text-xs font-medium text-ink-secondary-light dark:text-ink-secondary-dark">
            Email
          </label>
          <input
            id="reg-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-border-token-light bg-surface-light px-3 py-2 text-sm outline-none focus:border-accent-liquid dark:border-border-token-dark dark:bg-surface-dark"
          />
          {fieldErrors.email && <p className="mt-1 text-xs text-accent-alert">{fieldErrors.email}</p>}
        </div>

        <div>
          <label htmlFor="reg-password" className="mb-1 block text-xs font-medium text-ink-secondary-light dark:text-ink-secondary-dark">
            Password
          </label>
          <input
            id="reg-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-border-token-light bg-surface-light px-3 py-2 text-sm outline-none focus:border-accent-liquid dark:border-border-token-dark dark:bg-surface-dark"
          />
          {fieldErrors.password && <p className="mt-1 text-xs text-accent-alert">{fieldErrors.password}</p>}

          <ul className="mt-2 flex flex-col gap-1 text-xs">
            <li className={strength.length ? 'text-accent-liquid' : 'text-ink-muted-light dark:text-ink-muted-dark'}>
              {strength.length ? '✓' : '○'} At least 8 characters
            </li>
            <li className={strength.uppercase ? 'text-accent-liquid' : 'text-ink-muted-light dark:text-ink-muted-dark'}>
              {strength.uppercase ? '✓' : '○'} Contains an uppercase letter
            </li>
            <li className={strength.digit ? 'text-accent-liquid' : 'text-ink-muted-light dark:text-ink-muted-dark'}>
              {strength.digit ? '✓' : '○'} Contains a digit
            </li>
          </ul>
        </div>

        {submitError && <p className="text-sm text-accent-alert">{submitError}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-accent-liquid px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {submitting ? 'Creating account…' : 'Create Account'}
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-ink-muted-light dark:text-ink-muted-dark">
        <div className="h-px flex-1 bg-border-token-light dark:bg-border-token-dark" />
        or
        <div className="h-px flex-1 bg-border-token-light dark:bg-border-token-dark" />
      </div>

      <GoogleAuthButton onClick={handleGoogle} disabled={submitting} label="Sign up with Google" />

      <p className="text-center text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-accent-liquid hover:underline">
          Sign In
        </Link>
      </p>
    </motion.div>
  );
}
