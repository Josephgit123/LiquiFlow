import { listVaultCapsulesForMerchant } from './vaultQueryService.js';
import { FakeFirestore } from './testUtils/fakeFirestore.js';

async function seedCapsule(db, { vaultId, merchantId, amountLocked, releaseDate, isMatured = false }) {
  await db.collection('reserve_vault').doc(vaultId).set({
    vaultId,
    merchantId,
    associatedTransactionId: `tx_${vaultId}`,
    amountLocked,
    releaseDate,
    isMatured,
    createdAt: new Date(),
  });
}

describe('listVaultCapsulesForMerchant — scoping and ordering', () => {
  test('only returns the given merchantId\'s capsules, soonest-maturing first', async () => {
    const db = new FakeFirestore();
    await seedCapsule(db, { vaultId: 'v1', merchantId: 'm1', amountLocked: 100, releaseDate: new Date('2026-03-01') });
    await seedCapsule(db, { vaultId: 'v2', merchantId: 'm1', amountLocked: 200, releaseDate: new Date('2026-01-01') });
    await seedCapsule(db, { vaultId: 'v3', merchantId: 'm2', amountLocked: 300, releaseDate: new Date('2026-02-01') });

    const result = await listVaultCapsulesForMerchant(db, { merchantId: 'm1' });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].vaultId).toBe('v2'); // earliest releaseDate first
    expect(result.items[1].vaultId).toBe('v1');
  });

  test('filters by isMatured', async () => {
    const db = new FakeFirestore();
    await seedCapsule(db, { vaultId: 'v1', merchantId: 'm1', amountLocked: 100, releaseDate: new Date('2026-01-01'), isMatured: true });
    await seedCapsule(db, { vaultId: 'v2', merchantId: 'm1', amountLocked: 200, releaseDate: new Date('2026-02-01'), isMatured: false });

    const matured = await listVaultCapsulesForMerchant(db, { merchantId: 'm1', isMatured: true });
    expect(matured.items).toHaveLength(1);
    expect(matured.items[0].vaultId).toBe('v1');

    const active = await listVaultCapsulesForMerchant(db, { merchantId: 'm1', isMatured: false });
    expect(active.items).toHaveLength(1);
    expect(active.items[0].vaultId).toBe('v2');
  });

  test('paginates with limit/offset and computes hasMore', async () => {
    const db = new FakeFirestore();
    for (let i = 0; i < 5; i += 1) {
      await seedCapsule(db, { vaultId: `v${i}`, merchantId: 'm1', amountLocked: 100, releaseDate: new Date(2026, 0, i + 1) });
    }

    const page1 = await listVaultCapsulesForMerchant(db, { merchantId: 'm1', limit: 2, offset: 0 });
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    const page3 = await listVaultCapsulesForMerchant(db, { merchantId: 'm1', limit: 2, offset: 4 });
    expect(page3.items).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
  });

  test('rejects a missing merchantId', async () => {
    const db = new FakeFirestore();
    await expect(listVaultCapsulesForMerchant(db, {})).rejects.toThrow(/merchantId/);
  });
});
