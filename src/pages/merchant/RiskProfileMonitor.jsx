import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFirestoreDoc } from '../../hooks/useFirestoreDoc.js';
import { apiFetch } from '../../services/apiClient.js';
import { toDate } from '../../utils/firestoreTime.js';
import GlassCard from '../../components/common/GlassCard.jsx';
import StatusBadge from '../../components/common/StatusBadge.jsx';

// Reference tables mirror CLAUDE.md invariant #9 and its reference tables
// EXACTLY — this is the same additive, capped-0-100 scoring model
// riskEngine.js implements, shown here for merchant transparency, not a
// second definition of the rules.
const TIER_TABLE = [
  { tier: 'LOW', range: '0–30', liquidPercent: 95, reservePercent: 5, hold: 'T+3 days' },
  { tier: 'MEDIUM', range: '31–65', liquidPercent: 85, reservePercent: 15, hold: 'T+5 days' },
  { tier: 'HIGH', range: '66–100', liquidPercent: 70, reservePercent: 30, hold: 'T+7 days' },
];
const INDUSTRY_WEIGHTS = [
  { industry: 'GROCERY', weight: 0 },
  { industry: 'ELECTRONICS', weight: 15 },
  { industry: 'GAMING', weight: 25 },
  { industry: 'CRYPTO', weight: 40 },
];

export default function RiskProfileMonitor() {
  const { firebaseUser, merchantProfile } = useAuth();
  const merchantId = firebaseUser?.uid;

  // Live so an admin's tier override (Risk Matrix / Tiering Allocation
  // Control, Group 8) reflects here without a manual refresh.
  const { data: merchantDoc } = useFirestoreDoc(merchantId ? `merchants/${merchantId}` : null);

  const [recentScores, setRecentScores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await apiFetch('/transactions?limit=10');
        if (!cancelled) setRecentScores(result.items);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load recent transactions.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentTier = merchantDoc?.currentRiskTier ?? merchantProfile?.currentRiskTier;
  const tierOverride = merchantDoc?.tierOverride ?? null;
  const effectiveTier = tierOverride ?? currentTier;
  // Set once at onboarding from industry vector alone (no card-level signal
  // exists yet at that point) — capture transactions compute their OWN
  // per-transaction riskScoreCalculated (shown in "Recent scoring activity"
  // below), but that value is never written back onto this field, so it
  // stays a fixed baseline, not a running live total. Shown honestly as
  // such rather than implying it updates per-transaction.
  const baselineScore = merchantDoc?.accumulatedRiskPoints ?? merchantProfile?.accumulatedRiskPoints;
  const industryVector = merchantDoc?.industryVector ?? merchantProfile?.industryVector;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Risk Profile Monitor</h1>
        <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
          Your current risk tier, the scoring inputs behind it, and recent transaction-level scores.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <GlassCard tint={effectiveTier === 'HIGH' ? 'alert' : effectiveTier === 'MEDIUM' ? 'reserve' : 'liquid'}>
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Effective tier</p>
          <div className="mt-2 flex items-center gap-2">
            {effectiveTier ? <StatusBadge value={effectiveTier} /> : <span className="text-sm">—</span>}
            {tierOverride && <span className="text-xs text-accent-reserve">(admin override)</span>}
          </div>
        </GlassCard>
        <GlassCard>
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Onboarding baseline score</p>
          <p className="mt-2 text-lg font-semibold">{baselineScore ?? '—'} / 100</p>
        </GlassCard>
        <GlassCard>
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Industry vector</p>
          <p className="mt-2 text-lg font-semibold">{industryVector ?? '—'}</p>
        </GlassCard>
      </div>

      <GlassCard>
        <h2 className="mb-3 text-base font-semibold">Tier → reserve split → hold duration</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="border-b border-border-token-light text-xs uppercase text-ink-muted-light dark:border-border-token-dark dark:text-ink-muted-dark">
                <th className="py-2">Tier</th>
                <th className="py-2">Score range</th>
                <th className="py-2 text-right">Liquid %</th>
                <th className="py-2 text-right">Reserve %</th>
                <th className="py-2 text-right">Hold duration</th>
              </tr>
            </thead>
            <tbody>
              {TIER_TABLE.map((row) => (
                <tr
                  key={row.tier}
                  className={`border-b border-border-token-light/50 dark:border-border-token-dark/50 ${
                    row.tier === effectiveTier ? 'bg-accent-liquid/5' : ''
                  }`}
                >
                  <td className="py-2"><StatusBadge value={row.tier} /></td>
                  <td className="py-2">{row.range}</td>
                  <td className="py-2 text-right">{row.liquidPercent}%</td>
                  <td className="py-2 text-right">{row.reservePercent}%</td>
                  <td className="py-2 text-right">{row.hold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <GlassCard>
        <h2 className="mb-3 text-base font-semibold">Industry weight (your vector: {industryVector ?? '—'})</h2>
        <div className="flex flex-wrap gap-3">
          {INDUSTRY_WEIGHTS.map((row) => (
            <span
              key={row.industry}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                row.industry === industryVector
                  ? 'bg-accent-liquid/15 text-accent-liquid ring-1 ring-inset ring-accent-liquid/30'
                  : 'bg-black/5 text-ink-secondary-light dark:bg-white/5 dark:text-ink-secondary-dark'
              }`}
            >
              {row.industry} +{row.weight}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-muted-light dark:text-ink-muted-dark">
          Plus geographic (mismatch +20, high-risk region +15, additive) and velocity (+35 if a card is reused more
          than 3 times within 60 seconds) — all additive, capped at 100.
        </p>
      </GlassCard>

      <GlassCard>
        <h2 className="mb-3 text-base font-semibold">Recent scoring activity</h2>
        {error && <p className="text-sm text-accent-alert">{error}</p>}
        {!error && !loading && recentScores.length === 0 && (
          <p className="py-6 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark">
            No transactions yet — capture one in the Transaction Sandbox to see per-transaction scoring here.
          </p>
        )}
        {!error && (loading || recentScores.length > 0) && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-border-token-light text-xs uppercase text-ink-muted-light dark:border-border-token-dark dark:text-ink-muted-dark">
                  <th className="py-2">Date</th>
                  <th className="py-2">Transaction</th>
                  <th className="py-2 text-right">Score</th>
                  <th className="py-2 text-right">Tier</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <tr key={`skel-${i}`}>
                        <td colSpan={4} className="py-2">
                          <div className="h-4 w-full animate-pulse rounded bg-black/5 dark:bg-white/10" />
                        </td>
                      </tr>
                    ))
                  : recentScores.map((t) => (
                      <tr key={t.transactionId} className="border-b border-border-token-light/50 dark:border-border-token-dark/50">
                        <td className="py-2">{toDate(t.timestamp)?.toLocaleString() ?? '—'}</td>
                        <td className="py-2 font-mono text-xs">{t.transactionId}</td>
                        <td className="py-2 text-right">{t.riskScoreCalculated ?? '—'}</td>
                        <td className="py-2 text-right">
                          {t.effectiveTier ? <StatusBadge value={t.effectiveTier} /> : '—'}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
