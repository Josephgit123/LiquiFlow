import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { tokens } from '../../styles/tokens.js';
import { toMillis as toEpochMs } from '../../utils/firestoreTime.js';

const TICK_MS = 1000; // spec allows 100ms-1s; 1s is plenty for second-resolution display without wasted re-renders

function formatRemaining(ms) {
  if (ms <= 0) return 'Matured';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}

// Screen readers spell "3d 04h" as literal letters, not "days/hours" — a
// separate full-word label, used as aria-label rather than the visible
// abbreviated text.
function formatRemainingLong(ms) {
  if (ms <= 0) return 'Matured';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days} day${days === 1 ? '' : 's'}, ${hours} hour${hours === 1 ? '' : 's'} remaining`;
  if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'}, ${minutes} minute${minutes === 1 ? '' : 's'} remaining`;
  return `${minutes} minute${minutes === 1 ? '' : 's'} remaining`;
}

/**
 * Built from absolute epoch-ms timestamps ONLY (CLAUDE.md invariant #8) —
 * `releaseDate` is the capsule's absolute maturity boundary. Every tick
 * recomputes `releaseDate - Date.now()` fresh; it never decrements a
 * client-held counter, which would drift on tab sleep/throttling or a
 * system clock change.
 *
 * `createdAt`, if provided, additionally renders the animated SVG
 * maturity-progress ring (% elapsed of the hold duration) described in
 * the Reserve Vault page spec — one component covers both the spec's
 * "CountdownTimer" and "maturity-progress ring" mentions rather than two
 * redundant ones.
 */
export default function CountdownTimer({ releaseDate, createdAt, size = 96, className = '' }) {
  const releaseMs = toEpochMs(releaseDate);
  const [now, setNow] = useState(() => Date.now());

  const remainingMsForEffect = releaseMs - now;
  useEffect(() => {
    // Stops ticking once matured — an already-released capsule has no
    // reason to keep re-rendering every second forever (this component is
    // mounted once per capsule in a grid, so an idle interval per matured
    // capsule adds up).
    if (remainingMsForEffect <= 0) return undefined;
    const interval = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMsForEffect <= 0]);

  const remainingMs = releaseMs - now;
  const isMatured = remainingMs <= 0;
  const tickColor = isMatured ? tokens.accent.liquid : tokens.accent.reserve;

  if (createdAt == null) {
    return (
      <span
        className={`tabular-nums text-sm font-medium ${className}`}
        style={{ color: tickColor }}
        aria-label={formatRemainingLong(remainingMs)}
      >
        {formatRemaining(remainingMs)}
      </span>
    );
  }

  const createdMs = toEpochMs(createdAt);
  const totalDuration = releaseMs - createdMs;
  const elapsed = now - createdMs;
  const percentElapsed = totalDuration > 0 ? Math.min(100, Math.max(0, (elapsed / totalDuration) * 100)) : 100;

  const radius = size / 2 - 6;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={formatRemainingLong(remainingMs)}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth="6"
          className="stroke-border-token-light dark:stroke-border-token-dark"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          stroke={tickColor}
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: circumference - (percentElapsed / 100) * circumference }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-2 text-center" aria-hidden="true">
        <span className="text-xs font-semibold tabular-nums" style={{ color: tickColor }}>
          {isMatured ? 'Matured' : formatRemaining(remainingMs)}
        </span>
      </div>
    </div>
  );
}
