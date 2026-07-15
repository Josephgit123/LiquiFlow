import { logAdminAction } from './auditLogService.js';

const VALID_ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED'];
const VALID_TIER_OVERRIDES = ['LOW', 'MEDIUM', 'HIGH', null];

/**
 * Paginated /merchants list for the Merchant Manager's "searchable
 * tabular" view, optionally filtered by accountStatus/industryVector.
 * Reads the paired /merchant_balances doc for each page item, per the
 * spec's "views transaction volumes" workflow note — this attaches the
 * balance snapshot (availableLiquid/lockedEscrow/totalWithdrawn), not a
 * computed lifetime transaction-volume sum (which would require scanning
 * every transaction per merchant on every list request); the task's own
 * instruction to read "/merchant_balances for volume display" matches
 * this reading.
 *
 * GAP: an accountStatus/industryVector equality filter combined with
 * orderBy(businessName) needs a Firestore composite index — same
 * open-item category as every other multi-field query in this codebase.
 * /merchants has no createdAt field (DATABASE_SCHEMA.md), so businessName
 * is used as the ordering key instead of a creation timestamp.
 */
export async function listMerchantsForAdmin(db, { accountStatus, industryVector, limit = 20, offset = 0 } = {}) {
  let query = db.collection('merchants');
  if (accountStatus) query = query.where('accountStatus', '==', accountStatus);
  if (industryVector) query = query.where('industryVector', '==', industryVector);
  query = query.orderBy('businessName', 'asc').limit(offset + limit + 1);

  const snap = await query.get();
  const matched = snap.docs.map((d) => d.data());
  const page = matched.slice(offset, offset + limit);
  const hasMore = matched.length > offset + limit;

  const balanceSnaps = await Promise.all(
    page.map((m) => db.collection('merchant_balances').doc(m.merchantId).get())
  );
  const items = page.map((m, i) => ({ ...m, balance: balanceSnaps[i].exists ? balanceSnaps[i].data() : null }));

  return { items, limit, offset, hasMore };
}

/**
 * Merchant Manager's account-status control. Writes ONLY accountStatus —
 * never currentRiskTier/accumulatedRiskPoints/anything in
 * /merchant_balances (those are separate, more privileged write paths).
 * A single db.runTransaction pairs the mutation with its audit log entry
 * atomically via logAdminAction(..., { transaction }), so a status change
 * can never land without its compliance record (or vice versa).
 *
 * Suspending a merchant here takes effect immediately on the existing
 * accountStatus === 'ACTIVE' gate already enforced in
 * transactionRoutes.js's POST /capture (Step 8/CLAUDE.md invariant #4) —
 * no new blocking logic is needed anywhere; that route already re-reads
 * /merchants/{merchantId} on every capture request and 403s if
 * accountStatus isn't ACTIVE, so the very next capture attempt after a
 * suspension is written here is rejected, with no caching/staleness gap.
 */
export async function updateMerchantAccountStatus(db, { merchantId, accountStatus, reason, actorId }) {
  if (!merchantId || typeof merchantId !== 'string') {
    throw new Error('updateMerchantAccountStatus: merchantId must be a non-empty string.');
  }
  if (!VALID_ACCOUNT_STATUSES.includes(accountStatus)) {
    throw new Error(
      `updateMerchantAccountStatus: accountStatus must be one of ${VALID_ACCOUNT_STATUSES.join(', ')}, got "${accountStatus}".`
    );
  }
  if (!reason || typeof reason !== 'string') {
    throw new Error('updateMerchantAccountStatus: reason is required and must be a non-empty string.');
  }
  if (!actorId || typeof actorId !== 'string') {
    throw new Error('updateMerchantAccountStatus: actorId must be a non-empty string.');
  }

  const merchantRef = db.collection('merchants').doc(merchantId);

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(merchantRef);
    if (!snap.exists) {
      throw new Error(`updateMerchantAccountStatus: merchant "${merchantId}" not found.`);
    }
    const before = snap.data();
    transaction.update(merchantRef, { accountStatus });

    await logAdminAction(db, {
      actorId,
      actionType: 'ADMIN_MERCHANT_STATUS_CHANGE',
      targetId: merchantId,
      beforeState: { accountStatus: before.accountStatus },
      afterState: { accountStatus, reason },
      transaction,
    });

    return { ...before, accountStatus };
  });
}

/**
 * Merchant Configuration's tier-override control. Writes ONLY
 * tierOverride on /merchants/{merchantId} — a field DISTINCT from
 * currentRiskTier.
 *
 * RESOLUTION (post-Step-15 correction, confirmed with the user): an
 * earlier draft of this function wrote to currentRiskTier directly, per
 * Step 13's framing of it as "the resolved storage location for admin
 * tier overrides." That turned out to be unsafe: onboardingService.js
 * (Step 13) always sets currentRiskTier to the computed baseline at
 * onboarding, and it is never null afterward — so feeding it into
 * riskEngine.resolveEffectiveTier(computedScore, merchantOverrideTier) as
 * the override input would treat EVERY merchant as permanently overridden
 * from the moment they onboard, since null/undefined is
 * resolveEffectiveTier's only "no override" signal. tierOverride is a new,
 * separate, nullable field: currentRiskTier stays the
 * last-computed/display baseline; tierOverride is null unless an admin
 * explicitly sets one via this function, and transactionRoutes.js reads
 * merchant.tierOverride (not merchant.currentRiskTier) as
 * merchantOverrideTier. DATABASE_SCHEMA.md's /merchants table still needs
 * a row added for this field — not edited in this session.
 *
 * Deliberately a SEPARATE endpoint/function from
 * updateMerchantAccountStatus above: suspending an account and overriding
 * its risk tier are different privileges with different audit meanings,
 * and are never merged into one route.
 */
export async function updateMerchantTierOverride(db, { merchantId, tierOverride, actorId }) {
  if (!merchantId || typeof merchantId !== 'string') {
    throw new Error('updateMerchantTierOverride: merchantId must be a non-empty string.');
  }
  if (!VALID_TIER_OVERRIDES.includes(tierOverride)) {
    throw new Error(
      `updateMerchantTierOverride: tierOverride must be one of LOW, MEDIUM, HIGH, or null, got "${tierOverride}".`
    );
  }
  if (!actorId || typeof actorId !== 'string') {
    throw new Error('updateMerchantTierOverride: actorId must be a non-empty string.');
  }

  const merchantRef = db.collection('merchants').doc(merchantId);

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(merchantRef);
    if (!snap.exists) {
      throw new Error(`updateMerchantTierOverride: merchant "${merchantId}" not found.`);
    }
    const before = snap.data();
    transaction.update(merchantRef, { tierOverride });

    await logAdminAction(db, {
      actorId,
      actionType: 'ADMIN_TIER_OVERRIDE_CHANGE',
      targetId: merchantId,
      beforeState: { tierOverride: before.tierOverride ?? null },
      afterState: { tierOverride },
      transaction,
    });

    return { ...before, tierOverride };
  });
}
