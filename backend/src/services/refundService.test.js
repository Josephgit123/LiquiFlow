import { processRefund } from './refundService.js';
import { FakeFirestore } from './testUtils/fakeFirestore.js';

async function seedBalance(db, merchantId, { availableLiquid = 0, lockedEscrow = 0, currency = 'USD' } = {}) {
  await db.collection('merchant_balances').doc(merchantId).set({
    merchantId,
    availableLiquid,
    lockedEscrow,
    totalWithdrawn: 0,
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
    splitLiquidAmount: amountGross * 0.95,
    splitReserveAmount: amountGross * 0.05,
    platformFeeDeduction: 0,
    status,
    receiptHash: 'tx_hash_seed',
    timestamp: new Date(),
  });
}

describe('processRefund — happy path', () => {
  test('refunds a CAPTURED transaction: balance decreases, status flips, a refund-event doc is written', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 1000, lockedEscrow: 50 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 1000 });

    const result = await processRefund(db, {
      merchantId: 'm1',
      transactionId: 'tx1',
      refundAmount: 1000,
      reason: 'customer request',
      idempotencyKey: 'rf_1',
    });

    expect(result.wasIdempotentReplay).toBe(false);
    expect(result.originalTransactionId).toBe('tx1');
    expect(result.refundAmount).toBe(1000);
    expect(result.newAvailableLiquid).toBe(0);
    expect(result.refundTransactionId).toBeTruthy();

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(0);
    expect(balanceSnap.data().lockedEscrow).toBe(50); // never touched by a refund

    const originalSnap = await db.collection('transactions').doc('tx1').get();
    expect(originalSnap.data().status).toBe('REFUNDED');
    expect(originalSnap.data().amountGross).toBe(1000); // all other fields immutable

    const refundSnap = await db.collection('transactions').doc(result.refundTransactionId).get();
    expect(refundSnap.data()).toMatchObject({
      merchantId: 'm1',
      associatedTransactionId: 'tx1',
      refundAmount: 1000,
      reason: 'customer request',
      status: 'REFUNDED',
      idempotencyKey: 'rf_1',
    });
  });
});

describe('processRefund — liquidity check', () => {
  test('rejects when refundAmount exceeds availableLiquid; nothing is written', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 500, lockedEscrow: 0 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 1000 });

    await expect(
      processRefund(db, { merchantId: 'm1', transactionId: 'tx1', refundAmount: 1000, idempotencyKey: 'rf_2' })
    ).rejects.toThrow(/exceeds availableLiquid/);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(500);
    expect(balanceSnap.data().lockedEscrow).toBe(0);

    const originalSnap = await db.collection('transactions').doc('tx1').get();
    expect(originalSnap.data().status).toBe('CAPTURED');

    expect(db.store.readAll('transactions')).toHaveLength(1); // no refund-event doc written
  });
});

describe('processRefund — eligibility (status)', () => {
  test('rejects a transaction already in REFUNDED status (409-mapped upstream)', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 1000 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 1000, status: 'REFUNDED' });

    await expect(
      processRefund(db, { merchantId: 'm1', transactionId: 'tx1', refundAmount: 1000, idempotencyKey: 'rf_3' })
    ).rejects.toThrow(/is not eligible for refund/);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(1000); // untouched
  });

  test('rejects a transaction already in DISPUTED status (409-mapped upstream)', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 1000 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 1000, status: 'DISPUTED' });

    await expect(
      processRefund(db, { merchantId: 'm1', transactionId: 'tx1', refundAmount: 1000, idempotencyKey: 'rf_4' })
    ).rejects.toThrow(/is not eligible for refund/);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(1000); // untouched
  });
});

describe('processRefund — ownership', () => {
  test('rejects when the transaction belongs to a different merchant (defense in depth)', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 1000 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'someone-else', amountGross: 1000 });

    await expect(
      processRefund(db, { merchantId: 'm1', transactionId: 'tx1', refundAmount: 1000, idempotencyKey: 'rf_owner' })
    ).rejects.toThrow(/does not belong to merchant/);
  });
});

describe('processRefund — full-refund-only amount rule', () => {
  test('rejects a refundAmount that does not exactly equal the original amountGross', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 1000 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 1000 });

    await expect(
      processRefund(db, { merchantId: 'm1', transactionId: 'tx1', refundAmount: 500, idempotencyKey: 'rf_partial' })
    ).rejects.toThrow(/must exactly equal/);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(1000); // untouched
  });
});

describe('processRefund — idempotency', () => {
  test('a repeated idempotencyKey does not double-subtract and returns wasIdempotentReplay true', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 1000 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 1000 });
    const params = { merchantId: 'm1', transactionId: 'tx1', refundAmount: 1000, idempotencyKey: 'rf_dup' };

    const first = await processRefund(db, params);
    const second = await processRefund(db, params);

    expect(first.wasIdempotentReplay).toBe(false);
    expect(second.wasIdempotentReplay).toBe(true);
    expect(second.refundTransactionId).toBe(first.refundTransactionId);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(0); // subtracted exactly once
  });
});

describe('processRefund — concurrency', () => {
  test('two concurrent refund attempts on the same transaction: exactly one succeeds, the other is rejected', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 1000 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 1000 });

    const outcomes = await Promise.allSettled([
      processRefund(db, { merchantId: 'm1', transactionId: 'tx1', refundAmount: 1000, idempotencyKey: 'rf_a' }),
      processRefund(db, { merchantId: 'm1', transactionId: 'tx1', refundAmount: 1000, idempotencyKey: 'rf_b' }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.message).toMatch(/is not eligible for refund/);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(0); // refunded exactly once, not twice

    const originalSnap = await db.collection('transactions').doc('tx1').get();
    expect(originalSnap.data().status).toBe('REFUNDED');

    // original + exactly one refund-event document
    expect(db.store.readAll('transactions')).toHaveLength(2);
  });
});
