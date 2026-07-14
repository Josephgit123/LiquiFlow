import { logAdminAction } from './auditLogService.js';
import { createNotification } from './notificationService.js';

// FLAGGED, NOT SILENTLY INVENTED: the master spec's Refund Queue page
// requires transactions with status PENDING_APPROVAL, but that status
// value does not exist anywhere in the Phase 2 refund flow —
// refundService.js's /transactions documents only ever carry CAPTURED,
// REFUNDED, or DISPUTED. Nothing in this codebase ever sets
// PENDING_APPROVAL, and inventing it here would mean either (a) this
// query returns an empty list forever, silently looking "done" while
// doing nothing, or (b) some other write path would need to set it, which
// doesn't exist. This is a genuine open design question, not something to
// guess at — see the session deliverable for the two options and ask the
// user to pick one. Until then, this is a clearly-labeled placeholder: it
// surfaces CAPTURED transactions (the only status a refund could ever
// apply to per refundService.js's own eligibility rule) rather than
// querying a status that can never match, and marks the response
// isPlaceholder: true so no consumer mistakes this for the real,
// decided-upon queue criterion.
const PLACEHOLDER_NOTE =
  'PENDING_APPROVAL does not exist in the current transaction model (Step 10 only has CAPTURED/REFUNDED/DISPUTED). ' +
  'This surfaces CAPTURED transactions as a placeholder pending a decision — see PENDING_APPROVAL open question.';

/**
 * GAP: no defined admin-review criterion exists yet (e.g. "above a dollar
 * threshold") beyond "is this transaction refundable at all" — surfaces
 * every CAPTURED transaction, unfiltered, as the placeholder set.
 */
export async function listRefundQueue(db, { limit = 20, offset = 0 } = {}) {
  const query = db.collection('transactions').where('status', '==', 'CAPTURED').orderBy('timestamp', 'desc').limit(offset + limit + 1);

  const snap = await query.get();
  const matched = snap.docs.map((d) => d.data());
  const page = matched.slice(offset, offset + limit);
  const hasMore = matched.length > offset + limit;

  return { items: page, limit, offset, hasMore, isPlaceholder: true, placeholderNote: PLACEHOLDER_NOTE };
}

function validateDenyParams(params) {
  const p = params || {};
  if (!p.transactionId || typeof p.transactionId !== 'string') {
    throw new Error('denyRefund: transactionId must be a non-empty string.');
  }
  if (!p.reason || typeof p.reason !== 'string') {
    throw new Error('denyRefund: reason is required and must be a non-empty string.');
  }
  if (!p.actorId || typeof p.actorId !== 'string') {
    throw new Error('denyRefund: actorId must be a non-empty string.');
  }
  return p;
}

/**
 * Denies a refund request — NO balance change, and NO write to the
 * /transactions document itself (its status is untouched; append-only
 * per CLAUDE.md invariant #1, and a denial isn't one of the two
 * documented status-transition exceptions). The denial's only durable
 * record is the audit log entry, plus a best-effort notification to the
 * merchant (reusing notificationService.createNotification from Step 14,
 * not reimplementing it).
 */
export async function denyRefund(db, params) {
  const { transactionId, reason, actorId } = validateDenyParams(params);

  const txSnap = await db.collection('transactions').doc(transactionId).get();
  if (!txSnap.exists) {
    throw new Error(`denyRefund: transaction "${transactionId}" not found.`);
  }
  const transaction = txSnap.data();

  const logDoc = await logAdminAction(db, {
    actorId,
    actionType: 'ADMIN_DENIED_REFUND',
    targetId: transactionId,
    beforeState: { status: transaction.status },
    afterState: { status: transaction.status, denialReason: reason },
  });

  await createNotification(db, {
    targetRole: 'MERCHANT',
    merchantId: transaction.merchantId,
    message: `Your refund request for transaction ${transactionId} was denied. Reason: ${reason}`,
    category: 'REFUND_DENIED',
  });

  return { transactionId, status: transaction.status, denialReason: reason, auditLogId: logDoc.logId };
}
