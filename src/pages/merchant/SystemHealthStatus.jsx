import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/apiClient.js';
import GlassCard from '../../components/common/GlassCard.jsx';

const POLL_INTERVAL_MS = 15000;

// The real GET /api/health (healthRoutes.js) returns only
// { status, service, timestamp } — a simple liveness probe, not a
// per-dependency breakdown (Firestore, scheduler, etc.). This page shows
// exactly that, polled on an interval, rather than inventing sub-service
// rows the backend doesn't report.
export default function SystemHealthStatus() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(true);
  const [lastCheckedAt, setLastCheckedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      setChecking(true);
      try {
        const result = await apiFetch('/health');
        if (!cancelled) {
          setHealth(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setHealth(null);
          setError(err.message || 'Health check failed.');
        }
      } finally {
        if (!cancelled) {
          setChecking(false);
          setLastCheckedAt(new Date());
        }
      }
    }

    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const isHealthy = health?.status === 'OK';

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">System Health Status</h1>
        <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
          Live backend liveness check, polled every {POLL_INTERVAL_MS / 1000} seconds.
        </p>
      </div>

      <GlassCard tint={error ? 'alert' : isHealthy ? 'liquid' : 'reserve'} className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className={`h-3 w-3 shrink-0 rounded-full ${
            error ? 'bg-accent-alert' : isHealthy ? 'bg-accent-liquid' : 'bg-accent-reserve'
          } ${checking ? 'animate-pulse' : ''}`}
        />
        <div aria-live="polite">
          <p className="text-base font-semibold">
            {error ? 'Unreachable' : isHealthy ? 'Operational' : 'Checking…'}
          </p>
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
            {error ? error : health?.service ? `Service: ${health.service}` : 'Awaiting first response…'}
          </p>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="mb-3 text-base font-semibold">Last response</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-ink-muted-light dark:text-ink-muted-dark">Status</dt>
          <dd className="font-mono">{health?.status ?? '—'}</dd>
          <dt className="text-ink-muted-light dark:text-ink-muted-dark">Service</dt>
          <dd className="font-mono">{health?.service ?? '—'}</dd>
          <dt className="text-ink-muted-light dark:text-ink-muted-dark">Server timestamp</dt>
          <dd className="font-mono">{health?.timestamp ?? '—'}</dd>
          <dt className="text-ink-muted-light dark:text-ink-muted-dark">Last checked (local)</dt>
          <dd className="font-mono">{lastCheckedAt ? lastCheckedAt.toLocaleTimeString() : '—'}</dd>
        </dl>
      </GlassCard>
    </div>
  );
}
