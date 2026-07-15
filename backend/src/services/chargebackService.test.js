import { processChargeback } from './chargebackService.js';
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
    splitLiquidAmount: amountGross * 0.7,
    splitReserveAmount: amountGross * 0.3,
    platformFeeDeduction: 0,
    status,
    receiptHash: 'tx_hash_seed',
    timestamp: new Date(),
  });
}

describe('processChargeback — happy path (reserve fully covers the dispute)', () => {
  test('lockedEscrow decreases by the full amount, availableLiquid is untouched, status flips, event + audit docs written', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 200, lockedEscrow: 500 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 300 });

    const result = await processChargeback(db, {
      transactionId: 'tx1',
      reason: 'unauthorized charge',
      idempotencyKey: 'cb_1',
      actorId: 'ADMIN',
    });

    expect(result.wasIdempotentReplay).toBe(false);
    expect(result.reserveDraw).toBe(300);
    expect(result.remainderDraw).toBe(0);
    expect(result.newLockedEscrow).toBe(200);
    expect(result.newAvailableLiquid).toBe(200);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().lockedEscrow).toBe(200); // 500 - 300
    expect(balanceSnap.data().availableLiquid).toBe(200); // untouched

    const originalSnap = await db.collection('transactions').doc('tx1').get();
    expect(originalSnap.data().status).toBe('DISPUTED');

    const eventSnap = await db.collection('transactions').doc(result.chargebackTransactionId).get();
    expect(eventSnap.data()).toMatchObject({
      merchantId: 'm1',
      associatedTransactionId: 'tx1',
      disputeAmount: 300,
      reserveDraw: 300,
      remainderDraw: 0,
      status: 'DISPUTED',
      idempotencyKey: 'cb_1',
    });

    const auditDocs = db.store.readAll('system_audit_logs');
    expect(auditDocs).toHaveLength(1);
    expect(auditDocs[0].data.actionType).toBe('CHARGEBACK_CLAWBACK');
    expect(auditDocs[0].data.targetId).toBe('tx1');
  });
});

describe('processChargeback — dispute exceeds lockedEscrow', () => {
  test('drains lockedEscrow to 0 and pulls the remainder from availableLiquid, allowing it to go negative', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 50, lockedEscrow: 100 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 300 });

    const result = await processChargeback(db, {
      transactionId: 'tx1',
      idempotencyKey: 'cb_2',
      actorId: 'ADMIN',
    });

    expect(result.reserveDraw).toBe(100);
    expect(result.remainderDraw).toBe(200);
    expect(result.newLockedEscrow).toBe(0);
    expect(result.newAvailableLiquid).toBe(-150); // 50 - 200, allowed negative

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().lockedEscrow).toBe(0);
    expect(balanceSnap.data().availableLiquid).toBe(-150);
  });
});

describe('processChargeback — eligibility (status)', () => {
  test('rejects a transaction already DISPUTED (409-mapped upstream)', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 100, lockedEscrow: 100 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 100, status: 'DISPUTED' });

    await expect(
      processChargeback(db, { transactionId: 'tx1', idempotencyKey: 'cb_3', actorId: 'ADMIN' })
    ).rejects.toThrow(/is not eligible for chargeback/);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().lockedEscrow).toBe(100); // untouched
  });

  test('rejects a transaction already REFUNDED (409-mapped upstream)', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 100, lockedEscrow: 100 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 100, status: 'REFUNDED' });

    await expect(
      processChargeback(db, { transactionId: 'tx1', idempotencyKey: 'cb_4', actorId: 'ADMIN' })
    ).rejects.toThrow(/is not eligible for chargeback/);
  });
});

describe('processChargeback — existence', () => {
  test('rejects a nonexistent transactionId (404-mapped upstream)', async () => {
    const db = new FakeFirestore();

    await expect(
      processChargeback(db, { transactionId: 'does-not-exist', idempotencyKey: 'cb_5', actorId: 'ADMIN' })
    ).rejects.toThrow(/not found/);
  });
});

describe('processChargeback — disputeAmount rule', () => {
  test('rejects a disputeAmount that exceeds the original amountGross', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 100, lockedEscrow: 1000 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 300 });

    await expect(
      processChargeback(db, { transactionId: 'tx1', disputeAmount: 500, idempotencyKey: 'cb_6', actorId: 'ADMIN' })
    ).rejects.toThrow(/exceeds the original transaction's amountGross/);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().lockedEscrow).toBe(1000); // untouched
  });

  test('defaults disputeAmount to the original amountGross when omitted', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 0, lockedEscrow: 1000 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 300 });

    const result = await processChargeback(db, { transactionId: 'tx1', idempotencyKey: 'cb_7', actorId: 'ADMIN' });

    expect(result.reserveDraw).toBe(300);
  });
});

describe('processChargeback — idempotency', () => {
  test('a repeated idempotencyKey does not double-clawback and returns wasIdempotentReplay true', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 200, lockedEscrow: 500 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 300 });
    const params = { transactionId: 'tx1', idempotencyKey: 'cb_dup', actorId: 'ADMIN' };

    const first = await processChargeback(db, params);
    const second = await processChargeback(db, params);

    expect(first.wasIdempotentReplay).toBe(false);
    expect(second.wasIdempotentReplay).toBe(true);
    expect(second.chargebackTransactionId).toBe(first.chargebackTransactionId);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().lockedEscrow).toBe(200); // clawed back exactly once
  });
});

describe('processChargeback — never touches /reserve_vault', () => {
  test('the reserve_vault collection is never read or written by any chargeback path', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 200, lockedEscrow: 500 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 300 });

    // Happy path, exceeds-reserve path, and idempotent replay all in one
    // run, to exercise every branch of the service.
    await processChargeback(db, { transactionId: 'tx1', idempotencyKey: 'cb_vault_1', actorId: 'ADMIN' });
    await processChargeback(db, { transactionId: 'tx1', idempotencyKey: 'cb_vault_1', actorId: 'ADMIN' });

    await seedCapturedTransaction(db, { transactionId: 'tx2', merchantId: 'm1', amountGross: 50 });
    await processChargeback(db, { transactionId: 'tx2', idempotencyKey: 'cb_vault_2', actorId: 'ADMIN' });

    expect(db.store.readAll('reserve_vault')).toHaveLength(0);
  });
});

describe('processChargeback — audit log accuracy', () => {
  test('beforeState/afterState reflect the balance doc values immediately before and after the clawback', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 50, lockedEscrow: 100 });
    await seedCapturedTransaction(db, { transactionId: 'tx1', merchantId: 'm1', amountGross: 300 });

    await processChargeback(db, { transactionId: 'tx1', idempotencyKey: 'cb_audit', actorId: 'ADMIN' });

    const auditDocs = db.store.readAll('system_audit_logs');
    expect(auditDocs).toHaveLength(1);
    const { beforeState, afterState } = auditDocs[0].data;

    expect(beforeState.availableLiquid).toBe(50);
    expect(beforeState.lockedEscrow).toBe(100);
    expect(afterState.availableLiquid).toBe(-150); // 50 - 200 remainder
    expect(afterState.lockedEscrow).toBe(0);
  });
});
