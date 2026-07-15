import { motion } from 'framer-motion';

// Border tint communicates what a card represents, using ONLY the three
// spec'd accent tokens (Master Specification Section 19) — never an
// invented color. e.g. a reserve vault capsule gets tint="reserve" (amber
// border), an available-liquid stat block gets tint="liquid", a
// dispute/chargeback card gets tint="alert". Default 'neutral' is a plain
// low-opacity border with no accent meaning.
const TINT_BORDER = {
  neutral: 'border-black/10 dark:border-white/10',
  reserve: 'border-accent-reserve/30',
  liquid: 'border-accent-liquid/30',
  alert: 'border-accent-alert/30',
};

// `interactive` adds a hover lift + tap-press — opt-in, since most GlassCard
// uses so far are static stat tiles that shouldn't wobble on hover; only
// pass it for cards that are themselves a click target.
// `delay` staggers entrance in a grid (e.g. 4 dashboard tiles, a row of
// vault capsules) instead of every card fading in in perfect unison.
// `inView` switches entrance from "animate on mount" to "animate once
// scrolled into view" (LandingPage's below-the-fold cards) — done as a
// dedicated flag rather than letting a caller pass raw whileInView/
// viewport/initial props through, since those would collide with (and be
// silently overridden by) this component's own hardcoded initial/animate.
export default function GlassCard({
  children,
  className = '',
  tint = 'neutral',
  interactive = false,
  delay = 0,
  inView = false,
  ...rest
}) {
  const revealProps = inView
    ? { whileInView: { opacity: 1, y: 0 }, viewport: { once: true, amount: 0.3 } }
    : { animate: { opacity: 1, y: 0 } };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      {...revealProps}
      transition={{ duration: 0.25, ease: 'easeOut', delay }}
      whileHover={interactive ? { y: -3, boxShadow: '0 12px 24px -8px rgba(0,0,0,0.18)' } : undefined}
      whileTap={interactive ? { y: 0, scale: 0.99 } : undefined}
      className={`rounded-2xl border ${TINT_BORDER[tint] ?? TINT_BORDER.neutral} bg-surface-light/60 backdrop-blur-md dark:bg-surface-dark/60 p-6 shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
