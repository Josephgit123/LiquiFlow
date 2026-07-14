import { listTransactionsForMerchant } from './transactionQueryService.js';
import { FakeFirestore } from './testUtils/fakeFirestore.js';

async function seedTransaction(db, { transactionId, merchantId, amountGross, riskScoreCalculated, status = 'CAPTURED', timestamp }) {
  await db.collection('transactions').doc(transactionId).set({
    transactionId,
    merchantId,
    amountGross,
    riskScoreCalculated,
    splitLiquidAmount: amountGross * 0.9,
    splitReserveAmount: amountGross * 0.1,
    platformFeeDeduction: 0,
    status,
    receiptHash: 'tx_hash_seed',
    timestamp,
  });
}

describe('listTransactionsForMerchant — scoping and pagination', () => {
  test('only returns the given merchantId\'s transactions, newest first', async () => {
    const db = new FakeFirestore();
    await seedTransaction(db, { transactionId: 't1', merchantId: 'm1', amountGross: 100, riskScoreCalculated: 10, timestamp: new Date('2026-01-01') });
    await seedTransaction(db, { transactionId: 't2', merchantId: 'm1', amountGross: 200, riskScoreCalculated: 10, timestamp: new Date('2026-01-02') });
    await seedTransaction(db, { transactionId: 't3', merchantId: 'm2', amountGross: 300, riskScoreCalculated: 10, timestamp: new Date('2026-01-03') });

    const result = await listTransactionsForMerchant(db, { merchantId: 'm1' });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].transactionId).toBe('t2'); // newest first
    expect(result.items[1].transactionId).toBe('t1');
  });

  test('paginates with limit/offset and computes hasMore', async () => {
    const db = new FakeFirestore();
    for (let i = 0; i < 5; i += 1) {
      await seedTransaction(db, {
        transactionId: `t${i}`,
        merchantId: 'm1',
        amountGross: 100,
        riskScoreCalculated: 10,
        timestamp: new Date(2026, 0, i + 1),
      });
    }

    const page1 = await listTransactionsForMerchant(db, { merchantId: 'm1', limit: 2, offset: 0 });
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    const page3 = await listTransactionsForMerchant(db, { merchantId: 'm1', limit: 2, offset: 4 });
    expect(page3.items).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
  });
});

describe('listTransactionsForMerchant — filters', () => {
  test('filters by status', async () => {
    const db = new FakeFirestore();
    await seedTransaction(db, { transactionId: 't1', merchantId: 'm1', amountGross: 100, riskScoreCalculated: 10, status: 'CAPTURED', timestamp: new Date('2026-01-01') });
    await seedTransaction(db, { transactionId: 't2', merchantId: 'm1', amountGross: 200, riskScoreCalculated: 10, status: 'REFUNDED', timestamp: new Date('2026-01-02') });

    const result = await listTransactionsForMerchant(db, { merchantId: 'm1', status: 'REFUNDED' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].transactionId).toBe('t2');
  });

  test('filters by transactionId', async () => {
    const db = new FakeFirestore();
    await seedTransaction(db, { transactionId: 't1', merchantId: 'm1', amountGross: 100, riskScoreCalculated: 10, timestamp: new Date('2026-01-01') });
    await seedTransaction(db, { transactionId: 't2', merchantId: 'm1', amountGross: 200, riskScoreCalculated: 10, timestamp: new Date('2026-01-02') });

    const result = await listTransactionsForMerchant(db, { merchantId: 'm1', transactionId: 't1' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].transactionId).toBe('t1');
  });

  test('filters by riskMin/riskMax range', async () => {
    const db = new FakeFirestore();
    await seedTransaction(db, { transactionId: 't1', merchantId: 'm1', amountGross: 100, riskScoreCalculated: 10, timestamp: new Date('2026-01-01') });
    await seedTransaction(db, { transactionId: 't2', merchantId: 'm1', amountGross: 100, riskScoreCalculated: 50, timestamp: new Date('2026-01-02') });
    await seedTransaction(db, { transactionId: 't3', merchantId: 'm1', amountGross: 100, riskScoreCalculated: 90, timestamp: new Date('2026-01-03') });

    const result = await listTransactionsForMerchant(db, { merchantId: 'm1', riskMin: 30, riskMax: 70 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].transactionId).toBe('t2');
  });

  test('filters by dateFrom/dateTo range', async () => {
    const db = new FakeFirestore();
    await seedTransaction(db, { transactionId: 't1', merchantId: 'm1', amountGross: 100, riskScoreCalculated: 10, timestamp: new Date('2026-01-01') });
    await seedTransaction(db, { transactionId: 't2', merchantId: 'm1', amountGross: 100, riskScoreCalculated: 10, timestamp: new Date('2026-02-01') });
    await seedTransaction(db, { transactionId: 't3', merchantId: 'm1', amountGross: 100, riskScoreCalculated: 10, timestamp: new Date('2026-03-01') });

    const result = await listTransactionsForMerchant(db, {
      merchantId: 'm1',
      dateFrom: '2026-01-15',
      dateTo: '2026-02-15',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].transactionId).toBe('t2');
  });

  test('rejects an invalid status', async () => {
    const db = new FakeFirestore();
    await expect(listTransactionsForMerchant(db, { merchantId: 'm1', status: 'BOGUS' })).rejects.toThrow(/status must be one of/);
  });

  test('rejects an out-of-range riskMin', async () => {
    const db = new FakeFirestore();
    await expect(listTransactionsForMerchant(db, { merchantId: 'm1', riskMin: 150 })).rejects.toThrow(/riskMin must be a number/);
  });
});
