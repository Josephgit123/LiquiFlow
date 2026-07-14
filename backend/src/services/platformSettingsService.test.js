import { updatePlatformSettings, MAX_PLATFORM_FEE_PERCENT } from './platformSettingsService.js';
import { getPlatformFeePercent } from './systemConfigService.js';
import { FakeFirestore } from './testUtils/fakeFirestore.js';

function settingsParams(overrides = {}) {
  return {
    platformFeePercent: 3,
    defaultVaultMaturityDays: 5,
    maintenanceMode: false,
    actorId: 'ADMIN',
    ...overrides,
  };
}

describe('updatePlatformSettings — validation', () => {
  test('accepts a fee at exactly the 10% cap', async () => {
    const db = new FakeFirestore();
    const result = await updatePlatformSettings(db, settingsParams({ platformFeePercent: MAX_PLATFORM_FEE_PERCENT }));
    expect(result.platformFeePercent).toBe(10);
  });

  test('rejects a fee above the 10% cap', async () => {
    const db = new FakeFirestore();
    await expect(updatePlatformSettings(db, settingsParams({ platformFeePercent: 10.5 }))).rejects.toThrow(
      /platformFeePercent/
    );
  });

  test('rejects a negative fee', async () => {
    const db = new FakeFirestore();
    await expect(updatePlatformSettings(db, settingsParams({ platformFeePercent: -1 }))).rejects.toThrow(
      /platformFeePercent/
    );
  });
});

describe('updatePlatformSettings — this endpoint is the first real write path for platformFeePercent', () => {
  test('writes to the same /system_configuration/global doc getPlatformFeePercent reads from', async () => {
    const db = new FakeFirestore();

    // Before any write, the Phase 2 fallback default applies.
    expect(await getPlatformFeePercent(db)).toBe(2);

    await updatePlatformSettings(db, settingsParams({ platformFeePercent: 4.5 }));

    // No change to systemConfigService.js was needed — it already reads
    // this value as a lookup, not a hardcoded constant.
    expect(await getPlatformFeePercent(db)).toBe(4.5);

    const logsSnap = await db.collection('system_audit_logs').get();
    expect(logsSnap.docs).toHaveLength(1);
    expect(logsSnap.docs[0].data().actionType).toBe('ADMIN_PLATFORM_SETTINGS_UPDATE');
  });
});
