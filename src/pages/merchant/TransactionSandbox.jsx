import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch, ApiError } from '../../services/apiClient.js';
import GlassCard from '../../components/common/GlassCard.jsx';
import CurrencyDisplay from '../../components/common/CurrencyDisplay.jsx';
import StatusBadge from '../../components/common/StatusBadge.jsx';
import Input from '../../components/common/Input.jsx';
import Button from '../../components/common/Button.jsx';

// Mirrors backend/src/config/highRiskRegions.js EXACTLY, for display only —
// this page never scores anything itself, it just helps explain the real
// server response below. That backend file itself flags this list as an
// illustrative placeholder, not a vetted compliance list; shown here with
// the same caveat rather than silently presenting it as authoritative.
const HIGH_RISK_REGIONS = ['NG', 'RU', 'KP', 'IR'];

function randomToken(prefix) {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

export default function TransactionSandbox() {
  const { merchantProfile } = useAuth();
  const currency = merchantProfile?.currency || 'USD';

  const [amountGross, setAmountGross] = useState('100.00');
  const [cardFingerprint, setCardFingerprint] = useState(() => randomToken('tok'));
  const [cardIssuerCountry, setCardIssuerCountry] = useState('US');
  const [ipCountry, setIpCountry] = useState('US');
  const [submitting, setSubmitting] = useState(false);
  const [log, setLog] = useState([]);

  const geoMismatch = cardIssuerCountry.toUpperCase() !== ipCountry.toUpperCase();
  const touchesHighRisk = useMemo(
    () => HIGH_RISK_REGIONS.includes(cardIssuerCountry.toUpperCase()) || HIGH_RISK_REGIONS.includes(ipCountry.toUpperCase()),
    [cardIssuerCountry, ipCountry]
  );

  async function submitCapture(idempotencyKey, overrides = {}) {
    const amount = Number(overrides.amountGross ?? amountGross);
    const payload = {
      amountGross: amount,
      cardFingerprint: overrides.cardFingerprint ?? cardFingerprint,
      cardIssuerCountry: (overrides.cardIssuerCountry ?? cardIssuerCountry).toUpperCase(),
      ipCountry: (overrides.ipCountry ?? ipCountry).toUpperCase(),
      idempotencyKey,
    };

    setSubmitting(true);
    const startedAt = new Date();
    try {
      const response = await apiFetch('/transactions/capture', { method: 'POST', body: payload });
      setLog((prev) => [{ id: idempotencyKey + startedAt.getTime(), at: startedAt, payload, response, error: null }, ...prev]);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : err.message || 'Capture failed.';
      setLog((prev) => [{ id: idempotencyKey + startedAt.getTime(), at: startedAt, payload, response: null, error: message }, ...prev]);
    } finally {
      setSubmitting(false);
    }
  }

  function handleCapture() {
    submitCapture(crypto.randomUUID());
  }

  function handleResend(entry) {
    // Reuses the ORIGINAL idempotencyKey — the point of this button is to
    // let the sandbox demonstrate wasIdempotentReplay: true coming back
    // from the real settlement service, not to create a second transaction.
    submitCapture(entry.payload.idempotencyKey, entry.payload);
  }

  function handleRegenerateToken() {
    setCardFingerprint(randomToken('tok'));
  }

  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[1fr_1.3fr]">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold">Transaction Sandbox</h1>
          <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
            Simulate inbound post-authorization capture events against the real risk engine and settlement
            pipeline — clearly test/mock data, never a real card.
          </p>
        </div>

        <GlassCard className="flex flex-col gap-4">
          <Input
            label={`Amount gross (${currency})`}
            type="number"
            min="0.01"
            step="0.01"
            value={amountGross}
            onChange={(e) => setAmountGross(e.target.value)}
          />

          <div>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Card fingerprint (mock salted token)</span>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={cardFingerprint}
                  onChange={(e) => setCardFingerprint(e.target.value)}
                  className="flex-1 font-mono text-xs"
                />
                <Button variant="secondary" size="sm" onClick={handleRegenerateToken}>
                  Regenerate
                </Button>
              </div>
            </label>
            <span className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
              Resubmit the same fingerprint 4+ times within 60s to trigger the velocity flag (+35).
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Card issuer country"
              type="text"
              maxLength={2}
              value={cardIssuerCountry}
              onChange={(e) => setCardIssuerCountry(e.target.value.toUpperCase())}
              className="uppercase"
            />
            <Input
              label="IP country"
              type="text"
              maxLength={2}
              value={ipCountry}
              onChange={(e) => setIpCountry(e.target.value.toUpperCase())}
              className="uppercase"
            />
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full px-2.5 py-1 ${geoMismatch ? 'bg-accent-reserve/15 text-accent-onlight-reserve dark:text-accent-reserve' : 'bg-black/5 text-ink-muted-light dark:bg-white/5 dark:text-ink-muted-dark'}`}>
              Geo mismatch: {geoMismatch ? 'yes (+20)' : 'no'}
            </span>
            <span className={`rounded-full px-2.5 py-1 ${touchesHighRisk ? 'bg-accent-alert/15 text-accent-onlight-alert dark:text-accent-alert' : 'bg-black/5 text-ink-muted-light dark:bg-white/5 dark:text-ink-muted-dark'}`}>
              High-risk region (illustrative list): {touchesHighRisk ? 'yes (+15)' : 'no'}
            </span>
          </div>
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
            Preview only — the authoritative score comes back in the response on the right. Industry weight is
            fixed by your account's industry vector ({merchantProfile?.industryVector ?? '—'}).
          </p>

          <Button onClick={handleCapture} disabled={submitting} loading={submitting}>
            Capture Transaction
          </Button>
        </GlassCard>
      </div>

      <div className="flex max-h-[calc(100vh-8rem)] flex-col gap-3 overflow-y-auto">
        <h2 className="text-base font-semibold">Log stream</h2>
        {log.length === 0 && (
          <GlassCard>
            <p className="py-8 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark">
              Capture a transaction to see the full risk score breakdown and split result here.
            </p>
          </GlassCard>
        )}
        {log.map((entry) => (
          <GlassCard key={entry.id} tint={entry.error ? 'alert' : 'liquid'} className="!p-4 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
                {entry.at.toLocaleTimeString()}
              </span>
              {entry.response?.wasIdempotentReplay && (
                <span className="rounded-full bg-accent-reserve/15 px-2 py-0.5 text-xs text-accent-reserve">
                  Idempotent replay
                </span>
              )}
            </div>

            {entry.error && (
              <p role="alert" className="text-accent-alert">
                {entry.error}
              </p>
            )}

            {entry.response && (
              <>
                <div className="mb-3 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Risk score</p>
                    <p className="text-lg font-semibold">{entry.response.riskScoreCalculated} / 100</p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Effective tier</p>
                    <div className="flex items-center gap-2">
                      <StatusBadge value={entry.response.effectiveTier} />
                      {entry.response.wasOverridden && (
                        <span className="text-xs text-accent-reserve">(admin override)</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mb-3 grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Liquid split</p>
                    <CurrencyDisplay value={entry.response.splitLiquidAmount} currency={currency} animate={false} />
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Reserve split</p>
                    <CurrencyDisplay value={entry.response.splitReserveAmount} currency={currency} animate={false} />
                  </div>
                  <div>
                    <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Platform fee</p>
                    <CurrencyDisplay value={entry.response.platformFeeDeduction} currency={currency} animate={false} />
                  </div>
                </div>
                <p className="mb-2 font-mono text-xs text-ink-muted-light dark:text-ink-muted-dark">
                  {entry.response.transactionId}
                </p>
                <button
                  type="button"
                  onClick={() => handleResend(entry)}
                  disabled={submitting}
                  className="rounded text-xs font-medium text-accent-liquid hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50 disabled:opacity-50"
                >
                  Resend (same idempotency key)
                </button>
              </>
            )}
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
