import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import { apiFetch } from '../../services/apiClient.js';
import { toDate, toMillis } from '../../utils/firestoreTime.js';
import { tokens } from '../../styles/tokens.js';
import GlassCard from '../../components/common/GlassCard.jsx';
import CurrencyDisplay from '../../components/common/CurrencyDisplay.jsx';

const FORECAST_MIN_TRANSACTIONS = 5;
const TIER_COLOR = { LOW: tokens.accent.liquid, MEDIUM: tokens.accent.reserve, HIGH: tokens.accent.alert };
const STATUS_COLOR = { CAPTURED: tokens.accent.liquid, REFUNDED: tokens.text.mutedLight, DISPUTED: tokens.accent.alert };

function formatDateKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export default function MerchantAnalytics() {
  const { merchantProfile } = useAuth();
  const { theme } = useTheme();
  const currency = merchantProfile?.currency || 'USD';
  const isDark = theme === 'dark';

  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Aggregated entirely client-side from the last 100 transactions — same
  // approach as the Dashboard's trend chart. Flagged, not silently decided:
  // at real transaction volume this should likely become a dedicated
  // backend aggregation endpoint rather than shipping raw rows to the
  // browser for every analytics view.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await apiFetch('/transactions?limit=100');
        if (!cancelled) setTransactions(result.items);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load transactions.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const volumeByDay = useMemo(() => {
    const byDay = new Map();
    for (const t of transactions) {
      const ms = toMillis(t.timestamp);
      if (ms == null) continue;
      const key = formatDateKey(ms);
      const entry = byDay.get(key) || { date: key, count: 0, gross: 0 };
      entry.count += 1;
      entry.gross += t.amountGross || 0;
      byDay.set(key, entry);
    }
    return Array.from(byDay.values()).sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [transactions]);

  const tierBreakdown = useMemo(() => {
    const counts = { LOW: 0, MEDIUM: 0, HIGH: 0 };
    for (const t of transactions) {
      if (t.effectiveTier && counts[t.effectiveTier] !== undefined) counts[t.effectiveTier] += 1;
    }
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([tier, count]) => ({ tier, count }));
  }, [transactions]);

  const statusBreakdown = useMemo(() => {
    const counts = { CAPTURED: 0, REFUNDED: 0, DISPUTED: 0 };
    for (const t of transactions) {
      if (t.status && counts[t.status] !== undefined) counts[t.status] += 1;
    }
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => ({ status, count }));
  }, [transactions]);

  const canForecast = transactions.length >= FORECAST_MIN_TRANSACTIONS;

  const forecast = useMemo(() => {
    if (!canForecast || volumeByDay.length === 0) return null;
    const avgDailyGross = volumeByDay.reduce((sum, d) => sum + d.gross, 0) / volumeByDay.length;
    const lastDate = toMillis(new Date(volumeByDay[volumeByDay.length - 1].date));
    const projected = [];
    for (let i = 1; i <= 7; i += 1) {
      projected.push({
        date: formatDateKey(lastDate + i * 24 * 60 * 60 * 1000),
        gross: Number(avgDailyGross.toFixed(2)),
      });
    }
    return { avgDailyGross, projected };
  }, [canForecast, volumeByDay]);

  const gridColor = isDark ? tokens.border.dark : tokens.border.light;
  const tickColor = isDark ? tokens.text.mutedDark : tokens.text.mutedLight;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Analytics</h1>
        <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
          Volume, risk tier, and status breakdown from your last {transactions.length} transaction
          {transactions.length === 1 ? '' : 's'}.
        </p>
      </div>

      {error && <p className="text-sm text-accent-alert">{error}</p>}

      {!error && !loading && transactions.length === 0 && (
        <GlassCard>
          <p className="py-8 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark">
            No transactions yet — capture one in the Transaction Sandbox to see analytics here.
          </p>
        </GlassCard>
      )}

      {!error && (loading || transactions.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <GlassCard>
            <h2 className="mb-4 text-base font-semibold">Daily transaction volume</h2>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volumeByDay} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid stroke={gridColor} vertical={false} />
                  <XAxis dataKey="date" stroke={tickColor} tick={{ fill: tickColor, fontSize: 12 }} tickLine={false} axisLine={{ stroke: gridColor }} />
                  <YAxis stroke={tickColor} tick={{ fill: tickColor, fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: isDark ? tokens.surface.dark : tokens.surface.light, border: `1px solid ${gridColor}`, borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: isDark ? tokens.text.primaryDark : tokens.text.primaryLight }}
                  />
                  <Bar dataKey="count" name="Transactions" fill={tokens.accent.liquid} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </GlassCard>

          <GlassCard>
            <h2 className="mb-4 text-base font-semibold">Risk tier breakdown</h2>
            {tierBreakdown.length === 0 ? (
              <p className="py-16 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark">No tier data yet.</p>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={tierBreakdown} dataKey="count" nameKey="tier" innerRadius={50} outerRadius={80} paddingAngle={2}>
                      {tierBreakdown.map((entry) => (
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
            <h2 className="mb-4 text-base font-semibold">Status breakdown</h2>
            {statusBreakdown.length === 0 ? (
              <p className="py-16 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark">No status data yet.</p>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusBreakdown} dataKey="count" nameKey="status" innerRadius={50} outerRadius={80} paddingAngle={2}>
                      {statusBreakdown.map((entry) => (
                        <Cell key={entry.status} fill={STATUS_COLOR[entry.status]} />
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

          <GlassCard tint={canForecast ? 'liquid' : 'neutral'}>
            <h2 className="mb-1 text-base font-semibold">7-day volume forecast</h2>
            {!canForecast && (
              <p className="py-16 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark">
                Forecasting unlocks once you have at least {FORECAST_MIN_TRANSACTIONS} transactions (currently{' '}
                {transactions.length}).
              </p>
            )}
            {canForecast && forecast && (
              <>
                <p className="mb-4 text-xs text-ink-muted-light dark:text-ink-muted-dark">
                  Illustrative projection — average daily gross (<CurrencyDisplay value={forecast.avgDailyGross} currency={currency} animate={false} />) held flat over the next 7 days, not a predictive model.
                </p>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={forecast.projected} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                      <CartesianGrid stroke={gridColor} vertical={false} />
                      <XAxis dataKey="date" stroke={tickColor} tick={{ fill: tickColor, fontSize: 12 }} tickLine={false} axisLine={{ stroke: gridColor }} />
                      <YAxis stroke={tickColor} tick={{ fill: tickColor, fontSize: 12 }} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: isDark ? tokens.surface.dark : tokens.surface.light, border: `1px solid ${gridColor}`, borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: isDark ? tokens.text.primaryDark : tokens.text.primaryLight }}
                      />
                      <Line type="monotone" dataKey="gross" name="Projected gross" stroke={tokens.accent.liquid} strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </GlassCard>
        </div>
      )}
    </div>
  );
}
