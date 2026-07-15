import { useState } from 'react';
import { apiFetch } from '../../services/apiClient.js';
import GlassCard from '../../components/common/GlassCard.jsx';
import Input from '../../components/common/Input.jsx';
import Button from '../../components/common/Button.jsx';

const WEBHOOK_EVENTS = ['transaction.captured', 'transaction.refunded', 'vault.capsule_matured', 'chargeback.received'];

// Neither half of this page has a real backend behind it yet:
//  - webhookRoutes.js's GET/POST /api/webhooks both return a 202 stub
//    ("not yet implemented") with no Firestore write at all.
//  - There is no API key generation/storage service anywhere in
//    backend/src — grepped for, not assumed.
// Built as a clearly-flagged coming-soon shell (same pattern as the Risk
// Engine Configurator's live-scoring warning) rather than either hiding
// the page or pretending a 202 response means the registration was saved.
export default function ApiKeysWebhooks() {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  function toggleEvent(event) {
    setSelectedEvents((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]));
  }

  async function handleRegister() {
    setError(null);
    setResult(null);
    if (!webhookUrl.trim()) {
      setError('Enter a webhook URL.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch('/webhooks', {
        method: 'POST',
        body: { url: webhookUrl.trim(), events: selectedEvents },
      });
      setResult(response?.message || 'Request accepted.');
    } catch (err) {
      setError(err.message || 'Request failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">API Keys &amp; Webhooks</h1>
        <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
          Manage API credentials and webhook subscriptions.
        </p>
      </div>

      <GlassCard tint="reserve" className="flex items-start gap-3">
        <span className="mt-0.5 text-lg" aria-hidden="true">⚠️</span>
        <div>
          <p className="text-sm font-semibold text-accent-onlight-reserve dark:text-accent-reserve">Not yet live</p>
          <p className="mt-1 text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
            API key issuance and webhook subscriptions are scaffolded but not yet persisted server-side. The form
            below will accept a submission and the request will succeed at the network level, but nothing is stored
            — subscriptions will not actually fire and no key shown here is real. Treat this page as a preview of
            the intended UI, not a live feature.
          </p>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="mb-1 text-base font-semibold">API Keys</h2>
        <p className="mb-4 text-xs text-ink-muted-light dark:text-ink-muted-dark">
          Key generation is not implemented yet — no key-management service exists in the backend.
        </p>
        <Button variant="secondary" disabled>
          Generate New Key
        </Button>
      </GlassCard>

      <GlassCard>
        <h2 className="mb-4 text-base font-semibold">Webhook Subscriptions</h2>
        <Input
          label="Endpoint URL"
          type="text"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://your-server.example.com/webhooks/liquiflow"
          className="mb-4 w-full"
        />

        <p className="mb-2 text-sm font-medium">Events</p>
        <div className="mb-4 flex flex-wrap gap-2">
          {WEBHOOK_EVENTS.map((event) => (
            <button
              key={event}
              type="button"
              onClick={() => toggleEvent(event)}
              aria-pressed={selectedEvents.includes(event)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50 ${
                selectedEvents.includes(event)
                  ? 'bg-accent-liquid/15 text-accent-onlight-liquid ring-1 ring-inset ring-accent-liquid/30 dark:text-accent-liquid'
                  : 'bg-black/5 text-ink-secondary-light hover:bg-black/10 dark:bg-white/5 dark:text-ink-secondary-dark dark:hover:bg-white/10'
              }`}
            >
              {event}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="mb-2 text-sm text-accent-alert">
            {error}
          </p>
        )}
        {result && (
          <p role="status" className="mb-2 text-sm text-accent-onlight-reserve dark:text-accent-reserve">
            {result} (not persisted — see notice above)
          </p>
        )}

        <Button onClick={handleRegister} disabled={submitting} loading={submitting}>
          Register Webhook
        </Button>
      </GlassCard>
    </div>
  );
}
