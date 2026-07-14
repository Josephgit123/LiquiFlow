import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';
import { useFirestoreDoc } from '../../hooks/useFirestoreDoc.js';
import { apiFetch } from '../../services/apiClient.js';
import { downloadCsv } from '../../utils/exportData.js';
import { toMillis } from '../../utils/firestoreTime.js';
import { tokens } from '../../styles/tokens.js';
import GlassCard from '../../components/common/GlassCard.jsx';
import StatusBadge from '../../components/common/StatusBadge.jsx';
import CurrencyDisplay from '../../components/common/CurrencyDisplay.jsx';
import QuickTicketDialog from '../../components/common/QuickTicketDialog.jsx';

function formatDateKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Custom tooltip: "line keys, not boxes" and "values lead, labels follow"
// per the dataviz skill's interaction.md — Recharts' default tooltip
// renders a filled square swatch and puts the series name first; this
// renders a short line-shaped key and leads with the (bold) value.
function ChartTooltip({ active, payload, label, currency, tooltipBg, gridColor, tooltipText, tickColor }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        backgroundColor: tooltipBg,
        border: `1px solid ${gridColor}`,
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12,
      }}
    >
      <p style={{ color: tooltipText, fontWeight: 600, marginBottom: 4 }}>{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span style={{ display: 'inline-block', width: 12, height: 2, backgroundColor: entry.color }} />
          <span style={{ color: tooltipText, fontWeight: 600 }}>
            {currency}{' '}
            {Number(entry.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          <span style={{ color: tickColor }}>{entry.name}</span>
        </div>
      ))}
    </div>
  );
}

export default function CoreCommandDashboard() {
  const { firebaseUser, merchantProfile } = useAuth();
  const { theme } = useTheme();
  const merchantId = firebaseUser?.uid;

  // Live tiles via onSnapshot (Part 2: Dashboard needs real-time updates,
  // not just the one-time GET /api/merchants/me snapshot AuthContext holds).
  const { data: merchantDoc } = useFirestoreDoc(merchantId ? `merchants/${merchantId}` : null);
  const { data: balanceDoc } = useFirestoreDoc(merchantId ? `merchant_balances/${merchantId}` : null);

  const [transactions, setTransactions] = useState([]);
  const [loadingChart, setLoadingChart] = useState(true);
  const [chartError, setChartError] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const [extractionOpen, setExtractionOpen] = useState(false);
  const [requestSubmitted, setRequestSubmitted] = useState(false);

  // Trend chart data source: client-side bucketing of GET /api/transactions
  // (last 100) — confirmed acceptable at this app's demo/portfolio scale,
  // not a live onSnapshot feed (historical trend doesn't need per-second
  // updates the way the balance tiles do).
  useEffect(() => {
    let cancelled = false;
    async function loadTransactions() {
      setLoadingChart(true);
      setChartError(null);
      try {
        const result = await apiFetch('/transactions?limit=100');
        if (!cancelled) setTransactions(result.items);
      } catch (err) {
        if (!cancelled) setChartError(err.message || 'Failed to load transaction trend.');
      } finally {
        if (!cancelled) setLoadingChart(false);
      }
    }
    loadTransactions();
    return () => {
      cancelled = true;
    };
  }, []);

  const chartData = useMemo(() => {
    const byDay = new Map();
    for (const t of transactions) {
      const ms = toMillis(t.timestamp);
      if (ms == null) continue;
      const key = formatDateKey(ms);
      const entry = byDay.get(key) || { date: key, liquid: 0, reserve: 0 };
      entry.liquid += t.splitLiquidAmount || 0;
      entry.reserve += t.splitReserveAmount || 0;
      byDay.set(key, entry);
    }
    return Array.from(byDay.values()).sort((a, b) => (a.date > b.date ? 1 : -1));
  }, [transactions]);

  const currency = balanceDoc?.currency || merchantProfile?.currency || 'USD';
  const availableLiquid = balanceDoc?.availableLiquid ?? 0;
  const lockedEscrow = balanceDoc?.lockedEscrow ?? 0;
  const accountStatus = merchantDoc?.accountStatus ?? merchantProfile?.accountStatus;
  // tierOverride (if set) is the field that actually takes effect in
  // scoring (Step 15) — showing raw currentRiskTier alone would misrepresent
  // an active admin override, so the effective tier prefers it.
  const effectiveTier = merchantDoc?.tierOverride ?? merchantDoc?.currentRiskTier ?? merchantProfile?.currentRiskTier;
  const isOverridden = Boolean(merchantDoc?.tierOverride);

  const isDark = theme === 'dark';
  const gridColor = isDark ? tokens.border.dark : tokens.border.light;
  const tickColor = isDark ? tokens.text.mutedDark : tokens.text.mutedLight;
  const tooltipBg = isDark ? tokens.surface.dark : tokens.surface.light;
  const tooltipText = isDark ? tokens.text.primaryDark : tokens.text.primaryLight;

  const latestDay = chartData[chartData.length - 1];

  function handleExportCsv() {
    downloadCsv(
      `liquiflow-dashboard-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { key: 'date', label: 'Date' },
        { key: 'liquid', label: 'Liquid' },
        { key: 'reserve', label: 'Reserve' },
      ],
      chartData
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-lg font-semibold">Core Command Dashboard</h1>
          <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
            Live liquid pool / reserve vault overview and recent transaction activity.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setExtractionOpen(true)}
            className="rounded-lg border border-border-token-light px-4 py-2 text-sm font-medium transition hover:bg-surface-light-elevated dark:border-border-token-dark dark:hover:bg-surface-dark-elevated"
          >
            Capital Extraction
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="rounded-lg border border-border-token-light px-4 py-2 text-sm font-medium transition hover:bg-surface-light-elevated dark:border-border-token-dark dark:hover:bg-surface-dark-elevated"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg border border-border-token-light px-4 py-2 text-sm font-medium transition hover:bg-surface-light-elevated dark:border-border-token-dark dark:hover:bg-surface-dark-elevated"
          >
            Export PDF
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <GlassCard tint="liquid">
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Available liquid</p>
          <div className="mt-2 text-lg font-semibold">
            <CurrencyDisplay value={availableLiquid} currency={currency} />
          </div>
        </GlassCard>
        <GlassCard tint="reserve">
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Locked in reserve</p>
          <div className="mt-2 text-lg font-semibold">
            <CurrencyDisplay value={lockedEscrow} currency={currency} />
          </div>
        </GlassCard>
        <GlassCard>
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Risk tier</p>
          <div className="mt-2 flex items-center gap-2">
            {effectiveTier ? (
              <StatusBadge value={effectiveTier} />
            ) : (
              <span className="text-sm text-ink-muted-light dark:text-ink-muted-dark">—</span>
            )}
            {isOverridden && <span className="text-xs text-accent-reserve">(admin override)</span>}
          </div>
        </GlassCard>
        <GlassCard>
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Account status</p>
          <div className="mt-2">
            {accountStatus ? (
              <StatusBadge value={accountStatus} />
            ) : (
              <span className="text-sm text-ink-muted-light dark:text-ink-muted-dark">—</span>
            )}
          </div>
        </GlassCard>
      </div>

      <GlassCard>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Daily liquid / reserve trend</h2>
            <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
              Last {transactions.length} transaction{transactions.length === 1 ? '' : 's'}, bucketed by day
            </p>
          </div>
          {latestDay && (
            <div className="flex gap-4 text-right">
              <div>
                <p className="flex items-center justify-end gap-1.5 text-xs text-ink-muted-light dark:text-ink-muted-dark">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: tokens.accent.liquid }} />
                  Latest day · Liquid
                </p>
                <CurrencyDisplay value={latestDay.liquid} currency={currency} animate={false} />
              </div>
              <div>
                <p className="flex items-center justify-end gap-1.5 text-xs text-ink-muted-light dark:text-ink-muted-dark">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: tokens.accent.reserve }} />
                  Latest day · Reserve
                </p>
                <CurrencyDisplay value={latestDay.reserve} currency={currency} animate={false} />
              </div>
            </div>
          )}
        </div>

        {chartError && <p className="text-sm text-accent-alert">{chartError}</p>}

        {!chartError && !loadingChart && chartData.length === 0 && (
          <p className="py-8 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark">
            No transactions yet — capture one in the Transaction Sandbox to see a trend here.
          </p>
        )}

        {!chartError && (loadingChart || chartData.length > 0) && (
          <>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid stroke={gridColor} vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke={tickColor}
                    tick={{ fill: tickColor, fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: gridColor }}
                  />
                  <YAxis
                    stroke={tickColor}
                    tick={{ fill: tickColor, fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => v.toLocaleString('en-US')}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        currency={currency}
                        tooltipBg={tooltipBg}
                        gridColor={gridColor}
                        tooltipText={tooltipText}
                        tickColor={tickColor}
                      />
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: tickColor }} iconType="line" />
                  <Line
                    type="monotone"
                    dataKey="liquid"
                    name="Liquid"
                    stroke={tokens.accent.liquid}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="reserve"
                    name="Reserve"
                    stroke={tokens.accent.reserve}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              className="mt-3 text-xs font-medium text-accent-liquid hover:underline print:hidden"
            >
              {showTable ? 'Hide table view' : 'View as table'}
            </button>

            {showTable && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border-token-light text-xs uppercase text-ink-muted-light dark:border-border-token-dark dark:text-ink-muted-dark">
                      <th className="py-2">Date</th>
                      <th className="py-2 text-right">Liquid</th>
                      <th className="py-2 text-right">Reserve</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((row) => (
                      <tr key={row.date} className="border-b border-border-token-light/50 dark:border-border-token-dark/50">
                        <td className="py-2">{row.date}</td>
                        <td className="py-2 text-right">
                          <CurrencyDisplay value={row.liquid} currency={currency} animate={false} />
                        </td>
                        <td className="py-2 text-right">
                          <CurrencyDisplay value={row.reserve} currency={currency} animate={false} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </GlassCard>

      <QuickTicketDialog
        open={extractionOpen}
        onClose={() => setExtractionOpen(false)}
        subject="Capital Extraction Request"
        defaultDescription={`Requesting a payout of available liquid funds (currently ${currency} ${availableLiquid.toFixed(2)}). Please review and process via the Settlement Engine.`}
        onSubmitted={() => setRequestSubmitted(true)}
      />
      {requestSubmitted && (
        <p className="text-sm text-accent-liquid print:hidden">
          Your capital extraction request has been submitted as a support ticket.
        </p>
      )}
    </div>
  );
}
