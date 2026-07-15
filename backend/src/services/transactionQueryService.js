// New file rather than a change to settlementService.js/refundService.js/
// chargebackService.js — consistent with how every prior session has kept
// Phase 2's financial-write services untouched and added new, separate
// service files for anything that only READS what they wrote.

export const VALID_TRANSACTION_STATUSES = ['CAPTURED', 'REFUNDED', 'DISPUTED'];

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === 'function') return value.toMillis(); // real Firestore Timestamp
  return Number(value);
}

// Firestore only allows range/inequality filters efficiently combined with
// an orderBy on the SAME field. merchantId + status are both equality
// filters (safe to combine with any orderBy), so those go to Firestore;
// dateFrom/dateTo (range on timestamp) and riskMin/riskMax (range on
// riskScoreCalculated) are two DIFFERENT fields' ranges, which Firestore
// cannot combine with a single query without also duplicating the orderBy
// per range field. Rather than requiring a fragile multi-index setup for
// a demo/portfolio-scale app, this fetches a bounded, merchantId(+status)-
// filtered, timestamp-ordered batch and applies both range filters in
// application code, then paginates the filtered result.
//
// GAP: MAX_SCAN_SIZE bounds how many of a merchant's most recent
// transactions this can search through when a date/risk range filter is
// combined with pagination deep into an otherwise-large result set. Fine
// at this app's scale; a real production volume would need either
// Firestore's newer multi-field range support (with matching composite
// indexes per range-field combination) or a dedicated search index
// (e.g. Algolia/Elasticsearch) instead of scanning here.
const MAX_SCAN_SIZE = 1000;

function validateNumberRange(value, fieldName) {
  if (value === undefined) return;
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 100) {
    throw new Error(`listTransactionsForMerchant: ${fieldName} must be a number in [0, 100], got ${value}.`);
  }
}

/**
 * Paginated, filterable read over /transactions, scoped to merchantId
 * (API_DOCUMENTATION.md: GET /api/transactions). Read-only — never
 * touches settlementService.js/refundService.js/chargebackService.js's
 * write paths.
 *
 * GAP: merchantId + status equality filters combined with
 * orderBy(timestamp) needs a Firestore composite index — added to
 * firebase/firestore.indexes.json alongside this change.
 */
export async function listTransactionsForMerchant(db, params = {}) {
  const { merchantId, status, transactionId, dateFrom, dateTo, riskMin, riskMax, limit = 20, offset = 0 } = params;

  if (!merchantId || typeof merchantId !== 'string') {
    throw new Error('listTransactionsForMerchant: merchantId must be a non-empty string.');
  }
  if (status !== undefined && !VALID_TRANSACTION_STATUSES.includes(status)) {
    throw new Error(
      `listTransactionsForMerchant: status must be one of ${VALID_TRANSACTION_STATUSES.join(', ')}, got "${status}".`
    );
  }
  validateNumberRange(riskMin, 'riskMin');
  validateNumberRange(riskMax, 'riskMax');

  let query = db.collection('transactions').where('merchantId', '==', merchantId);
  if (status) query = query.where('status', '==', status);
  if (transactionId) query = query.where('transactionId', '==', transactionId);
  query = query.orderBy('timestamp', 'desc').limit(MAX_SCAN_SIZE);

  const snap = await query.get();
  let matched = snap.docs.map((d) => d.data());

  if (dateFrom !== undefined) {
    const fromMs = toMillis(new Date(dateFrom));
    matched = matched.filter((t) => toMillis(t.timestamp) >= fromMs);
  }
  if (dateTo !== undefined) {
    const toMs = toMillis(new Date(dateTo));
    matched = matched.filter((t) => toMillis(t.timestamp) <= toMs);
  }
  if (riskMin !== undefined) {
    matched = matched.filter((t) => t.riskScoreCalculated >= riskMin);
  }
  if (riskMax !== undefined) {
    matched = matched.filter((t) => t.riskScoreCalculated <= riskMax);
  }

  const page = matched.slice(offset, offset + limit);
  const hasMore = matched.length > offset + limit;

  return { items: page, limit, offset, hasMore };
}
