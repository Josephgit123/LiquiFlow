import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useTheme } from '../../context/ThemeContext.jsx';
import { adminApiFetch } from '../../services/apiClient.js';
import { tokens } from '../../styles/tokens.js';
import GlassCard from '../../components/common/GlassCard.jsx';
import CurrencyDisplay from '../../components/common/CurrencyDisplay.jsx';
import Button from '../../components/common/Button.jsx';
import Skeleton from '../../components/common/Skeleton.jsx';

const TIER_COLOR = { LOW: tokens.accent.liquid, MEDIUM: tokens.accent.reserve, HIGH: tokens.accent.alert };

// GET /api/admin/analytics aggregates across every merchant's currency
// (computeAdminAnalytics sums raw amountGross regardless of /merchant_
// balances.currency) — there's no single correct currency for a mixed-
// tenant total, so this renders the sums in USD as an illustrative
// cross-tenant figure, the same simplification the backend itself already
// makes rather than a new one introduced here.
export default function GlobalSystemsMaster() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await adminApiFetch('/admin/analytics');
        if (!cancelled) setAnalytics(result);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load platform analytics.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const riskData = analytics
    ? Object.entries(analytics.riskScoreDistribution)
        .filter(([, count]) => count > 0)
        .map(([tier, count]) => ({ tier, count }))
    : [];
  const industryData = analytics
    ? Object.entries(analytics.merchantsByIndustry).map(([industry, count]) => ({ industry, count }))
    : [];

  const gridColor = isDark ? tokens.border.dark : tokens.border.light;
  const tickColor = isDark ? tokens.text.mutedDark : tokens.text.mutedLight;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Global Systems Master</h1>
          <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
            Platform-wide overview across all merchants and subsystems.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled
            title="Not backed by a real endpoint yet — flagged during Group 7, not silently invented."
          >
            Trigger System Maintenance Check
          </Button>
          <Button
            variant="secondary"
            disabled
            title="Not backed by a real endpoint yet — flagged during Group 7, not silently invented."
          >
            Export Platform Condition Reports
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-accent-alert">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <GlassCard tint="liquid" delay={0}>
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Total volume (all merchants)</p>
          <div className="mt-2 text-lg font-semibold">
            {loading ? <Skeleton width="6rem" height="1.5rem" /> : <CurrencyDisplay value={analytics?.totalVolume ?? 0} />}
          </div>
        </GlassCard>
        <GlassCard tint="reserve" delay={0.05}>
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Total reserve locked</p>
          <div className="mt-2 text-lg font-semibold">
            {loading ? <Skeleton width="6rem" height="1.5rem" /> : <CurrencyDisplay value={analytics?.totalReserveLocked ?? 0} />}
          </div>
        </GlassCard>
        <GlassCard delay={0.1}>
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Total transactions</p>
          <p className="mt-2 text-lg font-semibold">
            {loading ? <Skeleton width="3rem" height="1.5rem" /> : analytics?.totalTransactions ?? 0}
          </p>
        </GlassCard>
        <GlassCard delay={0.15}>
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Total merchants</p>
          <p className="mt-2 text-lg font-semibold">
            {loading ? <Skeleton width="3rem" height="1.5rem" /> : analytics?.totalMerchants ?? 0}
          </p>
        </GlassCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <GlassCard>
          <h2 className="mb-4 text-base font-semibold">Risk score distribution (all transactions)</h2>
          {!loading && riskData.length === 0 ? (
            <p className="py-16 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark">No transaction data yet.</p>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={riskData} dataKey="count" nameKey="tier" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {riskData.map((entry) => (
                      <Cell key={entry.tier} fill={TIER_COLOR[entry.tier]} />
                    ))}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 12, color: tickColor }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: isDark ? tokens.surface.dark : tokens.surface.light, border: `1px solid ${gridColor}`, borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: isDark ? tokens.text.primaryDark : tokens.text.primaryLight }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </GlassCard>

        <GlassCard>
          <h2 className="mb-4 text-base font-semibold">Merchants by industry</h2>
          {!loading && industryData.length === 0 ? (
            <p className="py-16 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark">No merchants yet.</p>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={industryData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid stroke={gridColor} vertical={false} />
                  <XAxis dataKey="industry" stroke={tickColor} tick={{ fill: tickColor, fontSize: 12 }} tickLine={false} axisLine={{ stroke: gridColor }} />
                  <YAxis stroke={tickColor} tick={{ fill: tickColor, fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: isDark ? tokens.surface.dark : tokens.surface.light, border: `1px solid ${gridColor}`, borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: isDark ? tokens.text.primaryDark : tokens.text.primaryLight }}
                  />
                  <Bar dataKey="count" name="Merchants" fill={tokens.accent.liquid} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
