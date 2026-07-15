import { processTransactionSettlement } from './settlementService.js';
import { FakeFirestore } from './testUtils/fakeFirestore.js';

async function seedMerchant(db, { merchantId = 'm1', currency = 'USD', availableLiquid = 0, lockedEscrow = 0, accountStatus = 'ACTIVE' } = {}) {
  await db.collection('merchant_balances').doc(merchantId).set({
    merchantId,
    availableLiquid,
    lockedEscrow,
    totalWithdrawn: 0,
    currency,
    lastUpdated: new Date(),
  });
  await db.collection('merchants').doc(merchantId).set({
    merchantId,
    accountStatus,
  });
}

function baseParams(overrides = {}) {
  return {
    merchantId: 'm1',
    amountGross: 1000,
    currency: 'USD',
    riskScoreCalculated: 20,
    effectiveTier: 'LOW',
    reservePercent: 5,
    holdDurationMs: 259200000,
    platformFeePercent: 2,
    idempotencyKey: 'evt_1',
    ...overrides,
  };
}

describe('processTransactionSettlement — happy path', () => {
  test('updates balance and writes correct transaction + vault documents', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);

    const result = await processTransactionSettlement(db, baseParams());

    expect(result.wasIdempotentReplay).toBe(false);
    expect(result.liquidAllocation).toBe(930);
    expect(result.reserveAllocation).toBe(50);
    expect(result.feeDeduction).toBe(20);
    expect(result.vaultId).not.toBeNull();

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(930);
    expect(balanceSnap.data().lockedEscrow).toBe(50);

    const txSnap = await db.collection('transactions').doc(result.transactionId).get();
    expect(txSnap.exists).toBe(true);
    expect(txSnap.data()).toMatchObject({
      merchantId: 'm1',
      amountGross: 1000,
      riskScoreCalculated: 20,
      splitLiquidAmount: 930,
      splitReserveAmount: 50,
      platformFeeDeduction: 20,
      status: 'CAPTURED',
      idempotencyKey: 'evt_1',
    });

    const vaultSnap = await db.collection('reserve_vault').doc(result.vaultId).get();
    expect(vaultSnap.exists).toBe(true);
    expect(vaultSnap.data()).toMatchObject({
      merchantId: 'm1',
      associatedTransactionId: result.transactionId,
      amountLocked: 50,
      isMatured: false,
    });
    expect(vaultSnap.data().releaseDate.getTime() - vaultSnap.data().createdAt.getTime()).toBe(259200000);
  });
});

describe('processTransactionSettlement — zero-reserve split', () => {
  test('skips vault capsule creation when reserveAllocation is exactly 0', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);

    const result = await processTransactionSettlement(
      db,
      baseParams({ reservePercent: 0, idempotencyKey: 'evt_zero_reserve' })
    );

    expect(result.reserveAllocation).toBe(0);
    expect(result.vaultId).toBeNull();

    const vaultDocs = db.store.readAll('reserve_vault');
    expect(vaultDocs).toHaveLength(0);
  });
});

describe('processTransactionSettlement — idempotency', () => {
  test('a duplicate idempotencyKey does not double-credit the balance', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);
    const params = baseParams({ idempotencyKey: 'evt_dup' });

    const first = await processTransactionSettlement(db, params);
    const second = await processTransactionSettlement(db, params);

    expect(first.wasIdempotentReplay).toBe(false);
    expect(second.wasIdempotentReplay).toBe(true);
    expect(second.transactionId).toBe(first.transactionId);
    expect(second.vaultId).toBe(first.vaultId);
    expect(second.liquidAllocation).toBe(first.liquidAllocation);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(930); // credited once, not twice
    expect(balanceSnap.data().lockedEscrow).toBe(50);

    expect(db.store.readAll('transactions')).toHaveLength(1);
    expect(db.store.readAll('reserve_vault')).toHaveLength(1);
  });
});

describe('processTransactionSettlement — validation failures write nothing', () => {
  test('currency mismatch throws and leaves balance untouched', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { currency: 'USD' });

    await expect(
      processTransactionSettlement(db, baseParams({ currency: 'EUR' }))
    ).rejects.toThrow(/currency mismatch/);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(0);
    expect(db.store.readAll('transactions')).toHaveLength(0);
  });

  test('missing merchant balance profile throws and writes nothing', async () => {
    const db = new FakeFirestore();
    // deliberately not seeding merchant_balances/m1

    await expect(processTransactionSettlement(db, baseParams())).rejects.toThrow(
      /not initialized/
    );

    expect(db.store.readAll('transactions')).toHaveLength(0);
    expect(db.store.readAll('reserve_vault')).toHaveLength(0);
  });

  test('non-ACTIVE merchant accountStatus throws and writes nothing', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { accountStatus: 'SUSPENDED' });

    await expect(processTransactionSettlement(db, baseParams())).rejects.toThrow(/not ACTIVE/);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(0);
    expect(db.store.readAll('transactions')).toHaveLength(0);
  });
});

describe('processTransactionSettlement — concurrency', () => {
  test('two settlements racing on the same merchant both land correctly in the final balance', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { availableLiquid: 0, lockedEscrow: 0 });

    const paramsA = baseParams({ amountGross: 100, reservePercent: 10, platformFeePercent: 2, idempotencyKey: 'evt_a' });
    const paramsB = baseParams({ amountGross: 100, reservePercent: 10, platformFeePercent: 2, idempotencyKey: 'evt_b' });

    const [resultA, resultB] = await Promise.all([
      processTransactionSettlement(db, paramsA),
      processTransactionSettlement(db, paramsB),
    ]);

    // Each individual settlement computed its own correct split...
    expect(resultA.liquidAllocation).toBe(88);
    expect(resultB.liquidAllocation).toBe(88);
    expect(resultA.transactionId).not.toBe(resultB.transactionId);

    // ...and neither lost the other's update to a race (the reason
    // CLAUDE.md invariant #2 requires runTransaction with a re-read).
    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(176); // 88 + 88, not 88
    expect(balanceSnap.data().lockedEscrow).toBe(20); // 10 + 10, not 10

    expect(db.store.readAll('transactions')).toHaveLength(2);
    expect(db.store.readAll('reserve_vault')).toHaveLength(2);
  });
});
