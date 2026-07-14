import {
  listMerchantsForAdmin,
  updateMerchantAccountStatus,
  updateMerchantTierOverride,
} from './merchantAdminService.js';
import { FakeFirestore } from './testUtils/fakeFirestore.js';

async function seedMerchant(db, overrides = {}) {
  const merchant = {
    merchantId: 'm1',
    businessName: 'Acme Co',
    entityType: 'LLC',
    industryVector: 'GAMING',
    targetVolume: '10k-50k',
    currentRiskTier: 'LOW',
    accumulatedRiskPoints: 25,
    accountStatus: 'ACTIVE',
    ...overrides,
  };
  await db.collection('merchants').doc(merchant.merchantId).set(merchant);
  return merchant;
}

describe('updateMerchantAccountStatus', () => {
  test('suspends an ACTIVE merchant, requires a reason, and logs an audit entry', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);

    const result = await updateMerchantAccountStatus(db, {
      merchantId: 'm1',
      accountStatus: 'SUSPENDED',
      reason: 'Suspected fraud ring',
      actorId: 'ADMIN',
    });

    expect(result.accountStatus).toBe('SUSPENDED');

    const merchantSnap = await db.collection('merchants').doc('m1').get();
    expect(merchantSnap.data().accountStatus).toBe('SUSPENDED');

    const logsSnap = await db.collection('system_audit_logs').get();
    expect(logsSnap.docs).toHaveLength(1);
    const log = logsSnap.docs[0].data();
    expect(log.actionType).toBe('ADMIN_MERCHANT_STATUS_CHANGE');
    expect(log.targetId).toBe('m1');
    expect(log.beforeState).toEqual({ accountStatus: 'ACTIVE' });
    expect(log.afterState).toEqual({ accountStatus: 'SUSPENDED', reason: 'Suspected fraud ring' });
  });

  test('reactivates a SUSPENDED merchant', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { accountStatus: 'SUSPENDED' });

    const result = await updateMerchantAccountStatus(db, {
      merchantId: 'm1',
      accountStatus: 'ACTIVE',
      reason: 'Investigation cleared the account',
      actorId: 'ADMIN',
    });

    expect(result.accountStatus).toBe('ACTIVE');
  });

  test('rejects a missing reason', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);

    await expect(
      updateMerchantAccountStatus(db, { merchantId: 'm1', accountStatus: 'SUSPENDED', actorId: 'ADMIN' })
    ).rejects.toThrow(/reason is required/);

    const merchantSnap = await db.collection('merchants').doc('m1').get();
    expect(merchantSnap.data().accountStatus).toBe('ACTIVE');
    expect((await db.collection('system_audit_logs').get()).docs).toHaveLength(0);
  });

  test('does not touch currentRiskTier or accumulatedRiskPoints', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { currentRiskTier: 'MEDIUM', accumulatedRiskPoints: 40 });

    await updateMerchantAccountStatus(db, {
      merchantId: 'm1',
      accountStatus: 'SUSPENDED',
      reason: 'Manual review',
      actorId: 'ADMIN',
    });

    const merchantSnap = await db.collection('merchants').doc('m1').get();
    expect(merchantSnap.data().currentRiskTier).toBe('MEDIUM');
    expect(merchantSnap.data().accumulatedRiskPoints).toBe(40);
  });
});

describe('updateMerchantTierOverride — a distinct code path from status changes, and a distinct FIELD from currentRiskTier', () => {
  test('sets an explicit tier override on tierOverride, leaving currentRiskTier untouched', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { currentRiskTier: 'LOW' });

    const result = await updateMerchantTierOverride(db, { merchantId: 'm1', tierOverride: 'HIGH', actorId: 'ADMIN' });

    expect(result.tierOverride).toBe('HIGH');
    const merchantSnap = await db.collection('merchants').doc('m1').get();
    expect(merchantSnap.data().tierOverride).toBe('HIGH');
    // The onboarding-computed baseline is a SEPARATE field, untouched.
    expect(merchantSnap.data().currentRiskTier).toBe('LOW');
    // accountStatus is completely untouched by this endpoint.
    expect(merchantSnap.data().accountStatus).toBe('ACTIVE');

    const logsSnap = await db.collection('system_audit_logs').get();
    expect(logsSnap.docs).toHaveLength(1);
    expect(logsSnap.docs[0].data().actionType).toBe('ADMIN_TIER_OVERRIDE_CHANGE');
  });

  test('clearing the override with null writes null verbatim', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { tierOverride: 'HIGH' });

    const result = await updateMerchantTierOverride(db, { merchantId: 'm1', tierOverride: null, actorId: 'ADMIN' });

    expect(result.tierOverride).toBeNull();
    const merchantSnap = await db.collection('merchants').doc('m1').get();
    expect(merchantSnap.data().tierOverride).toBeNull();
  });

  test('rejects an invalid tier value', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db);

    await expect(
      updateMerchantTierOverride(db, { merchantId: 'm1', tierOverride: 'EXTREME', actorId: 'ADMIN' })
    ).rejects.toThrow(/tierOverride must be one of/);
  });
});

describe('listMerchantsForAdmin', () => {
  test('filters by accountStatus and industryVector, and attaches the paired balance', async () => {
    const db = new FakeFirestore();
    await seedMerchant(db, { merchantId: 'm1', businessName: 'Alpha', accountStatus: 'ACTIVE', industryVector: 'GAMING' });
    await seedMerchant(db, { merchantId: 'm2', businessName: 'Beta', accountStatus: 'SUSPENDED', industryVector: 'CRYPTO' });
    await db.collection('merchant_balances').doc('m1').set({
      merchantId: 'm1',
      availableLiquid: 500,
      lockedEscrow: 50,
      totalWithdrawn: 0,
      currency: 'USD',
      lastUpdated: new Date(),
    });

    const result = await listMerchantsForAdmin(db, { accountStatus: 'ACTIVE' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].merchantId).toBe('m1');
    expect(result.items[0].balance.availableLiquid).toBe(500);
  });
});
