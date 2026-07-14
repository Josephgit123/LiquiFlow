import { AnimatePresence, motion } from 'framer-motion';

// Shared modal shell — backdrop fade + panel scale/rise, closes on backdrop
// click. Reused by every confirmation/quick-action dialog going forward
// (QuickTicketDialog now; Refund Hub, Chargeback Simulator, Settlement
// Engine confirmations later) rather than each page building its own.
export default function Modal({ open, onClose, title, children }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-border-token-light bg-surface-light p-6 text-ink-primary-light shadow-xl dark:border-border-token-dark dark:bg-surface-dark dark:text-ink-primary-dark"
            role="dialog"
            aria-modal="true"
          >
            {title && <h2 className="mb-4 text-base font-semibold">{title}</h2>}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
