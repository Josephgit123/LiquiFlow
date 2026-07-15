import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../services/apiClient.js';

/**
 * Cancellation-safe "fetch a list endpoint" hook — the loading/error/
 * cancelled-guard boilerplate previously hand-duplicated across
 * SettlementLedger, RefundLifecycleHub, CoreCommandDashboard, and others.
 *
 * `path` is the FULL query string (including any filters/offset the caller
 * builds) — changing it triggers a refetch. Pass `null` to skip fetching
 * (e.g. while a required id isn't known yet).
 *
 * `fetchFn` defaults to the merchant-authenticated `apiFetch`; admin pages
 * (Group 7+) pass `adminApiFetch` instead — same shape ({items, limit,
 * offset, hasMore}), different auth token source (CLAUDE.md invariant #7:
 * admin/merchant auth never share a code path, so this hook takes the
 * fetcher as a parameter rather than guessing which one to use).
 *
 * Deliberately does NOT try to distinguish "initial load" from "paginating"
 * internally (that produced a fragile, non-obvious internal heuristic in
 * an earlier draft) — callers already have everything needed to make that
 * call themselves: `loading && items.length === 0` reads as a first load,
 * `loading && items.length > 0` reads as a refetch/paginate with existing
 * rows still visible underneath.
 */
export function useApiList(path, fetchFn = apiFetch) {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ limit: null, offset: null, hasMore: false });
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!path) {
      setItems([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchFn(path)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items || []);
        setMeta({ limit: result.limit, offset: result.offset, hasMore: result.hasMore });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // reloadToken is intentionally in the deps array with no other purpose
    // than forcing a refetch of the SAME path — e.g. after a mutation
    // (a refund, a resolved ticket) that the list endpoint itself can't
    // push a live update for. fetchFn must be a STABLE reference (the
    // module-level apiFetch/adminApiFetch export, never an inline
    // wrapper) — it's included here for correctness, not because it's
    // ever expected to change.
  }, [path, reloadToken, fetchFn]);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { items, ...meta, loading, error, reload };
}
