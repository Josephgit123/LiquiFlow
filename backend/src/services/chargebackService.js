import { FieldValue } from 'firebase-admin/firestore';
import { normalizeCurrency } from '../utils/currency.js';

// RECONCILIATION (flagged for review, not a pre-approved assumption):
// PAYMENT_FLOW.md's Chargeback Workflow describes drawing from "matured
// reserve capsules" first. But once a capsule matures, vaultService's
// sweepMaturedCapsules already moves its amountLocked into
// availableLiquid — by the time a capsule "matures" there is no longer a
// distinct matured-capsule balance to draw from. /reserve_vault is also
// append-only with isMatured as its only documented mutable field, so
// there is no schema support for partially draining a specific capsule's
// amountLocked. This implementation instead draws from the AGGREGATE
// lockedEscrow field on /merchant_balances — DATABASE_SCHEMA.md defines
// lockedEscrow as "assets currently held in reserve capsules," and
// merchant_balances is explicitly the one collection allowed in-place
// mutation. This file never reads or writes /reserve_vault documents.
//
// GAP: no double-chargeback / chargeback-after-refund support in this
// phase — a transaction already DISPUTED or REFUNDED is rejected outright
// (409), same category of deliberate scope limit as the refund-eligibility
// rule in refundService.js.
//
// GAP: if disputeAmount is omitted, it defaults to the original
// transaction's amountGross. If provided, it must be > 0 and must NOT
// exceed the original amountGross — rejected as a likely data-entry error
// rather than silently clamped.

const VALID_ELIGIBLE_STATUS = 'CAPTURED';

function validateParams(params) {
  const p = params || {};

  if (!p.transactionId || typeof p.transactionId !== 'string') {
    throw new Error('processChargeback: transactionId must be a non-empty string.');
  }
  if (
    p.disputeAmount !== undefined &&
    p.disputeAmount !== null &&
    (typeof p.disputeAmount !== 'number' || !Number.isFinite(p.disputeAmount) || p.disputeAmount <= 0)
  ) {
    throw new Error(`processChargeback: disputeAmount, if provided, must be a positive number, got ${p.disputeAmount}.`);
  }
  if (p.reason !== undefined && p.reason !== null && typeof p.reason !== 'string') {
    throw new Error('processChargeback: reason, if provided, must be a string.');
  }
  if (!p.idempotencyKey || typeof p.idempotencyKey !== 'string') {
    throw new Error('processChargeback: idempotencyKey must be a non-empty string.');
  }
  if (!p.actorId || typeof p.actorId !== 'string') {
    throw new Error('processChargeback: actorId must be a non-empty string.');
  }

  return p;
}

/**
 * Atomic chargeback clawback sequence, mirroring settlementService.js /
 * refundService.js's pattern (CLAUDE.md invariant #2: single
 * db.runTransaction, re-reading everything inside it). Draws from
 * lockedEscrow first, then availableLiquid for the remainder — and
 * availableLiquid IS allowed to go negative here (CLAUDE.md invariant #6),
 * the opposite of refundService.js's rule. Never reads or writes
 * /reserve_vault documents.
 */
export async function processChargeback(db, params) {
  const { transactionId, disputeAmount, reason, idempotencyKey, actorId } = validateParams(params);

  const originalTxRef = db.collection('transactions').doc(transactionId);
  const transactionsCollection = db.collection('transactions');
  const auditLogsCollection = db.collection('system_audit_logs');

  return db.runTransaction(async (transaction) => {
    const originalTxSnap = await transaction.get(originalTxRef);
    if (!originalTxSnap.exists) {
      throw new Error(`processChargeback: original transaction "${transactionId}" not found.`);
    }
    const originalTx = originalTxSnap.data();
    // No merchantId in the admin's own token — derived from the target
    // transaction itself.
    const merchantId = originalTx.merchantId;
    const balanceRef = db.collection('merchant_balances').doc(merchantId);

    // Idempotency check happens BEFORE the status/eligibility checks — a
    // genuine retry targets a transaction that is now DISPUTED, not
    // CAPTURED, and must return the prior result instead of incorrectly
    // failing the status check below (same pattern as refundService.js).
    const existingSnapshot = await transaction.get(
      transactionsCollection.where('idempotencyKey', '==', idempotencyKey)
    );
    if (!existingSnapshot.empty) {
      const existingDoc = existingSnapshot.docs[0];
      const existingData = existingDoc.data();
      const balanceSnap = await transaction.get(balanceRef);

      return {
        chargebackTransactionId: existingDoc.id,
        originalTransactionId: existingData.associatedTransactionId,
        reserveDraw: existingData.reserveDraw,
        remainderDraw: existingData.remainderDraw,
        newAvailableLiquid: balanceSnap.exists ? balanceSnap.data().availableLiquid : null,
        newLockedEscrow: balanceSnap.exists ? balanceSnap.data().lockedEscrow : null,
        wasIdempotentReplay: true,
      };
    }

    if (originalTx.status !== VALID_ELIGIBLE_STATUS) {
      throw new Error(
        `processChargeback: transaction "${transactionId}" is not eligible for chargeback — status is "${originalTx.status}", not CAPTURED.`
      );
    }

    const effectiveDisputeAmount = normalizeCurrency(
      disputeAmount !== undefined && disputeAmount !== null ? disputeAmount : originalTx.amountGross
    );

    if (effectiveDisputeAmount > originalTx.amountGross) {
      throw new Error(
        `processChargeback: disputeAmount (${effectiveDisputeAmount}) exceeds the original transaction's amountGross (${originalTx.amountGross}) — rejected as a likely data error.`
      );
    }

    const balanceSnap = await transaction.get(balanceRef);
    if (!balanceSnap.exists) {
      throw new Error(`processChargeback: merchant balance profile not found for merchantId "${merchantId}".`);
    }
    const currentBalances = balanceSnap.data();
    const beforeState = { ...currentBalances };

    // Clawback order (CLAUDE.md invariant #6): reserve first (via the
    // aggregate lockedEscrow field — see the file-level comment above for
    // why this replaces "matured reserve capsules"), then the remainder
    // from availableLiquid.
    const reserveDraw = normalizeCurrency(Math.min(effectiveDisputeAmount, currentBalances.lockedEscrow));
    const remainderDraw = normalizeCurrency(effectiveDisputeAmount - reserveDraw);

    const newLockedEscrow = normalizeCurrency(currentBalances.lockedEscrow - reserveDraw);
    // availableLiquid IS explicitly allowed to go negative here — the
    // OPPOSITE of refundService.js's rule, which rejects outright on
    // insufficient funds. A negative availableLiquid after a chargeback
    // clawback is intentional platform-solvency protection (CLAUDE.md
    // invariant #6), not a bug — do not "fix" this into a rejection.
    const newAvailableLiquid = normalizeCurrency(currentBalances.availableLiquid - remainderDraw);

    transaction.update(balanceRef, {
      lockedEscrow: newLockedEscrow,
      availableLiquid: newAvailableLiquid,
      lastUpdated: FieldValue.serverTimestamp(),
    });

    // The one permitted in-place field update on an existing /transactions
    // document (DATABASE_SCHEMA.md: status transitions are the sole
    // exception to append-only).
    transaction.update(originalTxRef, { status: 'DISPUTED' });

    // ALSO write a new ledger row recording the clawback event itself,
    // consistent with refundService.js's refund-event pattern — includes
    // the reserveDraw/remainderDraw breakdown for reconstructability.
    const chargebackTxRef = transactionsCollection.doc();
    transaction.set(chargebackTxRef, {
      transactionId: chargebackTxRef.id,
      merchantId,
      associatedTransactionId: transactionId,
      disputeAmount: effectiveDisputeAmount,
      reserveDraw,
      remainderDraw,
      reason: reason || null,
      status: 'DISPUTED',
      receiptHash: 'tx_hash_' + Math.random().toString(36).substring(2, 15),
      idempotencyKey,
      timestamp: FieldValue.serverTimestamp(),
    });

    // Append-only audit log entry (DATABASE_SCHEMA.md /system_audit_logs
    // fields). actorId is necessarily generic (e.g. 'ADMIN') since the
    // admin JWT encodes no per-admin identity — a known, already-flagged
    // limitation (CLAUDE.md / SYSTEM_ARCHITECTURE.md caveat #4), not
    // something this session attempts to solve.
    const auditLogRef = auditLogsCollection.doc();
    transaction.set(auditLogRef, {
      logId: auditLogRef.id,
      actorId,
      actionType: 'CHARGEBACK_CLAWBACK',
      targetId: transactionId,
      beforeState,
      afterState: {
        ...currentBalances,
        lockedEscrow: newLockedEscrow,
        availableLiquid: newAvailableLiquid,
      },
      timestamp: FieldValue.serverTimestamp(),
    });

    return {
      chargebackTransactionId: chargebackTxRef.id,
      originalTransactionId: transactionId,
      reserveDraw,
      remainderDraw,
      newAvailableLiquid,
      newLockedEscrow,
      wasIdempotentReplay: false,
    };
  });
}
