// GAP: DATABASE_SCHEMA.md's /notifications section is explicitly marked
// "inferred from workflow spec" — this file establishes the real write
// path, not a pre-defined contract.

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const VALID_TARGET_ROLES = ['MERCHANT', 'ADMIN'];

function validateCreateParams(params) {
  const p = params || {};

  if (!VALID_TARGET_ROLES.includes(p.targetRole)) {
    throw new Error(
      `createNotification: targetRole must be one of ${VALID_TARGET_ROLES.join(', ')}, got "${p.targetRole}".`
    );
  }
  if (p.merchantId !== null && p.merchantId !== undefined && typeof p.merchantId !== 'string') {
    throw new Error('createNotification: merchantId must be a string or null.');
  }
  if (!p.message || typeof p.message !== 'string') {
    throw new Error('createNotification: message must be a non-empty string.');
  }
  if (!p.category || typeof p.category !== 'string') {
    throw new Error('createNotification: category must be a non-empty string.');
  }

  return p;
}

/**
 * Reusable notification-writing helper. NOT yet called from any Phase 2
 * financial service (riskEngine.js/vaultScheduler.js/settlementService.js/
 * refundService.js/chargebackService.js) in this session — wiring real
 * triggers (vault capsule matured, high-risk flag raised, chargeback
 * logged, etc.) into those services is an explicit, deliberately
 * unfinished follow-up, not attempted here.
 *
 * expiresAt is stored as a Date (Firestore Timestamp on write), NOT a raw
 * number, despite the brief describing the target value in "epoch-ms"
 * terms. Firestore's native TTL feature — the entire reason this field
 * exists — only recognizes Timestamp-typed fields; a plain integer field
 * would silently disable TTL with no error at write time or any other
 * point. This mirrors vaultService.js's releaseDate, which CLAUDE.md
 * likewise describes as "absolute epoch milliseconds" but which the actual
 * code stores as a Date for the identical reason (Firestore compares
 * Timestamps as Timestamps, not as numbers).
 */
export async function createNotification(db, params) {
  const { targetRole, merchantId, message, category } = validateCreateParams(params);

  const notificationRef = db.collection('notifications').doc();
  const now = new Date();
  const notificationDoc = {
    notificationId: notificationRef.id,
    targetRole,
    merchantId: merchantId ?? null,
    message,
    category,
    read: false,
    createdAt: now,
    expiresAt: new Date(now.getTime() + THIRTY_DAYS_MS),
  };

  await notificationRef.set(notificationDoc);
  return notificationDoc;
}

/**
 * Merchant feed = notifications addressed to them directly (merchantId
 * match) plus targetRole-wide MERCHANT broadcasts (merchantId: null).
 * Admin feed = targetRole ADMIN notifications only (always merchantId:
 * null in practice, given the single-shared-admin-credential model —
 * CLAUDE.md invariant #7 / SYSTEM_ARCHITECTURE.md caveat #4).
 *
 * Firestore (real or fake) has no native OR across "merchantId == X" and
 * "merchantId == null AND targetRole == MERCHANT" — this issues two
 * separate queries and merges/sorts/paginates in application code, a
 * standard workaround for Firestore's OR-query limitation, not a hack.
 *
 * GAP: same composite-index caveat as listTickets — merchantId equality +
 * orderBy(createdAt) needs a Firestore composite index, not yet added to
 * firebase/firestore.indexes.json.
 */
export async function listNotifications(db, { merchantId, isAdmin, limit = 20, offset = 0 } = {}) {
  let combined;

  if (isAdmin) {
    const snap = await db.collection('notifications').where('targetRole', '==', 'ADMIN').get();
    combined = snap.docs.map((d) => d.data());
  } else {
    const [ownSnap, broadcastSnap] = await Promise.all([
      db.collection('notifications').where('merchantId', '==', merchantId).get(),
      db.collection('notifications').where('merchantId', '==', null).where('targetRole', '==', 'MERCHANT').get(),
    ]);
    combined = [...ownSnap.docs.map((d) => d.data()), ...broadcastSnap.docs.map((d) => d.data())];
  }

  combined.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const page = combined.slice(offset, offset + limit);
  const hasMore = combined.length > offset + limit;

  return { items: page, limit, offset, hasMore };
}

/**
 * Ownership rules (invented, mirroring the two-tier feed model above,
 * flagged for confirmation): an admin may mark read any ADMIN-targeted
 * notification; a merchant may mark read one addressed directly to them,
 * or a MERCHANT-wide broadcast.
 *
 * KNOWN GAP, flagged rather than silently resolved: a targetRole-wide
 * broadcast (merchantId: null) has exactly one `read` flag shared across
 * every recipient of that role. One merchant marking it read marks it read
 * for all merchants, not just the caller. A true per-recipient read state
 * would need a separate read-receipts subcollection (mirroring this
 * session's messages-subcollection pattern) — not built here since the
 * task's createNotification() signature specifies a single top-level
 * `read` field, and this file doesn't invent schema beyond what was asked.
 */
export async function markNotificationRead(db, { notificationId, merchantId, isAdmin } = {}) {
  if (!notificationId || typeof notificationId !== 'string') {
    throw new Error('markNotificationRead: notificationId must be a non-empty string.');
  }

  const notificationRef = db.collection('notifications').doc(notificationId);
  const snap = await notificationRef.get();
  if (!snap.exists) {
    throw new Error(`markNotificationRead: notification "${notificationId}" not found.`);
  }
  const notification = snap.data();

  const isOwner = isAdmin
    ? notification.targetRole === 'ADMIN'
    : notification.merchantId === merchantId ||
      (notification.merchantId === null && notification.targetRole === 'MERCHANT');

  if (!isOwner) {
    throw new Error(`markNotificationRead: notification "${notificationId}" does not belong to the caller.`);
  }

  await notificationRef.update({ read: true });
  return { ...notification, read: true };
}
