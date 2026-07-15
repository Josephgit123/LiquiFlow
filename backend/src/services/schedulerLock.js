// DEPLOYMENT_GUIDE.md's Backend Deployment step 4 requires gating the
// vault-maturity scheduler behind a leader-election/single-worker
// mechanism when multiple backend instances are deployed, but does not
// specify one. Firestore is the only coordination service available here,
// so this implements a simple lease-based lock on a single document —
// not a general-purpose distributed lock, just enough to keep concurrent
// backend instances from double-processing the same sweep.

const LOCK_DOC_ID = 'schedulerLock';

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === 'function') return value.toMillis(); // real Firestore Timestamp
  return Number(value);
}

/**
 * Attempts to claim (or renew) the scheduler lock for `workerId`.
 * Returns true if this call now holds the lock, false if another live
 * instance already holds it.
 */
export async function acquireSchedulerLock(db, workerId, leaseDurationMs) {
  const lockRef = db.collection('system_configuration').doc(LOCK_DOC_ID);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lockRef);
    const now = Date.now();

    if (snapshot.exists) {
      const lock = snapshot.data();
      const isExpired = !lock.expiresAt || toMillis(lock.expiresAt) <= now;
      const isHeldByUs = lock.lockedBy === workerId;

      if (!isExpired && !isHeldByUs) {
        return false; // another live instance holds a still-valid lease
      }
      // Either the previous holder's lease expired (it crashed without
      // releasing) or we already hold it — fall through to claim/renew.
    }

    transaction.set(lockRef, {
      lockedBy: workerId,
      expiresAt: new Date(now + leaseDurationMs),
    });
    return true;
  });
}

/**
 * Releases the lock, but only if `workerId` is still the current holder —
 * never clobbers a lease some other instance has since (re)claimed after
 * this one's lease expired.
 */
export async function releaseSchedulerLock(db, workerId) {
  const lockRef = db.collection('system_configuration').doc(LOCK_DOC_ID);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lockRef);
    if (!snapshot.exists) return;

    const lock = snapshot.data();
    if (lock.lockedBy !== workerId) return;

    transaction.set(lockRef, { lockedBy: null, expiresAt: null });
  });
}
