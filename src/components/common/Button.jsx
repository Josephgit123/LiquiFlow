import { motion } from 'framer-motion';

// ONE button implementation for the whole app — replaces ~25 hand-rolled,
// near-identical className strings across pages (grepped for during the
// Groups 1-6 UI audit). Every variant below is built from the same three
// accent tokens (tokens.js) already in use elsewhere; nothing new invented.
//
// Adds three things that were missing everywhere: a visible focus-visible
// ring (keyboard-nav users previously had no indication which control was
// focused), a `loading` state that swaps in a spinner without changing the
// button's width (so the layout doesn't jump when a submit starts), and
// WCAG-AA-passing text on solid accent backgrounds — white text on
// accent-liquid/alert validates at only ~2.4:1 / ~3.8:1 (both fail 4.5:1);
// `ink-primary-light` (the app's darkest neutral) validates at ~7.4:1 /
// ~4.7:1 against those same backgrounds and is used unconditionally
// (not swapped per app theme) since the button's own background is
// always the vivid accent color regardless of light/dark mode.
const VARIANT_CLASSES = {
  primary:
    'bg-accent-liquid text-ink-primary-light hover:brightness-110 focus-visible:ring-accent-liquid/50',
  secondary:
    'border border-border-token-light bg-transparent hover:bg-surface-light-elevated dark:border-border-token-dark dark:hover:bg-surface-dark-elevated focus-visible:ring-accent-liquid/50',
  destructive:
    'bg-accent-alert text-ink-primary-light hover:brightness-110 focus-visible:ring-accent-alert/50',
  ghost:
    'bg-transparent hover:bg-surface-light-elevated dark:hover:bg-surface-dark-elevated focus-visible:ring-accent-liquid/50',
};

const SIZE_CLASSES = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm',
};

function Spinner({ className = '' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const isDisabled = disabled || loading;

  return (
    <motion.button
      type={type}
      disabled={isDisabled}
      whileHover={isDisabled ? undefined : { scale: 1.02 }}
      whileTap={isDisabled ? undefined : { scale: 0.98 }}
      transition={{ duration: 0.12 }}
      className={`relative inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-light dark:focus-visible:ring-offset-surface-dark ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      <span className={loading ? 'invisible' : 'inline-flex items-center gap-1.5'}>{children}</span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner className="h-4 w-4" />
        </span>
      )}
    </motion.button>
  );
}
