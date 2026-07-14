import { useEffect, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../config/firebase.js';

/**
 * Live-subscribes to a Firestore collection/subcollection query —
 * READ-ONLY, same rule as useFirestoreDoc. This hook has no schema
 * knowledge; `constraints` is an array of firebase/firestore query
 * constraints (where(...), orderBy(...), limit(...)) built by the caller.
 *
 * IMPORTANT: callers must memoize `constraints` (e.g. useMemo, with the
 * actual filter values as deps) — a fresh array/constraint literal on
 * every render would otherwise unsubscribe/resubscribe every render
 * instead of only when the filter actually changes.
 *
 * `path` is a full slash-separated collection path string, e.g.
 * `tickets/${ticketId}/messages`.
 */
export function useFirestoreCollection(path, constraints = []) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!path) {
      setData([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const q = query(collection(db, path), ...constraints);
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [path, constraints]);

  return { data, loading, error };
}
