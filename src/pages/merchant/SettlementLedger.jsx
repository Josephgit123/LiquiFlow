import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useApiList } from '../../hooks/useApiList.js';
import { toDate } from '../../utils/firestoreTime.js';
import { downloadCsv } from '../../utils/exportData.js';
import GlassCard from '../../components/common/GlassCard.jsx';
import DataTable from '../../components/common/DataTable.jsx';
import CurrencyDisplay from '../../components/common/CurrencyDisplay.jsx';
import StatusBadge from '../../components/common/StatusBadge.jsx';
import Modal from '../../components/common/Modal.jsx';
import DetailRow from '../../components/common/DetailRow.jsx';
import Button from '../../components/common/Button.jsx';
import Input from '../../components/common/Input.jsx';

// Merges the spec's separate "Settlement Ledger" and "Transactions" pages
// into this one page (Group 1 navConfig reconciliation, confirmed) —
// covers both: receiptHash/CSV export (Settlement Ledger) and the
// date/status/risk filter strip + inspect detail (Transactions).
const MAX_DATE_SPAN_DAYS = 90;
const PAGE_SIZE = 20;
const VALID_STATUSES = ['CAPTURED', 'REFUNDED', 'DISPUTED'];

// Keeps a risk-score field numerically within [0, 100] as the user types,
// rather than only constraining it via the (non-enforcing, for typed
// input) native min/max attributes — a typed "-5" or "150" previously
// reached handleApplyFilters and the request untouched.
function clampRisk(value) {
  if (value === '') return '';
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return String(Math.min(100, Math.max(0, n)));
}

function ReceiptHashCell({ hash }) {
  const [copyState, setCopyState] = useState('idle'); // idle | copied | failed
  const truncated = hash ? `${hash.slice(0, 10)}…` : '—';

  async function handleCopy() {
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    } finally {
      setTimeout(() => setCopyState('idle'), 1500);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs">{truncated}</span>
      {hash && (
        <button
          type="button"
          onClick={handleCopy}
          className="rounded text-xs text-accent-liquid hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50"
        >
          <span role="status" aria-live="polite">
            {copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
          </span>
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

  const [offset, setOffset] = useState(0);
  const [inspecting, setInspecting] = useState(null);

  const queryPath = useMemo(() => {
    const params = new URLSearchParams();
    if (appliedFilters.status) params.set('status', appliedFilters.status);
    if (appliedFilters.dateFrom) params.set('dateFrom', appliedFilters.dateFrom);
    if (appliedFilters.dateTo) params.set('dateTo', appliedFilters.dateTo);
    if (appliedFilters.riskMin !== '') params.set('riskMin', appliedFilters.riskMin);
    if (appliedFilters.riskMax !== '') params.set('riskMax', appliedFilters.riskMax);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(offset));
    return `/transactions?${params.toString()}`;
  }, [appliedFilters, offset]);

  const { items, hasMore, loading, error } = useApiList(queryPath);

  function handleApplyFilters() {
    // 90-day max span — enforced client-side before the request goes out,
    // not just hoping the backend rejects it gracefully (Part 3). Checked
    // even when only ONE end of the range is set (treating the missing
    // end as "today"), since a lone dateFrom/dateTo is otherwise an
    // unbounded range in the other direction.
    if (filters.dateFrom || filters.dateTo) {
      const today = new Date();
      const from = filters.dateFrom ? new Date(filters.dateFrom) : today;
      const to = filters.dateTo ? new Date(filters.dateTo) : today;
      const spanDays = (to.getTime() - from.getTime()) / 86400000;
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
    // Exports only the currently-loaded page, matching this page's spec'd
    // "CSV export client-side from loaded data" scope — the button is
    // labeled accordingly (below) rather than implying a full filtered
    // export, which would mean fetching every matching row.
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
      sortable: true,
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
      sortable: true,
      render: (row) => <CurrencyDisplay value={row.amountGross} currency={currency} animate={false} />,
    },
    { key: 'riskScoreCalculated', label: 'Risk', align: 'right', sortable: true },
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
          className="rounded text-xs font-medium text-accent-liquid hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50"
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
        <Button variant="secondary" onClick={handleExportCsv} disabled={items.length === 0} title="Exports the currently loaded page">
          Export Page (CSV)
        </Button>
      </div>

      {/* Filter strip — one row, above the table, scoping everything below it. */}
      <GlassCard>
        <div className="flex flex-wrap items-end gap-4">
          <Input
            label="From"
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
          />
          <Input
            label="To"
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
          />
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Status</span>
            <select
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              className="rounded-lg border border-border-token-light bg-surface-light px-3 py-2 text-sm outline-none focus:border-accent-liquid focus-visible:ring-2 focus-visible:ring-accent-liquid/30 dark:border-border-token-dark dark:bg-surface-dark"
            >
              <option value="">All</option>
              {VALID_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <Input
            label="Risk min"
            type="number"
            min="0"
            max="100"
            value={filters.riskMin}
            onChange={(e) => setFilters((f) => ({ ...f, riskMin: clampRisk(e.target.value) }))}
            className="w-20"
          />
          <Input
            label="Risk max"
            type="number"
            min="0"
            max="100"
            value={filters.riskMax}
            onChange={(e) => setFilters((f) => ({ ...f, riskMax: clampRisk(e.target.value) }))}
            className="w-20"
          />
          <Button onClick={handleApplyFilters}>Apply Filters</Button>
        </div>
        {filterError && (
          <p role="alert" className="mt-2 text-sm text-accent-alert">
            {filterError}
          </p>
        )}
      </GlassCard>

      {error && (
        <p role="alert" className="text-sm text-accent-alert">
          {error}
        </p>
      )}

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
