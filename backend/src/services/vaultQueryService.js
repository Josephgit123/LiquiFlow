// New file rather than a change to vaultService.js — that file's own
// sweepMaturedCapsules/buildReserveCapsuleDocument/calculateSplit stay
// untouched. This is a separate, read-only, merchant-scoped listing
// query, distinct from the system-wide (no merchantId) sweep query
// vaultService.js runs.

/**
 * Paginated read over /reserve_vault, scoped to merchantId
 * (API_DOCUMENTATION.md: GET /api/vault — backs the Maturity Vault
 * Interface). `isMatured`, if provided, filters to only matured or only
 * still-locked capsules; omit it to list both. Read-only.
 *
 * GAP: merchantId (+ isMatured) equality filters combined with
 * orderBy(releaseDate) needs a Firestore composite index — added to
 * firebase/firestore.indexes.json alongside this change (distinct from
 * the existing isMatured+releaseDate index vaultService.sweepMaturedCapsules
 * uses, which has no merchantId filter since it's a system-wide sweep).
 */
export async function listVaultCapsulesForMerchant(db, params = {}) {
  const { merchantId, isMatured, limit = 20, offset = 0 } = params;

  if (!merchantId || typeof merchantId !== 'string') {
    throw new Error('listVaultCapsulesForMerchant: merchantId must be a non-empty string.');
  }
  if (isMatured !== undefined && typeof isMatured !== 'boolean') {
    throw new Error(`listVaultCapsulesForMerchant: isMatured, if provided, must be a boolean, got "${isMatured}".`);
  }

  let query = db.collection('reserve_vault').where('merchantId', '==', merchantId);
  if (isMatured !== undefined) query = query.where('isMatured', '==', isMatured);
  query = query.orderBy('releaseDate', 'asc').limit(offset + limit + 1);

  const snap = await query.get();
  const matched = snap.docs.map((d) => d.data());
  const page = matched.slice(offset, offset + limit);
  const hasMore = matched.length > offset + limit;

  return { items: page, limit, offset, hasMore };
}
