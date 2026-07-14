import { statusColor } from '../../styles/tokens.js';

// ONE badge implementation for every enum in the app (transaction status,
// ticket status, account status, risk tier) — color-mapped via
// statusColor in tokens.js, never a per-page ad hoc badge. Unknown values
// render as neutral rather than throwing, since this badge is often fed
// directly from API response fields.
const VARIANT_CLASSES = {
  liquid: 'bg-accent-liquid/15 text-accent-liquid ring-1 ring-inset ring-accent-liquid/30',
  reserve: 'bg-accent-reserve/15 text-accent-reserve ring-1 ring-inset ring-accent-reserve/30',
  alert: 'bg-accent-alert/15 text-accent-alert ring-1 ring-inset ring-accent-alert/30',
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
