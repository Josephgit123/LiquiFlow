import { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { apiFetch } from '../../services/apiClient.js';

// Shared by Dashboard's "Capital Extraction" and Reserve Vault's "Request
// Early Administrative Review" buttons — both route to a real support
// ticket (POST /api/tickets, Step 14) rather than a backend feature that
// doesn't exist yet, per the confirmed plan. Note the REAL ticket schema
// has no "category" field (subject/priority/description only) — the
// specific request type lives in the subject line and description, not an
// invented category field.
export default function QuickTicketDialog({ open, onClose, subject, defaultDescription, onSubmitted }) {
  const [description, setDescription] = useState(defaultDescription);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setDescription(defaultDescription);
      setError(null);
    }
  }, [open, defaultDescription]);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/tickets', {
        method: 'POST',
        body: { subject, priority: 'MEDIUM', description },
      });
      onSubmitted?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={subject}>
      <p className="mb-3 text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
        This opens a support ticket for our team to review — add any extra context below.
      </p>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={4}
        className="w-full rounded-lg border border-border-token-light bg-surface-light px-3 py-2 text-sm outline-none focus:border-accent-liquid dark:border-border-token-dark dark:bg-surface-dark"
      />
      {error && <p className="mt-2 text-sm text-accent-alert">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="rounded-lg border border-border-token-light px-4 py-2 text-sm font-medium transition hover:bg-surface-light-elevated disabled:opacity-50 dark:border-border-token-dark dark:hover:bg-surface-dark-elevated"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-lg bg-accent-liquid px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : 'Submit Request'}
        </button>
      </div>
    </Modal>
  );
}
