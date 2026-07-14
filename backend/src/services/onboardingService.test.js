import { processOnboarding } from './onboardingService.js';
import { FakeFirestore } from './testUtils/fakeFirestore.js';

function baseParams(overrides = {}) {
  return {
    merchantId: 'm1',
    businessName: 'Acme Co',
    entityType: 'LLC',
    industryVector: 'GAMING',
    targetVolume: '10k-50k',
    currency: 'USD',
    ...overrides,
  };
}

describe('processOnboarding — risk baseline math', () => {
  test('a GAMING merchant lands in LOW tier (industry weight +25, within the 0-30 LOW boundary)', async () => {
    const db = new FakeFirestore();

    const result = await processOnboarding(db, baseParams({ merchantId: 'm1', industryVector: 'GAMING' }));

    expect(result.merchant.accumulatedRiskPoints).toBe(25);
    expect(result.merchant.currentRiskTier).toBe('LOW');
    expect(result.merchant.accountStatus).toBe('ACTIVE');

    const balanceSnap = await db.collection('merchant_balances').doc('m1').get();
    expect(balanceSnap.data()).toMatchObject({
      merchantId: 'm1',
      availableLiquid: 0,
      lockedEscrow: 0,
      totalWithdrawn: 0,
      currency: 'USD',
    });
  });

  test('a CRYPTO merchant lands in MEDIUM tier (industry weight +40, within the 31-65 MEDIUM boundary)', async () => {
    const db = new FakeFirestore();

    const result = await processOnboarding(
      db,
      baseParams({ merchantId: 'm2', industryVector: 'CRYPTO', currency: 'EUR' })
    );

    expect(result.merchant.accumulatedRiskPoints).toBe(40);
    expect(result.merchant.currentRiskTier).toBe('MEDIUM');

    const merchantSnap = await db.collection('merchants').doc('m2').get();
    expect(merchantSnap.data().currentRiskTier).toBe('MEDIUM');
    expect(merchantSnap.data().accumulatedRiskPoints).toBe(40);

    const balanceSnap = await db.collection('merchant_balances').doc('m2').get();
    expect(balanceSnap.data().currency).toBe('EUR');
  });
});

describe('processOnboarding — one-shot rejection', () => {
  test('a merchant already ACTIVE is rejected and no data is overwritten', async () => {
    const db = new FakeFirestore();
    await processOnboarding(db, baseParams({ merchantId: 'm3', businessName: 'Original Name' }));

    await expect(
      processOnboarding(
        db,
        baseParams({ merchantId: 'm3', businessName: 'Overwritten Name', industryVector: 'CRYPTO' })
      )
    ).rejects.toThrow(/already completed onboarding/);

    const merchantSnap = await db.collection('merchants').doc('m3').get();
    expect(merchantSnap.data().businessName).toBe('Original Name');
    expect(merchantSnap.data().industryVector).toBe('GAMING');
  });

  test('a /merchants doc that exists but is still PENDING is allowed to proceed and is overwritten', async () => {
    const db = new FakeFirestore();
    await db.collection('merchants').doc('m4').set({
      merchantId: 'm4',
      businessName: 'Partial Attempt',
      entityType: 'LLC',
      industryVector: 'GROCERY',
      targetVolume: '1k-10k',
      currentRiskTier: 'LOW',
      accumulatedRiskPoints: 0,
      accountStatus: 'PENDING',
    });

    const result = await processOnboarding(
      db,
      baseParams({ merchantId: 'm4', businessName: 'Completed Attempt', industryVector: 'GAMING' })
    );

    expect(result.merchant.businessName).toBe('Completed Attempt');
    expect(result.merchant.accountStatus).toBe('ACTIVE');

    const balanceSnap = await db.collection('merchant_balances').doc('m4').get();
    expect(balanceSnap.exists).toBe(true);
  });
});

describe('processOnboarding — input validation', () => {
  test('an invalid industryVector is rejected', async () => {
    const db = new FakeFirestore();
    await expect(
      processOnboarding(db, baseParams({ merchantId: 'm5', industryVector: 'CASINO' }))
    ).rejects.toThrow(/industryVector/);

    const merchantSnap = await db.collection('merchants').doc('m5').get();
    expect(merchantSnap.exists).toBe(false);
  });

  test('an invalid entityType is rejected', async () => {
    const db = new FakeFirestore();
    await expect(
      processOnboarding(db, baseParams({ merchantId: 'm6', entityType: 'PARTNERSHIP' }))
    ).rejects.toThrow(/entityType/);
  });
});
