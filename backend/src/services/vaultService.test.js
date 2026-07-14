import { calculateSplit, buildReserveCapsuleDocument, sweepMaturedCapsules } from './vaultService.js';
import { FakeFirestore } from './testUtils/fakeFirestore.js';

describe('calculateSplit — per-tier percentages', () => {
  test('LOW tier (5% reserve, 2% fee) conserves money', () => {
    const result = calculateSplit({ amountGross: 1000, reservePercent: 5, platformFeePercent: 2 });
    expect(result).toEqual({ liquidAllocation: 930, reserveAllocation: 50, feeDeduction: 20 });
    expect(result.liquidAllocation + result.reserveAllocation + result.feeDeduction).toBe(1000);
  });

  test('MEDIUM tier (15% reserve, 2% fee) conserves money', () => {
    const result = calculateSplit({ amountGross: 1000, reservePercent: 15, platformFeePercent: 2 });
    expect(result).toEqual({ liquidAllocation: 830, reserveAllocation: 150, feeDeduction: 20 });
    expect(result.liquidAllocation + result.reserveAllocation + result.feeDeduction).toBe(1000);
  });

  test('HIGH tier (30% reserve, 2% fee) conserves money', () => {
    const result = calculateSplit({ amountGross: 1000, reservePercent: 30, platformFeePercent: 2 });
    expect(result).toEqual({ liquidAllocation: 680, reserveAllocation: 300, feeDeduction: 20 });
    expect(result.liquidAllocation + result.reserveAllocation + result.feeDeduction).toBe(1000);
  });

  test('reservePercent 0 produces a $0.00 reserve allocation', () => {
    const result = calculateSplit({ amountGross: 100, reservePercent: 0, platformFeePercent: 2 });
    expect(result.reserveAllocation).toBe(0);
    expect(result.liquidAllocation).toBe(98);
  });
});

describe('calculateSplit — misconfiguration guard', () => {
  test('throws when reservePercent + platformFeePercent exceeds 100%, producing negative liquid', () => {
    expect(() =>
      calculateSplit({ amountGross: 100, reservePercent: 90, platformFeePercent: 20 })
    ).toThrow(/negative/i);
  });

  test('does not confuse the misconfiguration guard with the chargeback-clawback negative-balance case', () => {
    expect(() =>
      calculateSplit({ amountGross: 100, reservePercent: 90, platformFeePercent: 20 })
    ).toThrow(/not the intentional chargeback-clawback/);
  });
});

describe('calculateSplit — input validation', () => {
  test('throws on non-positive amountGross', () => {
    expect(() => calculateSplit({ amountGross: 0, reservePercent: 5, platformFeePercent: 2 })).toThrow();
  });

  test('throws on out-of-range reservePercent', () => {
    expect(() => calculateSplit({ amountGross: 100, reservePercent: 150, platformFeePercent: 2 })).toThrow();
  });
});

describe('buildReserveCapsuleDocument', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');

  test('produces a correct absolute releaseDate (now + holdDurationMs)', () => {
    const holdDurationMs = 259200000; // T+3 days
    const capsule = buildReserveCapsuleDocument({
      merchantId: 'm1',
      associatedTransactionId: 'tx1',
      amountLocked: 50,
      holdDurationMs,
      now,
    });

    expect(capsule.releaseDate).toBeInstanceOf(Date);
    expect(capsule.releaseDate.getTime()).toBe(now.getTime() + holdDurationMs);
    expect(capsule.createdAt).toBe(now);
    expect(capsule.vaultId).toBeNull();
    expect(capsule.isMatured).toBe(false);
    expect(capsule.merchantId).toBe('m1');
    expect(capsule.associatedTransactionId).toBe('tx1');
    expect(capsule.amountLocked).toBe(50);
  });

  test('throws when amountLocked is 0', () => {
    expect(() =>
      buildReserveCapsuleDocument({
        merchantId: 'm1',
        associatedTransactionId: 'tx1',
        amountLocked: 0,
        holdDurationMs: 259200000,
        now,
      })
    ).toThrow(/amountLocked must be > 0/);
  });

  test('throws when amountLocked is negative', () => {
    expect(() =>
      buildReserveCapsuleDocument({
        merchantId: 'm1',
        associatedTransactionId: 'tx1',
        amountLocked: -10,
        holdDurationMs: 259200000,
        now,
      })
    ).toThrow(/amountLocked must be > 0/);
  });

  test('throws when now is not a Date instance', () => {
    expect(() =>
      buildReserveCapsuleDocument({
        merchantId: 'm1',
        associatedTransactionId: 'tx1',
        amountLocked: 50,
        holdDurationMs: 259200000,
        now: Date.now(),
      })
    ).toThrow(/must be a Date instance/);
  });

  test('throws when holdDurationMs is not positive', () => {
    expect(() =>
      buildReserveCapsuleDocument({
        merchantId: 'm1',
        associatedTransactionId: 'tx1',
        amountLocked: 50,
        holdDurationMs: 0,
        now,
      })
    ).toThrow(/holdDurationMs must be a positive number/);
  });
});

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

async function seedCapsule(db, { vaultId, merchantId, amountLocked, releaseDate, isMatured = false }) {
  await db.collection('reserve_vault').doc(vaultId).set({
    vaultId,
    merchantId,
    associatedTransactionId: 'tx_seed',
    amountLocked,
    releaseDate,
    isMatured,
    createdAt: new Date(releaseDate.getTime() - 259200000),
  });
}

describe('sweepMaturedCapsules', () => {
  test('releases a capsule past its releaseDate and moves lockedEscrow to availableLiquid', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 100, lockedEscrow: 50 });
    await seedCapsule(db, { vaultId: 'v1', merchantId: 'm1', amountLocked: 50, releaseDate: new Date(Date.now() - 1000) });

    const summary = await sweepMaturedCapsules(db);

    expect(summary.released).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.remaining).toBe(false);
    expect(typeof summary.durationMs).toBe('number');

    const vaultSnap = await db.collection('reserve_vault').doc('v1').get();
    expect(vaultSnap.data().isMatured).toBe(true);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().availableLiquid).toBe(150);
    expect(balanceSnap.data().lockedEscrow).toBe(0);
  });

  test('does not touch a capsule whose releaseDate is still in the future', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 100, lockedEscrow: 50 });
    await seedCapsule(db, { vaultId: 'v1', merchantId: 'm1', amountLocked: 50, releaseDate: new Date(Date.now() + 1000000) });

    const summary = await sweepMaturedCapsules(db);

    expect(summary.released).toBe(0);
    expect(summary.failed).toBe(0);

    const vaultSnap = await db.collection('reserve_vault').doc('v1').get();
    expect(vaultSnap.data().isMatured).toBe(false);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().lockedEscrow).toBe(50); // untouched
  });

  test('skips a capsule that is already isMatured by the time its own transaction runs (race)', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 0, lockedEscrow: 100 });
    await seedCapsule(db, { vaultId: 'v1', merchantId: 'm1', amountLocked: 100, releaseDate: new Date(Date.now() - 1000) });

    // Simulate a concurrent process maturing this exact capsule between
    // the batch query and this capsule's own per-capsule transaction —
    // the transaction's internal re-read must catch this and skip cleanly
    // rather than double-releasing or erroring.
    const originalRunTransaction = db.runTransaction.bind(db);
    let callCount = 0;
    db.runTransaction = async (fn, opts) => {
      callCount += 1;
      if (callCount === 1) {
        const existing = db.store.read('reserve_vault', 'v1');
        db.store.commit('reserve_vault', 'v1', { ...existing.data, isMatured: true }, existing.version);
      }
      return originalRunTransaction(fn, opts);
    };

    const summary = await sweepMaturedCapsules(db);

    expect(summary.released).toBe(0); // skipped, not released
    expect(summary.failed).toBe(0); // a skip is not a failure

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().lockedEscrow).toBe(100); // untouched — no double-release
  });

  test('a capsule release that throws is caught, counted as failed, and does not stop the rest of the batch', async () => {
    const db = new FakeFirestore();
    // v1 has no matching merchant_balances doc -> its release will throw.
    await seedCapsule(db, { vaultId: 'v1', merchantId: 'missing-merchant', amountLocked: 50, releaseDate: new Date(Date.now() - 1000) });
    // v2 is a normal, valid capsule that should still succeed.
    await seedBalance(db, 'm2', { availableLiquid: 0, lockedEscrow: 30 });
    await seedCapsule(db, { vaultId: 'v2', merchantId: 'm2', amountLocked: 30, releaseDate: new Date(Date.now() - 1000) });

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const summary = await sweepMaturedCapsules(db);
    errorSpy.mockRestore();

    expect(summary.failed).toBe(1);
    expect(summary.released).toBe(1);

    const v1Snap = await db.collection('reserve_vault').doc('v1').get();
    expect(v1Snap.data().isMatured).toBe(false); // left for retry on the next sweep

    const v2Snap = await db.collection('reserve_vault').doc('v2').get();
    expect(v2Snap.data().isMatured).toBe(true);
  });

  test('runs multiple internal batches and flags remaining when maxBatchesPerRun is hit', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 0, lockedEscrow: 500 });
    for (let i = 0; i < 5; i += 1) {
      await seedCapsule(db, { vaultId: `v${i}`, merchantId: 'm1', amountLocked: 100, releaseDate: new Date(Date.now() - 1000) });
    }

    const summary = await sweepMaturedCapsules(db, { batchSize: 2, maxBatchesPerRun: 2 });

    expect(summary.released).toBe(4); // 2 batches x batchSize 2
    expect(summary.remaining).toBe(true);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().lockedEscrow).toBe(100); // 500 - 4*100
  });

  test('drains all capsules across batches when they fit within maxBatchesPerRun', async () => {
    const db = new FakeFirestore();
    await seedBalance(db, 'm1', { availableLiquid: 0, lockedEscrow: 500 });
    for (let i = 0; i < 5; i += 1) {
      await seedCapsule(db, { vaultId: `v${i}`, merchantId: 'm1', amountLocked: 100, releaseDate: new Date(Date.now() - 1000) });
    }

    const summary = await sweepMaturedCapsules(db, { batchSize: 2, maxBatchesPerRun: 10 });

    expect(summary.released).toBe(5);
    expect(summary.remaining).toBe(false);

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data().lockedEscrow).toBe(0);
  });
});
