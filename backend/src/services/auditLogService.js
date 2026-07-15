// Shared by every mutating admin route in this session. actorId is
// necessarily generic (e.g. "ADMIN") since the admin JWT encodes no
// per-admin identity — the same single-shared-admin-credential limitation
// already flagged in chargebackService.js/SYSTEM_ARCHITECTURE.md caveat #4,
// restated here rather than solved, since inventing per-admin attribution
// is out of scope for this session.
//
// NOTE: chargebackService.js (Step 11) already writes its own inline audit
// log entry, from before this shared helper existed. It is NOT modified to
// call logAdminAction in this session (chargebackService.js is on the
// do-not-modify list) — its audit entries land in the same
// /system_audit_logs collection with the same document shape, just via a
// separate inline write rather than this function. Worth unifying in a
// future session; not attempted here.

function validateParams(params) {
  const p = params || {};

  if (!p.actorId || typeof p.actorId !== 'string') {
    throw new Error('logAdminAction: actorId must be a non-empty string.');
  }
  if (!p.actionType || typeof p.actionType !== 'string') {
    throw new Error('logAdminAction: actionType must be a non-empty string.');
  }
  if (!p.targetId || typeof p.targetId !== 'string') {
    throw new Error('logAdminAction: targetId must be a non-empty string.');
  }

  return p;
}

/**
 * Writes a /system_audit_logs entry (DATABASE_SCHEMA.md fields: logId,
 * actorId, actionType, targetId, beforeState, afterState, timestamp).
 * Append-only (CLAUDE.md invariant #1) — this function only ever creates a
 * new document, never updates or deletes one.
 *
 * Pass `transaction` (a live db.runTransaction callback's transaction
 * object) to fold this write atomically into an existing transaction, so
 * the audit entry and the mutation it describes can never land
 * inconsistently — used by every mutating admin function in this session
 * that already runs inside its own transaction. Omit `transaction` for a
 * standalone write (e.g. logging a refund-queue denial that has no
 * balance mutation of its own to pair with).
 */
export async function logAdminAction(db, params) {
  const { actorId, actionType, targetId, beforeState, afterState, transaction } = validateParams(params);

  const logRef = db.collection('system_audit_logs').doc();
  const logDoc = {
    logId: logRef.id,
    actorId,
    actionType,
    targetId,
    beforeState: beforeState ?? null,
    afterState: afterState ?? null,
    timestamp: new Date(),
  };

  if (transaction) {
    transaction.set(logRef, logDoc);
  } else {
    await logRef.set(logDoc);
  }

  return logDoc;
}

/**
 * Read-only. /system_audit_logs is append-only (CLAUDE.md invariant #1) —
 * this function must never write. Ordered by timestamp descending per the
 * spec's "strict chronological" requirement, paginated via the same
 * limit/offset convention used for tickets/notifications (Steps 13/14).
 *
 * GAP: actionType/actorId equality filters combined with orderBy(timestamp)
 * need a Firestore composite index — same open-item category as every
 * other multi-field query flagged since Phase 2.
 */
export async function listAuditLogs(db, { actionType, actorId, dateFrom, dateTo, limit = 20, offset = 0 } = {}) {
  let query = db.collection('system_audit_logs');
  if (actionType) query = query.where('actionType', '==', actionType);
  if (actorId) query = query.where('actorId', '==', actorId);
  if (dateFrom) query = query.where('timestamp', '>=', new Date(dateFrom));
  if (dateTo) query = query.where('timestamp', '<=', new Date(dateTo));
  query = query.orderBy('timestamp', 'desc').limit(offset + limit + 1);

  const snap = await query.get();
  const matched = snap.docs.map((d) => d.data());
  const page = matched.slice(offset, offset + limit);
  const hasMore = matched.length > offset + limit;

  return { items: page, limit, offset, hasMore };
}
