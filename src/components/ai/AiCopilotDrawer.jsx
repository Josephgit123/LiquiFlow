import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { apiFetch, adminApiFetch } from '../../services/apiClient.js';
import Button from '../common/Button.jsx';
import Input from '../common/Input.jsx';

// Available on both merchant and admin shells (confirmed scope — the
// build brief originally scoped this to merchant-only "unless confirmed
// otherwise," and it now has been). `role` picks the auth path — never
// shares a request path between the two (CLAUDE.md invariant #7): a
// merchant call carries a Firebase ID token via apiFetch, an admin call
// carries the admin JWT via adminApiFetch, and the backend scopes the
// context payload (own balance/transactions vs. platform analytics)
// accordingly server-side — this component never assembles or sends any
// financial context itself, only the conversation text.
export default function AiCopilotDrawer({ role }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // {role: 'user'|'model', content}
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  const fetchFn = role === 'ADMIN' ? adminApiFetch : apiFetch;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    const nextHistory = [...messages, { role: 'user', content: text }];
    setMessages(nextHistory);
    setInput('');
    setSending(true);
    try {
      const result = await fetchFn('/ai/copilot', {
        method: 'POST',
        body: { message: text, history: messages },
      });
      setMessages((prev) => [...prev, { role: 'model', content: result.reply }]);
    } catch (err) {
      setError(err.message || 'The AI Copilot is unavailable right now.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label="Open AI Copilot"
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent-liquid text-ink-primary-light shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50 focus-visible:ring-offset-2"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3a7 7 0 00-7 7c0 2.4 1.2 4.5 3 5.8V19a1 1 0 001 1h6a1 1 0 001-1v-3.2c1.8-1.3 3-3.4 3-5.8a7 7 0 00-7-7z"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path d="M10 21h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-40 bg-black/40 sm:bg-transparent"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              role="dialog"
              aria-modal="true"
              aria-label="AI Copilot"
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border-token-light bg-surface-light shadow-2xl dark:border-border-token-dark dark:bg-surface-dark"
            >
              <div className="flex items-center justify-between border-b border-border-token-light px-5 py-4 dark:border-border-token-dark">
                <div>
                  <h2 className="text-base font-semibold">AI Copilot</h2>
                  <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
                    Grounded in your {role === 'ADMIN' ? 'platform-wide' : 'account'} data
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close AI Copilot"
                  className="rounded-lg p-1.5 text-ink-secondary-light hover:bg-surface-light-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50 dark:text-ink-secondary-dark dark:hover:bg-surface-dark-elevated"
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
                {messages.length === 0 && (
                  <p className="py-8 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark">
                    Ask about your {role === 'ADMIN' ? "platform's" : 'account'} current state — balances, recent
                    activity, or how LiquiFlow's risk/reserve mechanics work.
                  </p>
                )}
                <div className="flex flex-col gap-3">
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                        m.role === 'user'
                          ? 'self-end bg-accent-liquid/15 text-ink-primary-light dark:text-ink-primary-dark'
                          : 'self-start bg-surface-light-elevated text-ink-primary-light dark:bg-surface-dark-elevated dark:text-ink-primary-dark'
                      }`}
                    >
                      {m.content}
                    </div>
                  ))}
                  {sending && (
                    <div className="self-start rounded-xl bg-surface-light-elevated px-3 py-2 text-sm text-ink-muted-light dark:bg-surface-dark-elevated dark:text-ink-muted-dark">
                      <span className="inline-flex gap-1">
                        <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}>●</motion.span>
                        <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.2 }}>●</motion.span>
                        <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: 0.4 }}>●</motion.span>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {error && (
                <p role="alert" className="px-5 pb-2 text-sm text-accent-alert">
                  {error}
                </p>
              )}

              <div className="flex gap-2 border-t border-border-token-light p-4 dark:border-border-token-dark">
                <Input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Ask the AI Copilot…"
                  aria-label="Message the AI Copilot"
                  className="flex-1"
                />
                <Button onClick={handleSend} disabled={sending || !input.trim()} loading={sending}>
                  Send
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
