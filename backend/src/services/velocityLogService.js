// GAP: /card_velocity_log is NOT one of DATABASE_SCHEMA.md's documented
// collections. It exists because /transactions has no cardFingerprint
// field, and settlementService.js's write (built in an earlier session,
// not modified here) does not persist one either — so there is currently
// no way to query "prior transactions for this card" against the ledger
// itself. This is a minimal, dedicated collection introduced to make
// riskEngine.checkVelocity's injected lookup function query real data
// instead of faking a result. Flagged for a schema decision: either
// persist cardFingerprint on /transactions (requires updating
// settlementService.js in a later session) or formally adopt this
// collection in DATABASE_SCHEMA.md.

// Builds the (fingerprint, windowStartMs, windowEndMs) => Promise<number>
// function riskEngine.checkVelocity expects, scoped to merchantId via
// closure — checkVelocity's signature has no merchantId parameter, so
// scoping happens here rather than by changing riskEngine.js.
export function buildRecentTransactionLookup(db, merchantId) {
  return async function recentTransactionLookupFn(cardFingerprint, windowStartMs, windowEndMs) {
    const snapshot = await db
      .collection('card_velocity_log')
      .where('merchantId', '==', merchantId)
      .where('cardFingerprint', '==', cardFingerprint)
      .where('timestamp', '>=', new Date(windowStartMs))
      .where('timestamp', '<=', new Date(windowEndMs))
      .get();
    return snapshot.size;
  };
}

// Doc ID is the idempotencyKey so a gateway retry of the same capture
// event overwrites the same log entry instead of inflating the count.
export async function recordCardVelocityEvent(db, { merchantId, cardFingerprint, idempotencyKey, occurredAt }) {
  await db.collection('card_velocity_log').doc(idempotencyKey).set({
    merchantId,
    cardFingerprint,
    timestamp: occurredAt,
  });
}
