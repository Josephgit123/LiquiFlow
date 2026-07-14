import { FieldValue } from 'firebase-admin/firestore';
import { normalizeCurrency } from '../utils/currency.js';
import { calculateSplit, buildReserveCapsuleDocument } from './vaultService.js';

const VALID_TIERS = ['LOW', 'MEDIUM', 'HIGH'];

function validateParams(params) {
  const p = params || {};

  if (!p.merchantId || typeof p.merchantId !== 'string') {
    throw new Error('processTransactionSettlement: merchantId must be a non-empty string.');
  }
  if (typeof p.amountGross !== 'number' || !Number.isFinite(p.amountGross) || p.amountGross <= 0) {
    throw new Error(`processTransactionSettlement: amountGross must be a positive number, got ${p.amountGross}.`);
  }
  if (!p.currency || typeof p.currency !== 'string') {
    throw new Error('processTransactionSettlement: currency must be a non-empty string.');
  }
  if (
    typeof p.riskScoreCalculated !== 'number' ||
    !Number.isFinite(p.riskScoreCalculated) ||
    p.riskScoreCalculated < 0 ||
    p.riskScoreCalculated > 100
  ) {
    throw new Error(
      `processTransactionSettlement: riskScoreCalculated must be a number in [0, 100], got ${p.riskScoreCalculated}.`
    );
  }
  if (!VALID_TIERS.includes(p.effectiveTier)) {
    throw new Error(
      `processTransactionSettlement: effectiveTier must be one of ${VALID_TIERS.join(', ')}, got "${p.effectiveTier}".`
    );
  }
  if (typeof p.reservePercent !== 'number' || !Number.isFinite(p.reservePercent) || p.reservePercent < 0 || p.reservePercent > 100) {
    throw new Error(`processTransactionSettlement: reservePercent must be a number in [0, 100], got ${p.reservePercent}.`);
  }
  if (typeof p.holdDurationMs !== 'number' || !Number.isFinite(p.holdDurationMs) || p.holdDurationMs <= 0) {
    throw new Error(`processTransactionSettlement: holdDurationMs must be a positive number, got ${p.holdDurationMs}.`);
  }
  // Caller resolves this from /system_configuration (defaulting to 2 there
  // if unconfigured) — this function never hardcodes a fee rate itself.
  if (typeof p.platformFeePercent !== 'number' || !Number.isFinite(p.platformFeePercent) || p.platformFeePercent < 0 || p.platformFeePercent > 100) {
    throw new Error(
      `processTransactionSettlement: platformFeePercent must be a number in [0, 100], got ${p.platformFeePercent}.`
    );
  }
  if (!p.idempotencyKey || typeof p.idempotencyKey !== 'string') {
    throw new Error('processTransactionSettlement: idempotencyKey must be a non-empty string.');
  }

  return p;
}

/**
 * Atomic transaction sequence processing the liquid/reserve split for a
 * single captured transaction. Does NOT call riskEngine.js — risk score
 * and effective tier are resolved upstream and passed in as already-
 * computed input, keeping this module independently testable.
 *
 * Runs entirely inside a single db.runTransaction callback (CLAUDE.md
 * invariant #2), re-reading /merchant_balances inside the transaction to
 * avoid race conditions between concurrent settlements on the same
 * merchant.
 */
export async function processTransactionSettlement(db, params) {
  const {
    merchantId,
    amountGross,
    currency,
    riskScoreCalculated,
    effectiveTier,
    reservePercent,
    holdDurationMs,
    platformFeePercent,
    idempotencyKey,
  } = validateParams(params);

  const balanceRef = db.collection('merchant_balances').doc(merchantId);
  const merchantRef = db.collection('merchants').doc(merchantId);
  const transactionsCollection = db.collection('transactions');
  const vaultCollection = db.collection('reserve_vault');

  return db.runTransaction(async (transaction) => {
    const balanceDoc = await transaction.get(balanceRef);
    if (!balanceDoc.exists) {
      throw new Error(
        `processTransactionSettlement: merchant balance profile not initialized for merchantId "${merchantId}" — merchant must complete onboarding first.`
      );
    }
    const currentBalances = balanceDoc.data();

    if (currentBalances.currency !== currency) {
      throw new Error(
        `processTransactionSettlement: currency mismatch — request specified "${currency}" but merchant balance is denominated in "${currentBalances.currency}".`
      );
    }

    // Idempotency check happens before any writes, inside the same
    // transaction, so a concurrent duplicate capture can never race past
    // this check and double-process.
    const existingSnapshot = await transaction.get(
      transactionsCollection.where('idempotencyKey', '==', idempotencyKey)
    );
    if (!existingSnapshot.empty) {
      const existingDoc = existingSnapshot.docs[0];
      const existingData = existingDoc.data();

      const existingVaultSnapshot = await transaction.get(
        vaultCollection.where('associatedTransactionId', '==', existingDoc.id)
      );
      const existingVaultId = existingVaultSnapshot.empty ? null : existingVaultSnapshot.docs[0].id;

      return {
        transactionId: existingDoc.id,
        vaultId: existingVaultId,
        liquidAllocation: existingData.splitLiquidAmount,
        reserveAllocation: existingData.splitReserveAmount,
        feeDeduction: existingData.platformFeeDeduction,
        wasIdempotentReplay: true,
      };
    }

    // Settlement is a real money-moving path, so the ACTIVE gate is
    // enforced here as the authoritative check (in addition to whatever
    // route middleware also enforces) — see summary for the reasoning.
    const merchantDoc = await transaction.get(merchantRef);
    if (!merchantDoc.exists) {
      throw new Error(`processTransactionSettlement: merchant profile not found for merchantId "${merchantId}".`);
    }
    if (merchantDoc.data().accountStatus !== 'ACTIVE') {
      throw new Error(
        `processTransactionSettlement: merchant accountStatus is "${merchantDoc.data().accountStatus}", not ACTIVE — settlement blocked.`
      );
    }

    const { liquidAllocation, reserveAllocation, feeDeduction } = calculateSplit({
      amountGross,
      reservePercent,
      platformFeePercent,
    });

    transaction.update(balanceRef, {
      availableLiquid: normalizeCurrency(currentBalances.availableLiquid + liquidAllocation),
      lockedEscrow: normalizeCurrency(currentBalances.lockedEscrow + reserveAllocation),
      lastUpdated: FieldValue.serverTimestamp(),
    });

    const txRef = transactionsCollection.doc();
    transaction.set(txRef, {
      transactionId: txRef.id,
      merchantId,
      amountGross: normalizeCurrency(amountGross),
      riskScoreCalculated,
      splitLiquidAmount: liquidAllocation,
      splitReserveAmount: reserveAllocation,
      platformFeeDeduction: feeDeduction,
      status: 'CAPTURED',
      // TODO: replace with a real cryptographic hash of the transaction
      // content (see PAYMENT_FLOW.md reference implementation) if this
      // field is ever used for actual integrity verification — this is
      // still the reference implementation's randomized placeholder style.
      receiptHash: 'tx_hash_' + Math.random().toString(36).substring(2, 15),
      // Not yet part of DATABASE_SCHEMA.md's /transactions table — added
      // here to make settlement idempotent. Flagged for a schema doc update.
      idempotencyKey,
      timestamp: FieldValue.serverTimestamp(),
    });

    let vaultId = null;
    if (reserveAllocation > 0) {
      const vaultRef = vaultCollection.doc();
      const capsule = buildReserveCapsuleDocument({
        merchantId,
        associatedTransactionId: txRef.id,
        amountLocked: reserveAllocation,
        holdDurationMs,
        now: new Date(),
      });
      transaction.set(vaultRef, { ...capsule, vaultId: vaultRef.id });
      vaultId = vaultRef.id;
    }
    // else: reserveAllocation rounded to exactly $0.00 (e.g. an admin
    // override tier with reservePercent 0) — skip capsule creation
    // entirely rather than writing a zero-value reserve_vault document.

    return {
      transactionId: txRef.id,
      vaultId,
      liquidAllocation,
      reserveAllocation,
      feeDeduction,
      wasIdempotentReplay: false,
    };
  });
}
