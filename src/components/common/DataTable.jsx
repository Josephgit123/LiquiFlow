import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Generic data table shared by Settlement Ledger, Transactions, Refund
 * Queue, Audit Logs, and Merchant Manager.
 *
 * Pagination is SERVER-SIDE (per API_DOCUMENTATION.md's convention) —
 * every real list endpoint in this backend (Steps 13-15) returns
 * { items, limit, offset, hasMore }, never a total count, so this exposes
 * Previous/Next controls driving onPageChange(nextOffset) rather than a
 * numbered page picker.
 *
 * `sortable` columns sort CLIENT-SIDE only, re-ordering the current page's
 * already-loaded rows — none of the real backend list endpoints accept a
 * sort query param, so this is never a request for different server
 * ordering, just a local re-sort of what's already on screen.
 *
 * columns: [{ key, label, render?: (row) => node, sortable?: boolean, align?: 'left'|'right' }]
 */
function defaultRowKey(row, index) {
  return (
    row.id ?? row.transactionId ?? row.ticketId ?? row.merchantId ?? row.logId ?? row.notificationId ??
    // Falls back to the row's own content rather than its array index —
    // an index-based key breaks after a client-side sort reorders rows,
    // since AnimatePresence then associates the wrong exit/enter motion
    // with whatever row now occupies a given position.
    JSON.stringify(row) ??
    index
  );
}

// Null-safe, type-aware compare — the previous version returned `-1` for
// ANY undefined/mixed-type pair (since `av > bv` and `av < bv` are both
// false when either is undefined), silently mis-sorting nullable or
// string-numeric columns. Nulls always sort last, regardless of direction.
function compareValues(av, bv) {
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  if (typeof av === 'number' && typeof bv === 'number') return av - bv;
  return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
}

export default function DataTable({
  columns,
  rows,
  loading = false,
  emptyMessage = 'No results.',
  limit,
  offset,
  hasMore,
  onPageChange,
  getRowKey = defaultRowKey,
}) {
  const [sort, setSort] = useState({ key: null, direction: 'asc' });

  const sortedRows = useMemo(() => {
    if (!sort.key) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const result = compareValues(a[sort.key], b[sort.key]);
      return sort.direction === 'asc' ? result : -result;
    });
    return copy;
  }, [rows, sort]);

  function toggleSort(key) {
    setSort((prev) => {
      if (prev.key !== key) return { key, direction: 'asc' };
      return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
    });
  }

  const showPagination = typeof onPageChange === 'function' && limit != null && offset != null;
  // Sized off `limit` (capped to a sane range) instead of always exactly
  // 5 — a skeleton for a 20-per-page table shouldn't visibly shrink when
  // real rows land.
  const skeletonCount = Math.min(Math.max(limit || 5, 3), 10);

  return (
    <div className="overflow-hidden rounded-2xl border border-black/10 dark:border-white/10">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-surface-light-elevated dark:bg-surface-dark-elevated">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    col.sortable && sort.key === col.key
                      ? sort.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  className={`text-xs font-semibold uppercase tracking-wide text-ink-secondary-light dark:text-ink-secondary-dark ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  } ${col.sortable ? '' : 'px-4 py-3'}`}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="flex w-full items-center gap-1 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50 focus-visible:ring-inset"
                    >
                      {col.label}
                      {sort.key === col.key && <span aria-hidden="true">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {loading ? (
                Array.from({ length: skeletonCount }).map((_, i) => (
                  <tr key={`skeleton-${i}`} className="border-t border-black/5 dark:border-white/5">
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3">
                        <div className="h-4 w-full animate-pulse rounded bg-black/5 dark:bg-white/10" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : sortedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-8 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                sortedRows.map((row, index) => (
                  <motion.tr
                    key={getRowKey(row, index)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2 }}
                    className="border-t border-black/5 transition-colors hover:bg-accent-liquid/[0.04] dark:border-white/5 dark:hover:bg-accent-liquid/[0.06]"
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-4 py-3 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                      >
                        {col.render ? col.render(row) : row[col.key]}
                      </td>
                    ))}
                  </motion.tr>
                ))
              )}
            </AnimatePresence>
          </tbody>
        </table>
      </div>

      {showPagination && (
        <div className="flex items-center justify-between border-t border-black/10 px-4 py-3 text-sm dark:border-white/10">
          <span className="text-ink-muted-light dark:text-ink-muted-dark">
            {rows.length === 0 ? 'Showing 0–0' : `Showing ${offset + 1}–${offset + rows.length}`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0 || loading}
              onClick={() => onPageChange(Math.max(0, offset - limit))}
              className="rounded-lg border border-black/10 px-3 py-1.5 transition disabled:opacity-40 dark:border-white/10"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!hasMore || loading}
              onClick={() => onPageChange(offset + limit)}
              className="rounded-lg border border-black/10 px-3 py-1.5 transition disabled:opacity-40 dark:border-white/10"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
