import { statusColor } from '../../styles/tokens.js';

// ONE badge implementation for every enum in the app (transaction status,
// ticket status, account status, risk tier) — color-mapped via
// statusColor in tokens.js, never a per-page ad hoc badge. Unknown values
// render as neutral rather than throwing, since this badge is often fed
// directly from API response fields.
//
// Text color splits per theme: the raw accent-500 anchor (`text-accent-*`)
// validates at only ~2.1-3.1:1 against this chip's light tint in LIGHT
// mode — failing WCAG AA — so light mode uses the darker 700-weight
// `accent-onlight-*` shade instead; dark mode keeps the original anchor,
// which already passes against the dark-tinted chip background.
const VARIANT_CLASSES = {
  liquid: 'bg-accent-liquid/15 text-accent-onlight-liquid ring-1 ring-inset ring-accent-liquid/30 dark:text-accent-liquid',
  reserve: 'bg-accent-reserve/15 text-accent-onlight-reserve ring-1 ring-inset ring-accent-reserve/30 dark:text-accent-reserve',
  alert: 'bg-accent-alert/15 text-accent-onlight-alert ring-1 ring-inset ring-accent-alert/30 dark:text-accent-alert',
  neutral: 'bg-black/5 text-ink-secondary-light ring-1 ring-inset ring-black/10 dark:bg-white/5 dark:text-ink-secondary-dark dark:ring-white/10',
};

export default function StatusBadge({ value, className = '' }) {
  const variant = statusColor[value] || 'neutral';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {value}
    </span>
  );
}
