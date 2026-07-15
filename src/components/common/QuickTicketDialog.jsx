import { useEffect, useId, useState } from 'react';
import Modal from './Modal.jsx';
import Button from './Button.jsx';
import { apiFetch } from '../../services/apiClient.js';
import { useAsyncAction } from '../../hooks/useAsyncAction.js';

// Shared by Dashboard's "Capital Extraction" and Reserve Vault's "Request
// Early Administrative Review" buttons — both route to a real support
// ticket (POST /api/tickets, Step 14) rather than a backend feature that
// doesn't exist yet, per the confirmed plan. Note the REAL ticket schema
// has no "category" field (subject/priority/description only) — the
// specific request type lives in the subject line and description, not an
// invented category field.
export default function QuickTicketDialog({ open, onClose, subject, defaultDescription, onSubmitted }) {
  const [description, setDescription] = useState(defaultDescription);
  const { submitting, error, setError, run } = useAsyncAction();
  const textareaId = useId();

  useEffect(() => {
    if (open) {
      setDescription(defaultDescription);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDescription]);

  async function handleSubmit() {
    const result = await run(() =>
      apiFetch('/tickets', { method: 'POST', body: { subject, priority: 'MEDIUM', description } })
    );
    if (result) {
      onSubmitted?.();
      onClose();
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={subject}>
      <p className="mb-3 text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
        This opens a support ticket for our team to review — add any extra context below.
      </p>
      <label htmlFor={textareaId} className="sr-only">
        Additional context for this request
      </label>
      <textarea
        id={textareaId}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={4}
        className="w-full rounded-lg border border-border-token-light bg-surface-light px-3 py-2 text-sm outline-none transition focus:border-accent-liquid focus-visible:ring-2 focus-visible:ring-accent-liquid/30 dark:border-border-token-dark dark:bg-surface-dark"
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-accent-alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={submitting || !description.trim()} loading={submitting}>
          Submit Request
        </Button>
      </div>
    </Modal>
  );
}
