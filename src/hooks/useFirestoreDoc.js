import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase.js';

/**
 * Live-subscribes to a single Firestore document — READ-ONLY (Part 5's
 * integration rule: no page writes to Firestore directly; all writes go
 * through the backend API, enforced structurally by firestore.rules
 * denying client writes anyway). Pass `path` as null/undefined to skip
 * subscribing (e.g. while a merchantId isn't known yet).
 *
 * `path` is a full slash-separated document path string, e.g.
 * `merchant_balances/${merchantId}`.
 */
export function useFirestoreDoc(path) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const ref = doc(db, path);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        setData(snap.exists() ? { id: snap.id, ...snap.data() } : null);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [path]);

  return { data, loading, error };
}
