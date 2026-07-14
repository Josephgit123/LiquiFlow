import { executeSettlementBatch } from './settlementBatchService.js';
import { processChargeback } from './chargebackService.js';
import { FakeFirestore } from './testUtils/fakeFirestore.js';

async function seedBalance(db, merchantId, { availableLiquid = 0, lockedEscrow = 0, totalWithdrawn = 0, currency = 'USD' } = {}) {
  await db.collection('merchant_balances').doc(merchantId).set({
    merchantId,
    availableLiquid,
    lockedEscrow,
    totalWithdrawn,
    currency,
    lastUpdated: new Date(),
  });
}

async function seedCapturedTransaction(db, { transactionId, merchantId, amountGross, status = 'CAPTURED' }) {
  await db.collection('transactions').doc(transactionId).set({
    transactionId,
    merchantId,
    amountGross,
    riskScoreCalculated: 10,
    splitLiquidAmount: amountGross * 0.7,
    splitReserveAmount: amountGross * 0.3,
    platformFeeDeduction: 0,
    status,
    receiptHash: 'tx_hash_seed',
    timestamp: new Date(),
  });
}

describe('executeSettlementBatch — payout math', () => {
  test('zeroes out availableLiquid and increments totalWithdrawn when no amount is specified', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 1000, totalWithdrawn: 200 });

    const result = await executeSettlementBatch(db, { merchantIds: ['m1'], actorId: 'ADMIN' });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].skipped).toBe(false);
    expect(result.results[0].newAvailableLiquid).toBe(0);
    expect(result.results[0].newTotalWithdrawn).toBe(1200);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(0);
    expect(balanceSnap.data().totalWithdrawn).toBe(1200);

    const payoutsSnap = await db.collection('payouts').get();
    expect(payoutsSnap.docs).toHaveLength(1);
    expect(payoutsSnap.docs[0].data().amount).toBe(1000);

    const logsSnap = await db.collection('system_audit_logs').get();
    expect(logsSnap.docs).toHaveLength(1);
    expect(logsSnap.docs[0].data().actionType).toBe('ADMIN_SETTLEMENT_PAYOUT');
  });

  test('reduces by a specified amount, leaving a remainder in availableLiquid', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 1000 });

    const result = await executeSettlementBatch(db, {
      merchantIds: ['m1'],
      amounts: { m1: 300 },
      actorId: 'ADMIN',
    });

    expect(result.results[0].newAvailableLiquid).toBe(700);
    expect(result.results[0].newTotalWithdrawn).toBe(300);
  });

  test('rejects (skips, does not abort the batch) a payout exceeding availableLiquid', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 100 });
    await seedBalance(db, 'm2', { availableLiquid: 500 });

    const result = await executeSettlementBatch(db, {
      merchantIds: ['m1', 'm2'],
      amounts: { m1: 1000 },
      actorId: 'ADMIN',
    });

    const m1Result = result.results.find((r) => r.merchantId === 'm1');
    const m2Result = result.results.find((r) => r.merchantId === 'm2');
    expect(m1Result.skipped).toBe(true);
    expect(m1Result.reason).toMatch(/exceeds availableLiquid/);
    expect(m2Result.skipped).toBe(false);

    const m1Balance = await db.collection('merchant_balances').doc('m1').get();
    expect(m1Balance.data().availableLiquid).toBe(100); // untouched
  });

  test('scans for availableLiquid > 0 when no merchantIds are given', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 50 });
    await seedBalance(db, 'm2', { availableLiquid: 0 });

    const result = await executeSettlementBatch(db, { actorId: 'ADMIN' });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].merchantId).toBe('m1');
  });
});

describe('executeSettlementBatch — scope boundary vs. chargeback clawback', () => {
  test('running a settlement batch payout does not interfere with a chargeback clawback pushing availableLiquid negative', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 100, lockedEscrow: 50 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 300 });

    // First, pay out the merchant's full current availableLiquid via the
    // new voluntary-payout path.
    await executeSettlementBatch(db, { merchantIds: ['m1'], actorId: 'ADMIN' });
    let balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(0);

    // Then run a chargeback clawback for MORE than what's left in reserve
    // — chargebackService.js (untouched) must still be allowed to push
    // availableLiquid negative, completely unaffected by this file's
    // zero-floor rule.
    const chargeback = await processChargeback(db, {
      transactionId: 'tx1',
      disputeAmount: 300,
      reason: 'unauthorized',
      idempotencyKey: 'cb_1',
      actorId: 'ADMIN',
    });

    expect(chargeback.reserveDraw).toBe(50); // all of lockedEscrow
    expect(chargeback.remainderDraw).toBe(250); // the rest from availableLiquid
    expect(chargeback.newAvailableLiquid).toBe(-250); // negative, and that's correct
    expect(chargeback.newLockedEscrow).toBe(0);

    balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(-250);
  });
});
