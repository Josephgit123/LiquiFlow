import { useMemo, useState } from 'react';
import { orderBy, where } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext.jsx';
import { useFirestoreCollection } from '../../hooks/useFirestoreCollection.js';
import { toDate } from '../../utils/firestoreTime.js';
import GlassCard from '../../components/common/GlassCard.jsx';
import CountdownTimer from '../../components/common/CountdownTimer.jsx';
import CurrencyDisplay, { formatCurrency } from '../../components/common/CurrencyDisplay.jsx';
import StatusBadge from '../../components/common/StatusBadge.jsx';
import QuickTicketDialog from '../../components/common/QuickTicketDialog.jsx';
import Skeleton from '../../components/common/Skeleton.jsx';

// Live via Firestore onSnapshot, not the GET /api/vault REST endpoint —
// Part 2 explicitly calls out Vault as needing real-time updates (a
// capsule maturing via the automatic 60s background sweep should update
// this page with no manual refresh). GET /api/vault still exists and is
// correct to have built, but isn't this page's primary data source.
export default function MaturityVaultInterface() {
  const { firebaseUser, merchantProfile } = useAuth();
  const merchantId = firebaseUser?.uid;
  const currency = merchantProfile?.currency || 'USD';

  const constraints = useMemo(
    () => [where('merchantId', '==', merchantId || '__none__'), orderBy('releaseDate', 'asc')],
    [merchantId]
  );
  const { data: capsules, loading, error } = useFirestoreCollection(merchantId ? 'reserve_vault' : null, constraints);

  const [reviewCapsule, setReviewCapsule] = useState(null);

  const totalLocked = useMemo(
    () => capsules.filter((c) => !c.isMatured).reduce((sum, c) => sum + (c.amountLocked || 0), 0),
    [capsules]
  );
  const activeCount = useMemo(() => capsules.filter((c) => !c.isMatured).length, [capsules]);

  const reviewDescription = useMemo(() => {
    if (!reviewCapsule) return '';
    const releaseDate = toDate(reviewCapsule.releaseDate);
    const amount = formatCurrency(reviewCapsule.amountLocked || 0, currency);
    return `Requesting early administrative review of reserve capsule ${reviewCapsule.vaultId} (${amount} locked, scheduled to release ${releaseDate ? releaseDate.toLocaleDateString() : 'unknown date'}).`;
  }, [reviewCapsule, currency]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">Maturity Vault Interface</h1>
        <p className="text-sm text-ink-secondary-light dark:text-ink-secondary-dark">
          Live reserve capsules — each releases automatically into your available liquid pool at maturity.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <GlassCard tint="reserve">
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Currently locked</p>
          <div className="mt-2 text-lg font-semibold" aria-live="polite">
            {loading ? <Skeleton width="6rem" height="1.5rem" /> : <CurrencyDisplay value={totalLocked} currency={currency} />}
          </div>
        </GlassCard>
        <GlassCard>
          <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Active capsules</p>
          <p className="mt-2 text-lg font-semibold" aria-live="polite">
            {loading ? <Skeleton width="2rem" height="1.5rem" /> : activeCount}
          </p>
        </GlassCard>
      </div>

      {error && (
        <p role="alert" className="text-sm text-accent-alert">
          Failed to load reserve vault: {error.message}
        </p>
      )}

      {!error && !loading && capsules.length === 0 && (
        <GlassCard>
          <p className="py-8 text-center text-sm text-ink-muted-light dark:text-ink-muted-dark">
            No reserve capsules yet — captured transactions with a nonzero reserve split will appear here.
          </p>
        </GlassCard>
      )}

      {!error && loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <GlassCard key={i} className="flex flex-col items-center gap-4 text-center">
              <Skeleton width="4rem" height="1.25rem" variant="rect" />
              <Skeleton variant="circle" width="110px" height="110px" />
              <Skeleton width="5rem" height="1rem" />
            </GlassCard>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {capsules.map((capsule, i) => (
          <GlassCard
            key={capsule.id}
            tint={capsule.isMatured ? 'liquid' : 'reserve'}
            delay={Math.min(i, 8) * 0.04}
            className="flex flex-col items-center gap-4 text-center"
          >
            <StatusBadge value={capsule.isMatured ? 'MATURED' : 'LOCKED'} />
            <CountdownTimer releaseDate={capsule.releaseDate} createdAt={capsule.createdAt} size={110} />
            <div>
              <p className="text-xs text-ink-muted-light dark:text-ink-muted-dark">Amount locked</p>
              <CurrencyDisplay value={capsule.amountLocked} currency={currency} />
            </div>
            {!capsule.isMatured && (
              <button
                type="button"
                onClick={() => setReviewCapsule(capsule)}
                className="rounded text-xs font-medium text-accent-liquid hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-liquid/50"
              >
                Request Early Administrative Review
              </button>
            )}
          </GlassCard>
        ))}
      </div>

      <QuickTicketDialog
        open={Boolean(reviewCapsule)}
        onClose={() => setReviewCapsule(null)}
        subject="Early Release Request"
        defaultDescription={reviewDescription}
      />
    </div>
  );
}
