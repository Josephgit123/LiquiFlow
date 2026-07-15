import { normalizeCurrency } from '../utils/currency.js';

// CHOICE, stated rather than silently picked: this computes cross-tenant
// aggregates live, at query time, by reading every /transactions and
// /merchants document on each request. That's fine for a demo/portfolio
// scale (the same scale this whole codebase targets — no pagination-aware
// streaming aggregation exists anywhere else here either), but it does NOT
// scale to a real production merchant base: reading every transaction
// document on every dashboard load is O(all transactions ever) per
// request. At real scale this needs a precomputed/cached approach instead
// — e.g. incrementally-updated aggregate counters written alongside
// settlementService.js's transaction writes, or a scheduled job populating
// a small /analytics_cache document that this endpoint reads instead.
// Not built here — flagged as the known next step, not attempted.

/**
 * Read-only cross-tenant aggregates: total volume, transaction count,
 * risk-score tier distribution, total reserve currently locked, and
 * merchant counts by industry. Computed from /transactions and /merchants
 * — read-only, writes nothing.
 */
export async function computeAdminAnalytics(db) {
  const [txSnap, merchantSnap] = await Promise.all([
    db.collection('transactions').get(),
    db.collection('merchants').get(),
  ]);

  const transactions = txSnap.docs.map((d) => d.data());
  const merchants = merchantSnap.docs.map((d) => d.data());

  const totalVolume = normalizeCurrency(transactions.reduce((sum, t) => sum + (t.amountGross || 0), 0));
  const totalReserveLocked = normalizeCurrency(
    transactions.reduce((sum, t) => sum + (t.splitReserveAmount || 0), 0)
  );

  const riskScoreDistribution = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  for (const t of transactions) {
    if (typeof t.riskScoreCalculated !== 'number') continue;
    if (t.riskScoreCalculated <= 30) riskScoreDistribution.LOW += 1;
    else if (t.riskScoreCalculated <= 65) riskScoreDistribution.MEDIUM += 1;
    else riskScoreDistribution.HIGH += 1;
  }

  const merchantsByIndustry = {};
  for (const m of merchants) {
    merchantsByIndustry[m.industryVector] = (merchantsByIndustry[m.industryVector] || 0) + 1;
  }

  return {
    totalVolume,
    totalTransactions: transactions.length,
    totalMerchants: merchants.length,
    riskScoreDistribution,
    totalReserveLocked,
    merchantsByIndustry,
    computedAt: new Date(),
  };
}
