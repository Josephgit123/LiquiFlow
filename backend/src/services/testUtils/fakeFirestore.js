import { FieldValue } from 'firebase-admin/firestore';

// Minimal in-memory Firestore Admin SDK stand-in, scoped to exactly what
// settlementService.js/refundService.js/vaultService.js need:
// collection/doc/where/orderBy/limit, and a runTransaction that provides
// snapshot-isolated reads plus optimistic concurrency (read-version
// conflict at commit -> retry) — the same guarantees real Firestore
// transactions provide, and the reason CLAUDE.md invariant #2 requires
// re-reading balances inside the transaction. Simplification: query reads
// only track versions for documents actually returned by the query, so a
// query that currently matches nothing will not detect a concurrent
// insert that would have matched (a "phantom read") — not exercised by
// these tests since each settlement/refund call uses a distinct
// idempotencyKey.

const READ_DELAY_MS = 10; // forces interleaving across concurrent calls in tests

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toComparable(value) {
  return value instanceof Date ? value.getTime() : value;
}

function matchesFilter(actual, op, expected) {
  const a = toComparable(actual);
  const b = toComparable(expected);
  switch (op) {
    case '==':
      return a === b;
    case '>=':
      return a >= b;
    case '<=':
      return a <= b;
    case '>':
      return a > b;
    case '<':
      return a < b;
    default:
      throw new Error(`FakeFirestore: unsupported query operator "${op}".`);
  }
}

// Shared by FakeQuery (live-store reads) and FakeTransaction (snapshot
// reads) so filtering/ordering/limiting logic isn't duplicated.
function applyQuery(records, filters, orderByField, orderByDirection, limitCount) {
  let matched = records.filter(({ data }) => filters.every(({ field, op, value }) => matchesFilter(data[field], op, value)));

  if (orderByField) {
    const direction = orderByDirection === 'desc' ? -1 : 1;
    matched = matched.slice().sort((a, b) => {
      const av = toComparable(a.data[orderByField]);
      const bv = toComparable(b.data[orderByField]);
      if (av < bv) return -1 * direction;
      if (av > bv) return 1 * direction;
      return 0;
    });
  }

  if (limitCount != null) {
    matched = matched.slice(0, limitCount);
  }

  return matched;
}

class FakeDocSnapshot {
  constructor(id, data, exists) {
    this.id = id;
    this._data = data;
    this.exists = exists;
  }

  data() {
    return this._data;
  }
}

class FakeQuerySnapshot {
  constructor(matched) {
    this.docs = matched.map(({ id, data }) => new FakeDocSnapshot(id, data, true));
    this.empty = matched.length === 0;
  }
}

class FakeQuery {
  constructor(store, collectionName, filters, orderByField = null, orderByDirection = 'asc', limitCount = null) {
    this.store = store;
    this.collectionName = collectionName;
    this.filters = filters;
    this.orderByField = orderByField;
    this.orderByDirection = orderByDirection;
    this.limitCount = limitCount;
  }

  where(field, op, value) {
    return new FakeQuery(
      this.store,
      this.collectionName,
      [...this.filters, { field, op, value }],
      this.orderByField,
      this.orderByDirection,
      this.limitCount
    );
  }

  orderBy(field, direction = 'asc') {
    return new FakeQuery(this.store, this.collectionName, this.filters, field, direction, this.limitCount);
  }

  limit(count) {
    return new FakeQuery(this.store, this.collectionName, this.filters, this.orderByField, this.orderByDirection, count);
  }

  _matches() {
    return applyQuery(
      this.store.readAll(this.collectionName),
      this.filters,
      this.orderByField,
      this.orderByDirection,
      this.limitCount
    );
  }

  async get() {
    return new FakeQuerySnapshot(this._matches());
  }
}

class FakeDocRef {
  constructor(store, collectionName, id) {
    this.store = store;
    this.collectionName = collectionName;
    this.id = id;
  }

  async get() {
    const record = this.store.read(this.collectionName, this.id);
    return new FakeDocSnapshot(this.id, record ? record.data : undefined, !!record);
  }

  // Non-transactional convenience write, used by tests to seed fixtures.
  async set(data) {
    const existing = this.store.read(this.collectionName, this.id);
    const version = existing ? existing.version : 0;
    this.store.commit(this.collectionName, this.id, data, version);
  }

  // Non-transactional partial update, mirroring real Firestore's
  // docRef.update() — merges the given fields on top of the existing
  // document instead of replacing it wholesale, and throws if the
  // document doesn't exist (matching real Firestore's NOT_FOUND behavior).
  // Added for merchantRoutes.js's PATCH /funding route, the first caller
  // needing a bare partial update outside a runTransaction.
  async update(data) {
    const existing = this.store.read(this.collectionName, this.id);
    if (!existing) {
      throw new Error(`FakeFirestore: cannot update nonexistent document ${this.collectionName}/${this.id}.`);
    }
    this.store.commit(this.collectionName, this.id, { ...existing.data, ...data }, existing.version);
  }

  // Subcollection support, e.g. tickets/{ticketId}/messages. The fake store
  // is a flat map keyed by collection name, so a subcollection is modeled
  // as a distinct namespaced key (`${parentCollection}/${parentId}/${name}`)
  // — opaque to every other method here, which only ever treat
  // collectionName as a string key. Added for ticketService.js, the first
  // caller needing a genuine subcollection rather than a top-level one.
  collection(name) {
    return new FakeCollectionRef(this.store, `${this.collectionName}/${this.id}/${name}`);
  }
}

class FakeCollectionRef {
  constructor(store, name) {
    this.store = store;
    this.name = name;
  }

  doc(id) {
    return new FakeDocRef(this.store, this.name, id || this.store.generateId());
  }

  where(field, op, value) {
    return new FakeQuery(this.store, this.name, [{ field, op, value }]);
  }

  orderBy(field, direction = 'asc') {
    return new FakeQuery(this.store, this.name, [], field, direction);
  }

  // Real Firestore's CollectionReference extends Query, so .get() works
  // directly on a bare collection ref (no .where()/.orderBy() required) —
  // delegates to an unfiltered FakeQuery. Added for ticketService.js's
  // messages subcollection, the first caller reading an entire
  // subcollection with no filter/order applied first.
  async get() {
    return new FakeQuery(this.store, this.name, []).get();
  }
}

class FakeStore {
  constructor() {
    this.collections = new Map();
    this.idCounter = 0;
  }

  generateId() {
    this.idCounter += 1;
    return `auto_${this.idCounter}`;
  }

  _col(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    return this.collections.get(name);
  }

  read(collectionName, id) {
    return this._col(collectionName).get(id);
  }

  readAll(collectionName) {
    return Array.from(this._col(collectionName).entries()).map(([id, record]) => ({ id, data: record.data }));
  }

  getVersion(collectionName, id) {
    const record = this.read(collectionName, id);
    return record ? record.version : 0;
  }

  commit(collectionName, id, data, versionAtRead) {
    this._col(collectionName).set(id, { data, version: versionAtRead + 1 });
  }
}

function resolveFieldValues(data) {
  const resolved = {};
  for (const [key, value] of Object.entries(data)) {
    resolved[key] = value instanceof FieldValue ? new Date() : value;
  }
  return resolved;
}

class FakeTransaction {
  constructor(store) {
    this.store = store;
    this.reads = new Map(); // `${collection}/${id}` -> version as of this snapshot
    this.pendingWrites = [];

    // Snapshot isolation: every read within this transaction attempt sees
    // a single consistent point-in-time view, taken when the attempt
    // begins — matching real Firestore transaction semantics. Without
    // this, two reads of DIFFERENT documents within the same attempt
    // could straddle a concurrent commit (a "torn read": one document
    // read pre-commit, another read post-commit), which real Firestore
    // does not allow and which produced misleading failures here.
    this.snapshot = new Map(
      Array.from(store.collections.entries()).map(([name, docs]) => [name, new Map(docs)])
    );
  }

  _snapshotReadAll(collectionName) {
    const col = this.snapshot.get(collectionName);
    if (!col) return [];
    return Array.from(col.entries()).map(([id, record]) => ({ id, data: record.data }));
  }

  _snapshotVersion(collectionName, id) {
    const col = this.snapshot.get(collectionName);
    const record = col ? col.get(id) : undefined;
    return record ? record.version : 0;
  }

  async get(refOrQuery) {
    await delay(READ_DELAY_MS);

    if (refOrQuery instanceof FakeQuery) {
      const matched = applyQuery(
        this._snapshotReadAll(refOrQuery.collectionName),
        refOrQuery.filters,
        refOrQuery.orderByField,
        refOrQuery.orderByDirection,
        refOrQuery.limitCount
      );
      matched.forEach(({ id }) => {
        this.reads.set(`${refOrQuery.collectionName}/${id}`, this._snapshotVersion(refOrQuery.collectionName, id));
      });
      return new FakeQuerySnapshot(matched);
    }

    const version = this._snapshotVersion(refOrQuery.collectionName, refOrQuery.id);
    const record = this.snapshot.get(refOrQuery.collectionName)?.get(refOrQuery.id);
    this.reads.set(`${refOrQuery.collectionName}/${refOrQuery.id}`, version);
    return new FakeDocSnapshot(refOrQuery.id, record ? record.data : undefined, !!record);
  }

  set(ref, data) {
    this.pendingWrites.push({ collectionName: ref.collectionName, id: ref.id, data: resolveFieldValues(data), merge: false });
  }

  update(ref, data) {
    this.pendingWrites.push({ collectionName: ref.collectionName, id: ref.id, data: resolveFieldValues(data), merge: true });
  }
}

export class FakeFirestore {
  constructor() {
    this.store = new FakeStore();
  }

  collection(name) {
    return new FakeCollectionRef(this.store, name);
  }

  async runTransaction(updateFunction, { maxAttempts = 10 } = {}) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const txn = new FakeTransaction(this.store);
      const result = await updateFunction(txn);

      const hasConflict = Array.from(txn.reads.entries()).some(([key, versionAtRead]) => {
        const [collectionName, id] = key.split('/');
        return this.store.getVersion(collectionName, id) !== versionAtRead;
      });

      if (hasConflict) {
        continue;
      }

      for (const write of txn.pendingWrites) {
        const existing = this.store.read(write.collectionName, write.id);
        const baseData = write.merge && existing ? existing.data : {};
        const versionAtRead = txn.reads.get(`${write.collectionName}/${write.id}`) ?? (existing ? existing.version : 0);
        this.store.commit(write.collectionName, write.id, { ...baseData, ...write.data }, versionAtRead);
      }

      return result;
    }

    throw new Error('FakeFirestore.runTransaction: exceeded max retry attempts due to contention.');
  }
}
