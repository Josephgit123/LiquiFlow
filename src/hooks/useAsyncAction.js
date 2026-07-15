import { useCallback, useState } from 'react';

/**
 * Wraps a single "submitting/error" async action — the try/catch/finally
 * shape previously hand-duplicated across nearly every submit handler
 * (QuickTicketDialog, RefundLifecycleHub's confirm action, SupportDesk's
 * create-ticket/reply, LinkedFundingSettings' save, etc).
 *
 * `run` swallows the error internally (setting `error`) and resolves to
 * `undefined` on failure rather than rethrowing — callers branch on the
 * return value for the success path instead of needing their own try/catch:
 *
 *   const { submitting, error, run } = useAsyncAction();
 *   async function handleSave() {
 *     const result = await run(() => apiFetch('/thing', { method: 'POST' }));
 *     if (result) onSaved();
 *   }
 */
export function useAsyncAction() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async (fn, { fallbackMessage = 'Something went wrong. Please try again.' } = {}) => {
    setSubmitting(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err.message || fallbackMessage);
      return undefined;
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { submitting, error, setError, run };
}
