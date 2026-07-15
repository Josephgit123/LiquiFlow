import { normalizeCurrency } from '../utils/currency.js';
import { logAdminAction } from './auditLogService.js';

// Introducing a new, small /payouts collection for voluntary payout
// events. A payout is not a captured/refunded/disputed event — forcing it
// into /transactions' existing status enum would misrepresent what
// happened (no gross amount, no risk score, no split — just cash leaving
// availableLiquid to a corporate bank account) and would compromise that
// collection's meaning as a ledger of CUSTOMER-facing transaction events.
// A dedicated collection keeps that enum clean and gives payouts their own
// natural shape (payoutId, merchantId, amount, status, initiatedBy,
// createdAt).
//
// CRITICAL SCOPE BOUNDARY — read before touching anything near
// availableLiquid: the "cannot drop below zero" rule enforced below
// applies ONLY to this voluntary payout path. It is NOT a general floor on
// availableLiquid, must NEVER be read as one, and must never be ported
// into chargebackService.js. CLAUDE.md invariant #6 and chargebackService.js
// (Step 11, untouched here) deliberately allow availableLiquid to go
// negative during a chargeback clawback to protect platform solvency —
// that behavior is completely unaffected by this file. These are two
// different rules for two different operations.

function validateBatchParams(params) {
  const p = params || {};
  if (!p.actorId || typeof p.actorId !== 'string') {
    throw new Error('executeSettlementBatch: actorId must be a non-empty string.');
  }
  if (p.merchantIds !== undefined && !Array.isArray(p.merchantIds)) {
    throw new Error('executeSettlementBatch: merchantIds, if provided, must be an array of strings.');
  }
  if (p.amounts !== undefined && (typeof p.amounts !== 'object' || p.amounts === null || Array.isArray(p.amounts))) {
    throw new Error('executeSettlementBatch: amounts, if provided, must be a plain object keyed by merchantId.');
  }
  return p;
}

/**
 * Pays out a single merchant's availableLiquid (in full, or a specified
 * `amount`), inside its own db.runTransaction — same re-read-inside-the-
 * transaction pattern as every other financial write in this codebase
 * (CLAUDE.md invariant #2). Rejects (throws) if the requested amount would
 * take availableLiquid below zero; this is the scope-limited zero-floor
 * rule described in the file header, nothing more.
 */
async function payoutSingleMerchant(db, { merchantId, actorId, amount }) {
  const balanceRef = db.collection('merchant_balances').doc(merchantId);

  return db.runTransaction(async (transaction) => {
    const balanceSnap = await transaction.get(balanceRef);
    if (!balanceSnap.exists) {
      throw new Error(`payoutSingleMerchant: merchant_balances "${merchantId}" not found.`);
    }
    const balance = balanceSnap.data();
    const payoutAmount = amount != null ? normalizeCurrency(amount) : normalizeCurrency(balance.availableLiquid);

    if (payoutAmount <= 0) {
      throw new Error(`payoutSingleMerchant: nothing to pay out for merchant "${merchantId}" (amount is zero or negative).`);
    }
    // Scope-limited to THIS voluntary payout path only — see file header.
    if (payoutAmount > balance.availableLiquid) {
      throw new Error(
        `payoutSingleMerchant: payout amount (${payoutAmount}) exceeds availableLiquid (${balance.availableLiquid}) for merchant "${merchantId}" — voluntary payouts may never drop availableLiquid below zero.`
      );
    }

    const newAvailableLiquid = normalizeCurrency(balance.availableLiquid - payoutAmount);
    const newTotalWithdrawn = normalizeCurrency(balance.totalWithdrawn + payoutAmount);

    transaction.update(balanceRef, {
      availableLiquid: newAvailableLiquid,
      totalWithdrawn: newTotalWithdrawn,
      lastUpdated: new Date(),
    });

    const payoutRef = db.collection('payouts').doc();
    const payoutDoc = {
      payoutId: payoutRef.id,
      merchantId,
      amount: payoutAmount,
      status: 'COMPLETED',
      initiatedBy: actorId,
      createdAt: new Date(),
    };
    transaction.set(payoutRef, payoutDoc);

    await logAdminAction(db, {
      actorId,
      actionType: 'ADMIN_SETTLEMENT_PAYOUT',
      targetId: merchantId,
      beforeState: { availableLiquid: balance.availableLiquid, totalWithdrawn: balance.totalWithdrawn },
      afterState: { availableLiquid: newAvailableLiquid, totalWithdrawn: newTotalWithdrawn, payoutId: payoutRef.id },
      transaction,
    });

    return { payout: payoutDoc, newAvailableLiquid, newTotalWithdrawn };
  });
}

/**
 * Scans /merchant_balances for merchants with availableLiquid > 0
 * (optionally filtered to specific merchantIds in the body), and pays each
 * out in its own isolated transaction — one merchant's failure (e.g. a
 * concurrent mutation dropping their balance below the requested amount)
 * never aborts the batch, mirroring vaultService.sweepMaturedCapsules'
 * "one bad capsule never aborts the batch" pattern.
 *
 * `amounts`, if provided, is an optional { merchantId: amount } map
 * overriding the default "pay out the full availableLiquid" behavior for
 * specific merchants — the spec's "zeroes out (or reduces by a specified
 * amount)" wording doesn't give an exact body shape, so this is an
 * invented, flagged convention.
 */
export async function executeSettlementBatch(db, params) {
  const { merchantIds, amounts, actorId } = validateBatchParams(params);

  let candidateIds;
  if (merchantIds && merchantIds.length > 0) {
    candidateIds = merchantIds;
  } else {
    const snap = await db.collection('merchant_balances').where('availableLiquid', '>', 0).get();
    candidateIds = snap.docs.map((d) => d.id);
  }

  const results = [];
  for (const merchantId of candidateIds) {
    try {
      const amount = amounts && amounts[merchantId] != null ? amounts[merchantId] : null;
      const result = await payoutSingleMerchant(db, { merchantId, actorId, amount });
      results.push({ merchantId, skipped: false, ...result });
    } catch (err) {
      results.push({ merchantId, skipped: true, reason: err.message });
    }
  }

  return { results };
}
