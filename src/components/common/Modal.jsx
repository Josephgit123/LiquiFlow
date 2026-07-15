import { useEffect, useId, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Shared modal shell — backdrop fade + panel scale/rise, closes on backdrop
// click. Reused by every confirmation/quick-action dialog (QuickTicketDialog,
// Refund Hub's confirm dialog, Support Desk's create-ticket dialog, and
// Settlement Ledger's inspect modal).
//
// Previously had none of: Escape-to-close, a focus trap, initial focus
// moved into the dialog, focus restored to the trigger on close, an
// aria-labelledby link to the title, or a background-scroll lock — every
// one of those is a real gap for a keyboard/screen-reader user, not
// cosmetic, so all five are handled here once rather than per-caller.
export default function Modal({ open, onClose, title, children }) {
  const panelRef = useRef(null);
  const titleId = useId();
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the first focusable control, falling back to the panel itself
    // (e.g. a confirmation dialog that's all static text + a footer button
    // still has one, but this guards the rare all-static-content case).
    const focusables = panelRef.current?.querySelectorAll(FOCUSABLE_SELECTOR);
    (focusables?.[0] || panelRef.current)?.focus();

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        onClose?.();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;

      const nodes = Array.from(panelRef.current.querySelectorAll(FOCUSABLE_SELECTOR));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-border-token-light bg-surface-light p-6 text-ink-primary-light shadow-xl outline-none dark:border-border-token-dark dark:bg-surface-dark dark:text-ink-primary-dark"
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
          >
            {title && (
              <h2 id={titleId} className="mb-4 text-base font-semibold">
                {title}
              </h2>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
