import { useMemo, useState } from 'react';
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

export default function MerchantRegister() {
  const { register, loginWithGoogle, authError } = useAuth();
  useAuthRedirect();

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
      // See MerchantLogin.jsx for why this has no navigate() call and why
      // `finally` (not just `catch`) clears `submitting`.
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
        <Input
          label="Email"
          id="reg-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />

        <div>
          <Input
            label="Password"
            id="reg-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
          />

          <ul className="mt-2 flex flex-col gap-1 text-xs" aria-live="polite">
            <li className={strength.length ? 'text-accent-liquid' : 'text-ink-muted-light dark:text-ink-muted-dark'}>
              {strength.length ? '✓' : '○'} At least 8 characters
            </li>
            <li className={strength.uppercase ? 'text-accent-liquid' : 'text-ink-muted-light dark:text-ink-muted-dark'}>
              {strength.uppercase ? '✓' : '○'} Contains an uppercase letter (recommended)
            </li>
            <li className={strength.digit ? 'text-accent-liquid' : 'text-ink-muted-light dark:text-ink-muted-dark'}>
              {strength.digit ? '✓' : '○'} Contains a digit (recommended)
            </li>
          </ul>
        </div>

        {displayError && (
          <p role="alert" className="text-sm text-accent-alert">
            {displayError}
          </p>
        )}

        <Button type="submit" disabled={submitting} loading={submitting} className="w-full">
          Create Account
        </Button>
      </form>

      <AuthDivider />

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
