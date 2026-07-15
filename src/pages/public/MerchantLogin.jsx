import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAuthRedirect } from '../../hooks/useAuthRedirect.js';
import { getFirebaseAuthErrorMessage } from '../../utils/firebaseAuthErrors.js';
import Input from '../../components/common/Input.jsx';
import Button from '../../components/common/Button.jsx';
import GoogleAuthButton from '../../components/common/GoogleAuthButton.jsx';
import AuthDivider from '../../components/common/AuthDivider.jsx';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export default function MerchantLogin() {
  const { login, loginWithGoogle, authError } = useAuth();
  useAuthRedirect();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

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
      // No navigate() here — useAuthRedirect fires once AuthContext
      // resolves needsOnboarding/merchantProfile. `finally` below always
      // clears `submitting` regardless of whether that resolves quickly,
      // slowly, or fails (previously ONLY cleared on a thrown error, so a
      // successful Firebase sign-in followed by a failed backend sync left
      // the button stuck on "Signing in…" forever with no visible error).
    } catch (err) {
      setSubmitError(getFirebaseAuthErrorMessage(err));
    } finally {
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
    } finally {
      setSubmitting(false);
    }
  }

  const displayError = submitError || authError;

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
        <Input
          label="Email"
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />
        <Input
          label="Password"
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
        />

        {displayError && (
          <p role="alert" className="text-sm text-accent-alert">
            {displayError}
          </p>
        )}

        <Button type="submit" disabled={submitting} loading={submitting} className="w-full">
          Sign In
        </Button>
      </form>

      <AuthDivider />

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
