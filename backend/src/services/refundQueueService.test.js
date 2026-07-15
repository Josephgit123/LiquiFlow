import { listRefundQueue, denyRefund } from './refundQueueService.js';
import { FakeFirestore } from './testUtils/fakeFirestore.js';

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

describe('listRefundQueue — clearly-labeled placeholder', () => {
  test('surfaces CAPTURED transactions and flags itself as a placeholder', async () => {
    const db = new FakeFirestore();
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 100 });
    await seedCapturedTransaction(db, { transactionId: 'tx2', merchantId: 'm1', amountGross: 200, status: 'REFUNDED' });

    const result = await listRefundQueue(db, {});

    expect(result.isPlaceholder).toBe(true);
    expect(result.placeholderNote).toMatch(/PENDING_APPROVAL/);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].transactionId).toBe('tx1');
  });
});

describe('denyRefund', () => {
  test('logs the denial, notifies the merchant, and never touches the transaction status', async () => {
    const db = new FakeFirestore();
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 100 });

    const result = await denyRefund(db, { transactionId: 'tx1', reason: 'Suspicious pattern', actorId: 'ADMIN' });

    expect(result.status).toBe('CAPTURED');
    expect(result.denialReason).toBe('Suspicious pattern');

    const txSnap = await db.collection('transactions').doc('tx1').get();
    expect(txSnap.data().status).toBe('CAPTURED'); // untouched

    const logsSnap = await db.collection('system_audit_logs').get();
    expect(logsSnap.docs).toHaveLength(1);
    expect(logsSnap.docs[0].data().actionType).toBe('ADMIN_DENIED_REFUND');

    const notificationsSnap = await db.collection('notifications').get();
    expect(notificationsSnap.docs).toHaveLength(1);
    expect(notificationsSnap.docs[0].data().merchantId).toBe('m1');
    expect(notificationsSnap.docs[0].data().category).toBe('REFUND_DENIED');
  });

  test('rejects a nonexistent transactionId', async () => {
    const db = new FakeFirestore();
    await expect(
      denyRefund(db, { transactionId: 'does-not-exist', reason: 'x', actorId: 'ADMIN' })
    ).rejects.toThrow(/not found/);
  });
});
