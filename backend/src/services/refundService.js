import { FieldValue } from 'firebase-admin/firestore';
import { normalizeCurrency } from '../utils/currency.js';

// GAP / DELIBERATE SCOPE LIMIT: full-refund-only in this phase.
// refundAmount must exactly equal the original transaction's amountGross.
// Partial refunds (with a cumulative-refunded tracking field) are not
// supported — neither PAYMENT_FLOW.md nor DATABASE_SCHEMA.md specifies
// how a partially-refunded transaction's remaining balance would be
// tracked, so this is a deliberate decision flagged for review rather
// than an oversight.
//
// ALSO NOTE: platformFeeDeduction is never refunded/clawed back — only
// refundAmount is reversed out of availableLiquid. Neither doc addresses
// this either; flagged as an assumption.

function validateParams(params) {
  const p = params || {};

  if (!p.merchantId || typeof p.merchantId !== 'string') {
    throw new Error('processRefund: merchantId must be a non-empty string.');
  }
  if (!p.transactionId || typeof p.transactionId !== 'string') {
    throw new Error('processRefund: transactionId must be a non-empty string.');
  }
  if (typeof p.refundAmount !== 'number' || !Number.isFinite(p.refundAmount) || p.refundAmount <= 0) {
    throw new Error(`processRefund: refundAmount must be a positive number, got ${p.refundAmount}.`);
  }
  if (p.reason !== undefined && p.reason !== null && typeof p.reason !== 'string') {
    throw new Error('processRefund: reason, if provided, must be a string.');
  }
  if (!p.idempotencyKey || typeof p.idempotencyKey !== 'string') {
    throw new Error('processRefund: idempotencyKey must be a non-empty string.');
  }

  return p;
}

/**
 * Atomic refund sequence, mirroring settlementService.js's pattern
 * (CLAUDE.md invariant #2: single db.runTransaction, re-reading
 * everything inside it). Refunds draw ONLY from availableLiquid — this
 * file never reads or writes lockedEscrow. Chargebacks (which draw from
 * reserve first, per CLAUDE.md invariant #6) are a separate workflow, not
 * implemented here.
 */
export async function processRefund(db, params) {
  const { merchantId, transactionId, refundAmount, reason, idempotencyKey } = validateParams(params);

  const originalTxRef = db.collection('transactions').doc(transactionId);
  const balanceRef = db.collection('merchant_balances').doc(merchantId);
  const transactionsCollection = db.collection('transactions');

  return db.runTransaction(async (transaction) => {
    const originalTxSnap = await transaction.get(originalTxRef);
    if (!originalTxSnap.exists) {
      throw new Error(`processRefund: original transaction "${transactionId}" not found.`);
    }
    const originalTx = originalTxSnap.data();

    // Defense in depth — the route already performs this ownership check
    // and returns 404 before ever calling processRefund; this re-check
    // guards against a TOCTOU race, per the same pattern settlementService
    // uses for its own re-reads.
    if (originalTx.merchantId !== merchantId) {
      throw new Error(
        `processRefund: transaction "${transactionId}" does not belong to merchant "${merchantId}".`
      );
    }

    // Idempotency check happens BEFORE the status/eligibility checks — a
    // genuine retry of an already-processed refund targets a transaction
    // that is now REFUNDED, not CAPTURED, and must return the prior
    // result instead of incorrectly failing the status check below.
    const existingSnapshot = await transaction.get(
      transactionsCollection.where('idempotencyKey', '==', idempotencyKey)
    );
    if (!existingSnapshot.empty) {
      const existingDoc = existingSnapshot.docs[0];
      const existingData = existingDoc.data();
      const balanceSnap = await transaction.get(balanceRef);

      return {
        refundTransactionId: existingDoc.id,
        originalTransactionId: existingData.associatedTransactionId,
        refundAmount: existingData.refundAmount,
        newAvailableLiquid: balanceSnap.exists ? balanceSnap.data().availableLiquid : null,
        wasIdempotentReplay: true,
      };
    }

    if (originalTx.status !== 'CAPTURED') {
      throw new Error(
        `processRefund: transaction "${transactionId}" is not eligible for refund — status is "${originalTx.status}", not CAPTURED.`
      );
    }

    const normalizedRefundAmount = normalizeCurrency(refundAmount);
    if (normalizedRefundAmount !== originalTx.amountGross) {
      throw new Error(
        `processRefund: refundAmount (${normalizedRefundAmount}) must exactly equal the original transaction's amountGross (${originalTx.amountGross}) — partial refunds are not supported in this phase.`
      );
    }

    const balanceSnap = await transaction.get(balanceRef);
    if (!balanceSnap.exists) {
      throw new Error(`processRefund: merchant balance profile not found for merchantId "${merchantId}".`);
    }
    const currentBalances = balanceSnap.data();

    // THE liquidity check (CLAUDE.md invariant #5) — enforced here, inside
    // the transaction, not just as an optimistic pre-check in the route.
    // A refund exceeding availableLiquid is REJECTED outright and never
    // allowed to push the balance negative — the OPPOSITE of the
    // chargeback clawback rule (CLAUDE.md invariant #6, a separate,
    // not-yet-implemented workflow). Do not confuse the two here.
    if (normalizedRefundAmount > currentBalances.availableLiquid) {
      throw new Error(
        `processRefund: refundAmount (${normalizedRefundAmount}) exceeds availableLiquid (${currentBalances.availableLiquid}) for merchant "${merchantId}".`
      );
    }

    // lockedEscrow is deliberately never read or written on this path.
    transaction.update(balanceRef, {
      availableLiquid: normalizeCurrency(currentBalances.availableLiquid - normalizedRefundAmount),
      lastUpdated: FieldValue.serverTimestamp(),
    });

    // The one permitted in-place field update on an existing /transactions
    // document (DATABASE_SCHEMA.md: status transitions are the sole
    // exception to append-only).
    transaction.update(originalTxRef, { status: 'REFUNDED' });

    // ALSO write a new ledger row recording the refund event itself, per
    // PAYMENT_FLOW.md's Refund Workflow step 3 — see the session summary
    // for how this reconciles with DATABASE_SCHEMA.md's "sole permitted
    // update" wording. Deliberately does not populate amountGross /
    // splitLiquidAmount / splitReserveAmount / platformFeeDeduction /
    // riskScoreCalculated — those describe a capture, not a refund event,
    // and DATABASE_SCHEMA.md does not define a distinct refund-row shape.
    const refundTxRef = transactionsCollection.doc();
    transaction.set(refundTxRef, {
      transactionId: refundTxRef.id,
      merchantId,
      associatedTransactionId: transactionId,
      refundAmount: normalizedRefundAmount,
      reason: reason || null,
      status: 'REFUNDED',
      receiptHash: 'tx_hash_' + Math.random().toString(36).substring(2, 15),
      idempotencyKey,
      timestamp: FieldValue.serverTimestamp(),
    });

    return {
      refundTransactionId: refundTxRef.id,
      originalTransactionId: transactionId,
      refundAmount: normalizedRefundAmount,
      newAvailableLiquid: normalizeCurrency(currentBalances.availableLiquid - normalizedRefundAmount),
      wasIdempotentReplay: false,
    };
  });
}
