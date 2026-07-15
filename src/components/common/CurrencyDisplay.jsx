import { useEffect, useState } from 'react';
import { useMotionValue, useSpring } from 'framer-motion';

// The ONLY place money is formatted in this app — every page must import
// this rather than calling .toFixed(2) or building a "$" string itself
// (CONTRIBUTING.md's two-decimal rule; grepped for in the Part 5
// integration pass). Negative values (from a chargeback clawback pushing
// availableLiquid negative — CLAUDE.md invariant #6, a real, expected
// state) get a visually distinct red treatment, not just a minus sign, so
// the UI never looks broken or crashes on a negative balance.
const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', INR: '₹' };

// Exported so non-JSX contexts (e.g. a ticket description string sent to
// the backend) can reuse the exact same formatting rather than a second
// ad hoc `.toFixed(2)` — CoreCommandDashboard's Capital Extraction ticket
// body previously did the latter (Groups 1-5 audit), rendering large
// balances as "400000.00" with no thousands separator, unlike everywhere
// else in the app.
export function formatCurrency(value, currency) {
  // Every real field this renders is always-present, server-computed data
  // (settlementService.js guarantees platformFeeDeduction etc. on every
  // write) — this guard is for the case that never should happen rather
  // than one that does, but "$NaN" is a worse failure mode than a plain
  // dash for a financial UI, so it's cheap insurance either way.
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  const sign = value < 0 ? '-' : '';
  // toLocaleString with fixed min/max fraction digits gives both the
  // exactly-2-decimals guarantee and thousands separators in one step —
  // a bare .toFixed(2) reads badly at the amounts this app deals in
  // (e.g. "400000.00" vs "400,000.00").
  const magnitude = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${symbol}${magnitude}`;
}

/**
 * `animate` (default true) ticks the displayed value toward a new prop
 * value via a spring rather than snapping — used for live balance updates
 * (Dashboard, Vault). Set animate={false} inside dense tables (Settlement
 * Ledger rows, Audit Logs) where many independent springs would be wasted
 * motion for a value that isn't live.
 */
export default function CurrencyDisplay({ value, currency = 'USD', animate = true, className = '' }) {
  const numericValue = typeof value === 'number' ? value : Number(value);

  const motionValue = useMotionValue(numericValue);
  const spring = useSpring(motionValue, { stiffness: 120, damping: 20 });
  const [displayValue, setDisplayValue] = useState(numericValue);

  useEffect(() => {
    if (animate) {
      motionValue.set(numericValue);
    } else {
      setDisplayValue(numericValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericValue, animate]);

  useEffect(() => {
    if (!animate) return undefined;
    return spring.on('change', (latest) => setDisplayValue(latest));
  }, [spring, animate]);

  // Derived from whatever value is actually ON SCREEN, not the animation's
  // target — using `numericValue` here instead would flip the color the
  // instant a new (e.g. positive) target is set, while the spring is still
  // mid-transition through negative territory, producing a color that
  // contradicts the digits still visibly counting through zero.
  const shownValue = animate ? displayValue : numericValue;
  const isNegative = shownValue < 0;

  return (
    <span
      className={`font-medium tabular-nums ${
        isNegative ? 'text-accent-alert' : 'text-ink-primary-light dark:text-ink-primary-dark'
      } ${className}`}
    >
      {formatCurrency(shownValue, currency)}
    </span>
  );
}
