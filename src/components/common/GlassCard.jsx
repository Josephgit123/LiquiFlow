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

export default function GlassCard({ children, className = '', tint = 'neutral', ...rest }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`rounded-2xl border ${TINT_BORDER[tint] ?? TINT_BORDER.neutral} bg-surface-light/60 backdrop-blur-md dark:bg-surface-dark/60 p-6 shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
