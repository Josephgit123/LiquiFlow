import { FieldValue } from 'firebase-admin/firestore';
import { normalizeCurrency } from '../utils/currency.js';

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_MAX_BATCHES_PER_RUN = 10;

/**
 * Pure function. Splits a captured gross amount into liquid/reserve/fee
 * portions using whole-number percentages (e.g. 15 for 15%, not 0.15).
 * All monetary values pass through normalizeCurrency at the point of
 * calculation (CLAUDE.md invariant #3) — never raw .toFixed(2) ad hoc.
 */
export function calculateSplit({ amountGross, reservePercent, platformFeePercent }) {
  if (typeof amountGross !== 'number' || !Number.isFinite(amountGross) || amountGross <= 0) {
    throw new Error(`calculateSplit: amountGross must be a positive finite number, got ${amountGross}.`);
  }
  if (typeof reservePercent !== 'number' || !Number.isFinite(reservePercent) || reservePercent < 0 || reservePercent > 100) {
    throw new Error(`calculateSplit: reservePercent must be a number in [0, 100], got ${reservePercent}.`);
  }
  if (typeof platformFeePercent !== 'number' || !Number.isFinite(platformFeePercent) || platformFeePercent < 0 || platformFeePercent > 100) {
    throw new Error(`calculateSplit: platformFeePercent must be a number in [0, 100], got ${platformFeePercent}.`);
  }

  const normalizedGross = normalizeCurrency(amountGross);
  const feeDeduction = normalizeCurrency(normalizedGross * (platformFeePercent / 100));
  const reserveAllocation = normalizeCurrency(normalizedGross * (reservePercent / 100));
  const liquidAllocation = normalizeCurrency(normalizedGross - reserveAllocation - feeDeduction);

  // A negative liquidAllocation here means the tier/fee configuration itself
  // is broken (reserve% + fee% > 100%) — this is NOT the intentional
  // negative-availableLiquid case from a chargeback clawback (CLAUDE.md
  // invariant #6). That is a distinct code path (chargeback clawback,
  // not yet implemented) and must never be confused with this guard.
  if (liquidAllocation < 0) {
    throw new Error(
      `calculateSplit: computed liquidAllocation is negative (${liquidAllocation}) for gross ${normalizedGross} — ` +
        `reservePercent (${reservePercent}) + platformFeePercent (${platformFeePercent}) exceeds 100%. ` +
        'This indicates a misconfigured tier/fee combination, not the intentional chargeback-clawback negative balance case.'
    );
  }

  // Defensive money-conservation check: the three parts must reconstitute
  // the original gross, within half a cent to allow for the normalization
  // rounding performed on each part independently.
  const reconstructed = normalizeCurrency(liquidAllocation + reserveAllocation + feeDeduction);
  const drift = Math.abs(reconstructed - normalizedGross);
  if (drift > 0.005) {
    throw new Error(
      `calculateSplit: money-conservation check failed — liquid (${liquidAllocation}) + reserve (${reserveAllocation}) ` +
        `+ fee (${feeDeduction}) = ${reconstructed}, expected ${normalizedGross} (drift ${drift}).`
    );
  }

  return { liquidAllocation, reserveAllocation, feeDeduction };
}

/**
 * Pure, synchronous. Builds the exact /reserve_vault document shape
 * (DATABASE_SCHEMA.md) for a single capsule. The caller supplies `now`
 * so this stays testable without depending on Date.now() internally, and
 * is responsible for assigning the real vaultId from a Firestore doc ref
 * and for skipping this call entirely when the reserve split rounds to
 * $0.00 — this function refuses to build a zero-value capsule.
 */
export function buildReserveCapsuleDocument({ merchantId, associatedTransactionId, amountLocked, holdDurationMs, now }) {
  if (typeof amountLocked !== 'number' || !Number.isFinite(amountLocked) || amountLocked <= 0) {
    throw new Error(
      `buildReserveCapsuleDocument: amountLocked must be > 0, got ${amountLocked}. ` +
        'Callers must skip capsule creation entirely when the reserve split rounds to $0.00.'
    );
  }
  if (typeof holdDurationMs !== 'number' || !Number.isFinite(holdDurationMs) || holdDurationMs <= 0) {
    throw new Error(`buildReserveCapsuleDocument: holdDurationMs must be a positive number, got ${holdDurationMs}.`);
  }
  if (!(now instanceof Date)) {
    throw new Error('buildReserveCapsuleDocument: now must be a Date instance (an absolute point in time).');
  }

  return {
    vaultId: null, // caller assigns via Firestore doc ref
    merchantId,
    associatedTransactionId,
    amountLocked,
    // Absolute UTC epoch-ms maturity boundary — never a relative/day-based
    // counter (CLAUDE.md invariant #8).
    releaseDate: new Date(now.getTime() + holdDurationMs),
    isMatured: false,
    createdAt: now,
  };
}

/**
 * Releases a single matured capsule inside its own Firestore transaction:
 * re-reads the capsule (skipping if another process already matured it —
 * this re-check is the real safety net, not the process-level scheduler
 * lock), re-reads the merchant's balance, flips isMatured, and moves
 * amountLocked from lockedEscrow to availableLiquid.
 */
async function releaseSingleCapsule(db, vaultId) {
  const vaultRef = db.collection('reserve_vault').doc(vaultId);

  return db.runTransaction(async (transaction) => {
    const vaultSnap = await transaction.get(vaultRef);
    if (!vaultSnap.exists) {
      throw new Error(`sweepMaturedCapsules: reserve_vault/${vaultId} no longer exists.`);
    }
    const capsule = vaultSnap.data();

    if (capsule.isMatured) {
      // Already released by a concurrent process (or an earlier attempt)
      // despite the scheduler lock — skip cleanly, not an error.
      return { skipped: true };
    }

    const balanceRef = db.collection('merchant_balances').doc(capsule.merchantId);
    const balanceSnap = await transaction.get(balanceRef);
    if (!balanceSnap.exists) {
      throw new Error(
        `sweepMaturedCapsules: merchant_balances/${capsule.merchantId} not found for capsule ${vaultId}.`
      );
    }
    const balance = balanceSnap.data();

    transaction.update(vaultRef, { isMatured: true });
    transaction.update(balanceRef, {
      lockedEscrow: normalizeCurrency(balance.lockedEscrow - capsule.amountLocked),
      availableLiquid: normalizeCurrency(balance.availableLiquid + capsule.amountLocked),
      lastUpdated: FieldValue.serverTimestamp(),
    });

    return { skipped: false };
  });
}

/**
 * Scans /reserve_vault for capsules past their releaseDate and releases
 * them, batching to bound the amount of work a single invocation does.
 * Self-contained and caller-agnostic: both the scheduler (vaultScheduler.js)
 * and a future on-demand route can call this directly.
 *
 * One bad capsule never aborts the batch — each capsule's release runs in
 * its own transaction and its own try/catch. A capsule that fails simply
 * stays isMatured: false and is retried on the next sweep.
 */
export async function sweepMaturedCapsules(db, options = {}) {
  const batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
  const maxBatchesPerRun = options.maxBatchesPerRun || DEFAULT_MAX_BATCHES_PER_RUN;

  const startedAt = Date.now();
  let released = 0;
  let failed = 0;
  let remaining = false;

  for (let batchIndex = 0; batchIndex < maxBatchesPerRun; batchIndex += 1) {
    const now = new Date();
    // GAP: this query (isMatured == false AND releaseDate <= now, ordered
    // by releaseDate) needs a composite index on (isMatured, releaseDate)
    // — see firebase/firestore.indexes.json, flagged in the session summary.
    const snapshot = await db
      .collection('reserve_vault')
      .where('isMatured', '==', false)
      .where('releaseDate', '<=', now)
      .orderBy('releaseDate', 'asc')
      .limit(batchSize)
      .get();

    if (snapshot.empty) {
      remaining = false;
      break;
    }

    for (const doc of snapshot.docs) {
      const capsuleData = doc.data();
      try {
        const result = await releaseSingleCapsule(db, doc.id);
        if (!result.skipped) {
          released += 1;
        }
      } catch (err) {
        failed += 1;
        console.error(
          `[vaultService] sweepMaturedCapsules: failed to release capsule vaultId=${doc.id} merchantId=${capsuleData.merchantId}: ${err.message}`
        );
      }
    }

    if (snapshot.docs.length < batchSize) {
      remaining = false;
      break;
    }

    if (batchIndex === maxBatchesPerRun - 1) {
      // Batch was full on the last allowed iteration — more may still be
      // waiting, but the safety cap stops us from sweeping indefinitely.
      remaining = true;
    }
  }

  return {
    released,
    failed,
    remaining,
    durationMs: Date.now() - startedAt,
  };
}
