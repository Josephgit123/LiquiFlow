import { logAdminAction } from './auditLogService.js';

const PLATFORM_CONFIG_DOC_ID = 'global';
export const MAX_PLATFORM_FEE_PERCENT = 10;

function validateParams(params) {
  const p = params || {};

  if (
    typeof p.platformFeePercent !== 'number' ||
    !Number.isFinite(p.platformFeePercent) ||
    p.platformFeePercent < 0 ||
    p.platformFeePercent > MAX_PLATFORM_FEE_PERCENT
  ) {
    throw new Error(
      `updatePlatformSettings: platformFeePercent must be a number in [0, ${MAX_PLATFORM_FEE_PERCENT}], got ${p.platformFeePercent}.`
    );
  }
  if (
    typeof p.defaultVaultMaturityDays !== 'number' ||
    !Number.isFinite(p.defaultVaultMaturityDays) ||
    p.defaultVaultMaturityDays <= 0
  ) {
    throw new Error(
      `updatePlatformSettings: defaultVaultMaturityDays must be a positive number, got ${p.defaultVaultMaturityDays}.`
    );
  }
  if (typeof p.maintenanceMode !== 'boolean') {
    throw new Error(`updatePlatformSettings: maintenanceMode must be a boolean, got ${p.maintenanceMode}.`);
  }
  if (!p.actorId || typeof p.actorId !== 'string') {
    throw new Error('updatePlatformSettings: actorId must be a non-empty string.');
  }

  return p;
}

/**
 * Writes to /system_configuration/global — the SAME document
 * systemConfigService.js's getPlatformFeePercent() already reads
 * platformFeePercent from (Step 8, with its existing fallback default of
 * 2 if the doc/field is unset). This endpoint is the first real write
 * path populating that value; no change to systemConfigService.js itself
 * was needed, since it already accepted platformFeePercent as a
 * looked-up value rather than a hardcoded constant — settlementService.js
 * receives platformFeePercent as an injected parameter from
 * transactionRoutes.js's call to getPlatformFeePercent(db), so this write
 * path composes correctly with zero Phase 2 code changes.
 *
 * Lighter version of the Risk Engine Configurator's "not live" limitation:
 * defaultVaultMaturityDays and maintenanceMode are persisted here, but
 * nothing currently reads them back. vaultService.js's actual hold
 * durations come from riskEngine.js's hardcoded TIER_TABLE (per risk
 * tier), not from a flat "default days" setting, and no middleware checks
 * a maintenance-mode flag anywhere in this codebase. Wiring those reads is
 * a follow-up, not attempted in this session.
 *
 * Uses a full document overwrite (not a merge) — safe because nothing
 * else in this codebase writes to /system_configuration/global besides
 * this function and getPlatformFeePercent's read.
 */
export async function updatePlatformSettings(db, params) {
  const { platformFeePercent, defaultVaultMaturityDays, maintenanceMode, actorId } = validateParams(params);

  const configRef = db.collection('system_configuration').doc(PLATFORM_CONFIG_DOC_ID);

  return db.runTransaction(async (transaction) => {
    const existingSnap = await transaction.get(configRef);
    const before = existingSnap.exists ? existingSnap.data() : null;

    const settingsDoc = {
      platformFeePercent,
      defaultVaultMaturityDays,
      maintenanceMode,
      updatedAt: new Date(),
    };
    transaction.set(configRef, settingsDoc);

    await logAdminAction(db, {
      actorId,
      actionType: 'ADMIN_PLATFORM_SETTINGS_UPDATE',
      targetId: PLATFORM_CONFIG_DOC_ID,
      beforeState: before,
      afterState: settingsDoc,
      transaction,
    });

    return settingsDoc;
  });
}
