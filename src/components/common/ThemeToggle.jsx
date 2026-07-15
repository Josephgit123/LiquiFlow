import { AnimatePresence, motion } from 'framer-motion';
import { useTheme } from '../../context/ThemeContext.jsx';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <motion.button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle color theme"
      whileTap={{ scale: 0.94 }}
      className="inline-flex items-center gap-1.5 rounded-full border border-border-token-light px-3 py-1.5 text-sm text-ink-secondary-light transition hover:bg-surface-light-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-light dark:border-border-token-dark dark:text-ink-secondary-dark dark:hover:bg-surface-dark-elevated dark:focus-visible:ring-offset-surface-dark"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ rotate: -90, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          exit={{ rotate: 90, opacity: 0 }}
          transition={{ duration: 0.2 }}
          aria-hidden="true"
          className="inline-block"
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </motion.span>
      </AnimatePresence>
      {theme === 'light' ? 'Dark' : 'Light'}
    </motion.button>
  );
}
