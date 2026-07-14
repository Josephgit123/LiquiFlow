import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { apiFetch } from '../../services/apiClient.js';
import { toDate } from '../../utils/firestoreTime.js';
import { downloadCsv } from '../../utils/exportData.js';
import GlassCard from '../../components/common/GlassCard.jsx';
import DataTable from '../../components/common/DataTable.jsx';
import CurrencyDisplay from '../../components/common/CurrencyDisplay.jsx';
import StatusBadge from '../../components/common/StatusBadge.jsx';
import Modal from '../../components/common/Modal.jsx';
import DetailRow from '../../components/common/DetailRow.jsx';

// Merges the spec's separate "Settlement Ledger" and "Transactions" pages
// into this one page (Group 1 navConfig reconciliation, confirmed) —
// covers both: receiptHash/CSV export (Settlement Ledger) and the
// date/status/risk filter strip + inspect detail (Transactions).
const MAX_DATE_SPAN_DAYS = 90;
const PAGE_SIZE = 20;
const VALID_STATUSES = ['CAPTURED', 'REFUNDED', 'DISPUTED'];

function ReceiptHashCell({ hash }) {
  const [copied, setCopied] = useState(false);
  const truncated = hash ? `${hash.slice(0, 10)}…` : '—';

  async function handleCopy() {
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable in this context — a copy nicety failing
      // silently isn't worth surfacing as an error.
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs">{truncated}</span>
      {hash && (
        <button type="button" onClick={handleCopy} className="text-xs text-accent-liquid hover:underline">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      )}
    </div>
  );
}


export default function SettlementLedger() {
  const { merchantProfile } = useAuth();
  const currency = merchantProfile?.currency || 'USD';

  const [filters, setFilters] = useState({ status: '', dateFrom: '', dateTo: '', riskMin: '', riskMax: '' });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [filterError, setFilterError] = useState(null);

  const [items, setItems] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inspecting, setInspecting] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (appliedFilters.status) params.set('status', appliedFilters.status);
        if (appliedFilters.dateFrom) params.set('dateFrom', appliedFilters.dateFrom);
        if (appliedFilters.dateTo) params.set('dateTo', appliedFilters.dateTo);
        if (appliedFilters.riskMin !== '') params.set('riskMin', appliedFilters.riskMin);
        if (appliedFilters.riskMax !== '') params.set('riskMax', appliedFilters.riskMax);
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', String(offset));

        const result = await apiFetch(`/transactions?${params.toString()}`);
        if (!cancelled) {
          setItems(result.items);
          setHasMore(result.hasMore);
        }
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
  }, [appliedFilters, offset]);

  function handleApplyFilters() {
    // 90-day max span — enforced client-side before the request goes out,
    // not just hoping the backend rejects it gracefully (Part 3).
    if (filters.dateFrom && filters.dateTo) {
      const spanDays = (new Date(filters.dateTo).getTime() - new Date(filters.dateFrom).getTime()) / 86400000;
      if (spanDays < 0) {
        setFilterError('The "From" date must be before the "To" date.');
        return;
      }
      if (spanDays > MAX_DATE_SPAN_DAYS) {
        setFilterError(`Date range cannot exceed ${MAX_DATE_SPAN_DAYS} days.`);
        return;
      }
    }
    if (filters.riskMin !== '' && filters.riskMax !== '' && Number(filters.riskMin) > Number(filters.riskMax)) {
      setFilterError('Risk min must not exceed risk max.');
      return;
    }
    setFilterError(null);
    setOffset(0);
    setAppliedFilters(filters);
  }

  function handleExportCsv() {
    downloadCsv(
      `liquiflow-settlement-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { key: 'transactionId', label: 'Transaction ID' },
        { key: 'timestamp', label: 'Date' },
        { key: 'amountGross', label: 'Amount' },
        { key: 'riskScoreCalculated', label: 'Risk Score' },
        { key: 'status', label: 'Status' },
        { key: 'splitLiquidAmount', label: 'Liquid' },
        { key: 'splitReserveAmount', label: 'Reserve' },
        { key: 'receiptHash', label: 'Receipt Hash' },
      ],
      items.map((t) => ({ ...t, timestamp: toDate(t.timestamp)?.toISOString() ?? '' }))
    );
  }

  const columns = [
    {
      key: 'timestamp',
      label: 'Date',
      render: (row) => {
        const d = toDate(row.timestamp);
        return d ? d.toLocaleDateString() : '—';
      },
    },
    {
      key: 'transactionId',
      label: 'Transaction ID',
      render: (row) => <span className="font-mono text-xs">{row.transactionId}</span>,
    },
    {
      key: 'amountGross',
      label: 'Amount',
      align: 'right',
      render: (row) => <CurrencyDisplay value={row.amountGross} currency={currency} animate={false} />,
    },
    { key: 'riskScoreCalculated', label: 'Risk', align: 'right' },
    { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    { key: 'receiptHash', label: 'Receipt', render: (row) => <ReceiptHashCell hash={row.receiptHash} /> },
    {
      key: 'inspect',
      label: '',
      align: 'right',
      render: (row) => (
        <button
          type="button"
          onClick={() => setInspecting(row)}
          className="text-xs font-medium text-accent-liquid hover:underline"
        >
          Inspect
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Settlement Ledger</h1>
          <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
            Full transaction history — filter, inspect, and export.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          className="rounded-lg border border-border-token-light px-4 py-2 text-sm font-medium transition hover:bg-surface-light-elevated dark:border-border-token-dark dark:hover:bg-surface-dark-elevated"
        >
          Export CSV
        </button>
      </div>

      {/* Filter strip — one row, above the table, scoping everything below it. */}
      <GlassCard>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary-light dark:text-ink-secondary-dark">
              From
            </label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
              className="rounded-lg border border-border-token-light bg-surface-light px-3 py-1.5 text-sm dark:border-border-token-dark dark:bg-surface-dark"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary-light dark:text-ink-secondary-dark">
              To
            </label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
              className="rounded-lg border border-border-token-light bg-surface-light px-3 py-1.5 text-sm dark:border-border-token-dark dark:bg-surface-dark"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary-light dark:text-ink-secondary-dark">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              className="rounded-lg border border-border-token-light bg-surface-light px-3 py-1.5 text-sm dark:border-border-token-dark dark:bg-surface-dark"
            >
              <option value="">All</option>
              {VALID_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary-light dark:text-ink-secondary-dark">
              Risk min
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={filters.riskMin}
              onChange={(e) => setFilters((f) => ({ ...f, riskMin: e.target.value }))}
              className="w-20 rounded-lg border border-border-token-light bg-surface-light px-3 py-1.5 text-sm dark:border-border-token-dark dark:bg-surface-dark"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary-light dark:text-ink-secondary-dark">
              Risk max
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={filters.riskMax}
              onChange={(e) => setFilters((f) => ({ ...f, riskMax: e.target.value }))}
              className="w-20 rounded-lg border border-border-token-light bg-surface-light px-3 py-1.5 text-sm dark:border-border-token-dark dark:bg-surface-dark"
            />
          </div>
          <button
            type="button"
            onClick={handleApplyFilters}
            className="rounded-lg bg-accent-liquid px-4 py-1.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Apply Filters
          </button>
        </div>
        {filterError && <p className="mt-2 text-sm text-accent-alert">{filterError}</p>}
      </GlassCard>

      {error && <p className="text-sm text-accent-alert">{error}</p>}

      <DataTable
        columns={columns}
        rows={items}
        loading={loading}
        emptyMessage="No transactions match these filters."
        limit={PAGE_SIZE}
        offset={offset}
        hasMore={hasMore}
        onPageChange={setOffset}
      />

      <Modal open={Boolean(inspecting)} onClose={() => setInspecting(null)} title="Transaction Detail">
        {inspecting && (
          <div className="flex flex-col gap-3 text-sm">
            <DetailRow label="Transaction ID" value={inspecting.transactionId} mono />
            <DetailRow label="Date" value={toDate(inspecting.timestamp)?.toLocaleString() ?? '—'} />
            <DetailRow label="Status" value={<StatusBadge value={inspecting.status} />} />
            <DetailRow
              label="Amount (gross)"
              value={<CurrencyDisplay value={inspecting.amountGross} currency={currency} animate={false} />}
            />
            <DetailRow label="Risk score" value={inspecting.riskScoreCalculated} />
            <DetailRow
              label="Liquid split"
              value={<CurrencyDisplay value={inspecting.splitLiquidAmount} currency={currency} animate={false} />}
            />
            <DetailRow
              label="Reserve split"
              value={<CurrencyDisplay value={inspecting.splitReserveAmount} currency={currency} animate={false} />}
            />
            <DetailRow
              label="Platform fee"
              value={<CurrencyDisplay value={inspecting.platformFeeDeduction} currency={currency} animate={false} />}
            />
            <DetailRow label="Receipt hash" value={<span className="font-mono text-xs">{inspecting.receiptHash}</span>} />
          </div>
        )}
      </Modal>
    </div>
  );
}
