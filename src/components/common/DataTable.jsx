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
export default function DataTable({
  columns,
  rows,
  loading = false,
  emptyMessage = 'No results.',
  limit,
  offset,
  hasMore,
  onPageChange,
  getRowKey = (row, index) => row.id ?? row.transactionId ?? row.ticketId ?? row.merchantId ?? row.logId ?? row.notificationId ?? index,
}) {
  const [sort, setSort] = useState({ key: null, direction: 'asc' });

  const sortedRows = useMemo(() => {
    if (!sort.key) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === bv) return 0;
      const result = av > bv ? 1 : -1;
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
                  className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-secondary-light dark:text-ink-secondary-dark ${
                    col.align === 'right' ? 'text-right' : 'text-left'
                  } ${col.sortable ? 'cursor-pointer select-none' : ''}`}
                  onClick={col.sortable ? () => toggleSort(col.key) : undefined}
                >
                  {col.label}
                  {col.sortable && sort.key === col.key ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
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
                    className="border-t border-black/5 hover:bg-black/[0.02] dark:border-white/5 dark:hover:bg-white/[0.02]"
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
            Showing {rows.length === 0 ? 0 : offset + 1}–{offset + rows.length}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => onPageChange(Math.max(0, offset - limit))}
              className="rounded-lg border border-black/10 px-3 py-1.5 disabled:opacity-40 dark:border-white/10"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!hasMore}
              onClick={() => onPageChange(offset + limit)}
              className="rounded-lg border border-black/10 px-3 py-1.5 disabled:opacity-40 dark:border-white/10"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
