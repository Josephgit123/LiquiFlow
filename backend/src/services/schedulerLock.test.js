import { acquireSchedulerLock, releaseSchedulerLock } from './schedulerLock.js';
import { FakeFirestore } from './testUtils/fakeFirestore.js';

const START = new Date('2026-01-01T00:00:00.000Z').getTime();

describe('acquireSchedulerLock', () => {
  beforeEach(() => {
    // Fake only Date/time-related globals so FakeFirestore's internal
    // setTimeout-based read delay still fires for real.
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout'] });
    jest.setSystemTime(START);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('the first caller acquires the lock', async () => {
    const db = new FakeFirestore();
    const acquired = await acquireSchedulerLock(db, 'worker-a', 90000);
    expect(acquired).toBe(true);
  });

  test('a second workerId is denied while the lease is still valid', async () => {
    const db = new FakeFirestore();
    await acquireSchedulerLock(db, 'worker-a', 90000);

    const acquired = await acquireSchedulerLock(db, 'worker-b', 90000);
    expect(acquired).toBe(false);
  });

  test('a different workerId can acquire the lock once the lease has expired', async () => {
    const db = new FakeFirestore();
    await acquireSchedulerLock(db, 'worker-a', 90000);

    jest.setSystemTime(START + 90001);

    const acquired = await acquireSchedulerLock(db, 'worker-b', 90000);
    expect(acquired).toBe(true);
  });

  test('the same workerId renews its own lease before expiry, extending the deadline', async () => {
    const db = new FakeFirestore();
    await acquireSchedulerLock(db, 'worker-a', 90000);

    jest.setSystemTime(START + 30000);
    const renewed = await acquireSchedulerLock(db, 'worker-a', 90000);
    expect(renewed).toBe(true);

    // Original lease (granted at START) would have expired at START+90000.
    // The renewal at START+30000 pushes it to START+120000, so a
    // competitor at START+95000 must still be denied.
    jest.setSystemTime(START + 95000);
    const stillDenied = await acquireSchedulerLock(db, 'worker-b', 90000);
    expect(stillDenied).toBe(false);
  });
});

describe('releaseSchedulerLock', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout'] });
    jest.setSystemTime(START);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('releases a lock held by the given workerId, allowing immediate reacquisition', async () => {
    const db = new FakeFirestore();
    await acquireSchedulerLock(db, 'worker-a', 90000);
    await releaseSchedulerLock(db, 'worker-a');

    const acquired = await acquireSchedulerLock(db, 'worker-b', 90000);
    expect(acquired).toBe(true);
  });

  test('does not release a lock held by a different workerId', async () => {
    const db = new FakeFirestore();
    await acquireSchedulerLock(db, 'worker-a', 90000);
    await releaseSchedulerLock(db, 'worker-b'); // not the holder — no-op

    const acquired = await acquireSchedulerLock(db, 'worker-b', 90000);
    expect(acquired).toBe(false); // worker-a's lock is still valid
  });

  test('releasing a lock that does not exist is a harmless no-op', async () => {
    const db = new FakeFirestore();
    await expect(releaseSchedulerLock(db, 'worker-a')).resolves.toBeUndefined();
  });
});
