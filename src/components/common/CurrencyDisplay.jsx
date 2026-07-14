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

function formatCurrency(value, currency) {
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
  const isNegative = numericValue < 0;

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

  return (
    <span
      className={`font-medium tabular-nums ${
        isNegative ? 'text-accent-alert' : 'text-ink-primary-light dark:text-ink-primary-dark'
      } ${className}`}
    >
      {formatCurrency(animate ? displayValue : numericValue, currency)}
    </span>
  );
}
