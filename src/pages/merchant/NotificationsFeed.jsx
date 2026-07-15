import { useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFirestoreCollection } from '../../hooks/useFirestoreCollection.js';
import { apiFetch } from '../../services/apiClient.js';
import { toDate } from '../../utils/firestoreTime.js';
import GlassCard from '../../components/common/GlassCard.jsx';
import Button from '../../components/common/Button.jsx';
import Skeleton from '../../components/common/Skeleton.jsx';

// Two live queries merged client-side, mirroring notificationService.js's
// own OR-query workaround (Firestore has no native OR across "merchantId ==
// uid" and "merchantId == null AND targetRole == MERCHANT") — a single
// onSnapshot query can't express this, so two subscriptions are combined
// here exactly like the backend's listNotifications() combines two reads.
export default function NotificationsFeed() {
  const { firebaseUser } = useAuth();
  const merchantId = firebaseUser?.uid;

  const ownConstraints = useMemo(
    () => [where('merchantId', '==', merchantId || '__none__')],
    [merchantId]
  );
  const broadcastConstraints = useMemo(
    () => [where('merchantId', '==', null), where('targetRole', '==', 'MERCHANT')],
    []
  );

  const { data: own, loading: loadingOwn, error: errorOwn } = useFirestoreCollection(
    merchantId ? 'notifications' : null,
    ownConstraints
  );
  const { data: broadcast, loading: loadingBroadcast, error: errorBroadcast } = useFirestoreCollection(
    merchantId ? 'notifications' : null,
    broadcastConstraints
  );

  const [markingAll, setMarkingAll] = useState(false);
  const [markError, setMarkError] = useState(null);

  const notifications = useMemo(() => {
    const combined = [...own, ...broadcast];
    combined.sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0));
    return combined;
  }, [own, broadcast]);

  const unread = notifications.filter((n) => !n.read);
  const loading = loadingOwn || loadingBroadcast;
  const error = errorOwn || errorBroadcast;

  async function markRead(notificationId) {
    try {
      await apiFetch(`/notifications/${notificationId}/read`, { method: 'PATCH', body: { read: true } });
    } catch (err) {
      setMarkError(err.message || 'Failed to mark notification read.');
    }
  }

  // No bulk-mark-read endpoint exists on the real backend (only
  // PATCH /api/notifications/:id/read, one at a time) — looping individual
  // calls here rather than silently inventing a new bulk route, per Part
  // 2's Known Gaps instruction to flag inefficiency instead of expanding
  // the backend surface unasked.
  async function handleMarkAllRead() {
    setMarkingAll(true);
    setMarkError(null);
    try {
      for (const n of unread) {
        // eslint-disable-next-line no-await-in-loop
        await apiFetch(`/notifications/${n.notificationId}/read`, { method: 'PATCH', body: { read: true } });
      }
    } catch (err) {
      setMarkError(err.message || 'Failed to mark all notifications read.');
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Notifications</h1>
          <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
            {unread.length > 0 ? `${unread.length} unread` : 'All caught up'}
          </p>
        </div>
        {unread.length > 0 && (
          <Button
            variant="secondary"
            onClick={handleMarkAllRead}
            disabled={markingAll}
            loading={markingAll}
            title={`Sends ${unread.length} individual requests — no bulk endpoint exists yet.`}
          >
            Mark all read
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-accent-alert">
          Failed to load notifications: {error.message}
        </p>
      )}
      {markError && (
        <p role="alert" className="text-sm text-accent-alert">
          {markError}
        </p>
      )}

      {!error && !loading && notifications.length === 0 && (
        <GlassCard>
          <p className="py-8 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark">
            No notifications yet.
          </p>
        </GlassCard>
      )}

      <div className="flex flex-col gap-3">
        {loading &&
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={`skel-${i}`} variant="rect" height="4rem" />)}
        {!loading &&
          notifications.map((n) => (
            <GlassCard
              key={n.notificationId}
              tint={n.read ? 'neutral' : 'liquid'}
              className="flex items-start justify-between gap-4 !p-4"
            >
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-muted-light dark:text-ink-muted-dark">
                  {n.category}
                </span>
                <p className="text-sm">{n.message}</p>
                <span className="text-xs text-ink-muted-light dark:text-ink-muted-dark">
                  {toDate(n.createdAt)?.toLocaleString() ?? '—'}
                </span>
              </div>
              {!n.read && (
                <button
                  type="button"
                  onClick={() => markRead(n.notificationId)}
                  className="shrink-0 rounded text-xs font-medium text-accent-liquid hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50"
                >
                  Mark read
                </button>
              )}
            </GlassCard>
          ))}
      </div>
    </div>
  );
}
