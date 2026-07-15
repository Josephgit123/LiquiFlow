import { motion } from 'framer-motion';

// Shared by Login and Registration — a single Google-provider popup
// button, not two separate implementations (Master Specification Section
// 5's "Google Authentication" is a button embedded in both cards, not a
// distinct route).
export default function GoogleAuthButton({ onClick, disabled, label = 'Continue with Google' }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.01 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-border-token-light bg-surface-light px-4 py-2.5 text-sm font-medium text-ink-primary-light transition hover:bg-surface-light-elevated disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-light dark:border-border-token-dark dark:bg-surface-dark dark:text-ink-primary-dark dark:hover:bg-surface-dark-elevated dark:focus-visible:ring-offset-surface-dark"
    >
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path
          fill="#FFC107"
          d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.5 29.6 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.3-3.5z"
        />
        <path
          fill="#FF3D00"
          d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.5 29.6 4.5 24 4.5c-7.7 0-14.4 4.4-17.7 10.2z"
        />
        <path
          fill="#4CAF50"
          d="M24 43.5c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.4C29.6 34.7 26.9 35.7 24 35.7c-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.6 39.1 16.3 43.5 24 43.5z"
        />
        <path
          fill="#1976D2"
          d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.6 5.4C41.7 36.2 43.5 30.6 43.5 24c0-1.2-.1-2.4-.3-3.5z"
        />
      </svg>
      {label}
    </motion.button>
  );
}
