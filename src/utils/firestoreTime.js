// Shared defensive parser for Firestore timestamp values, which arrive in
// several different shapes depending on the path data took to get here:
// a real Firestore client-SDK Timestamp (onSnapshot, has .toMillis()/.toDate()),
// an admin-SDK Timestamp JSON-serialized over a REST response ({seconds,
// nanoseconds} or {_seconds,_nanoseconds}), a plain Date, or an ISO string.
// Used by every page that renders a transaction/capsule timestamp.
export function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  if (typeof value._seconds === 'number') return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1e6);
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function toDate(value) {
  const ms = toMillis(value);
  return ms == null ? null : new Date(ms);
}
