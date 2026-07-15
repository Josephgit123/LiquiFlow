import { logAdminAction, listAuditLogs } from './auditLogService.js';
import { FakeFirestore } from './testUtils/fakeFirestore.js';

describe('logAdminAction', () => {
  test('writes a /system_audit_logs entry with the documented fields', async () => {
    const db = new FakeFirestore();

    const log = await logAdminAction(db, {
      actorId: 'ADMIN',
      actionType: 'ADMIN_TEST_ACTION',
      targetId: 'm1',
      beforeState: { x: 1 },
      afterState: { x: 2 },
    });

    expect(log.logId).toBeTruthy();
    const snap = await db.collection('system_audit_logs').doc(log.logId).get();
    expect(snap.exists).toBe(true);
    expect(snap.data()).toMatchObject({
      actorId: 'ADMIN',
      actionType: 'ADMIN_TEST_ACTION',
      targetId: 'm1',
      beforeState: { x: 1 },
      afterState: { x: 2 },
    });
  });

  test('folds into an existing transaction when one is passed', async () => {
    const db = new FakeFirestore();

    await db.runTransaction(async (transaction) => {
      const ref = db.collection('merchants').doc('m1');
      transaction.set(ref, { merchantId: 'm1', accountStatus: 'ACTIVE' });
      await logAdminAction(db, {
        actorId: 'ADMIN',
        actionType: 'ADMIN_TEST_ACTION',
        targetId: 'm1',
        transaction,
      });
    });

    const logsSnap = await db.collection('system_audit_logs').get();
    expect(logsSnap.docs).toHaveLength(1);
  });

  test('rejects a missing actorId', async () => {
    const db = new FakeFirestore();
    await expect(logAdminAction(db, { actionType: 'X', targetId: 'm1' })).rejects.toThrow(/actorId/);
  });
});

describe('listAuditLogs — read-only', () => {
  test('never writes, and filters/paginates correctly', async () => {
    const db = new FakeFirestore();
    await logAdminAction(db, { actorId: 'ADMIN', actionType: 'TYPE_A', targetId: 't1' });
    await logAdminAction(db, { actorId: 'ADMIN', actionType: 'TYPE_B', targetId: 't2' });
    await logAdminAction(db, { actorId: 'ADMIN', actionType: 'TYPE_A', targetId: 't3' });

    const result = await listAuditLogs(db, { actionType: 'TYPE_A', limit: 20, offset: 0 });

    expect(result.items).toHaveLength(2);
    expect(result.items.every((l) => l.actionType === 'TYPE_A')).toBe(true);

    // Confirm nothing was written by the read.
    const allLogs = await db.collection('system_audit_logs').get();
    expect(allLogs.docs).toHaveLength(3);
  });

  test('pagination hasMore flag is correct', async () => {
    const db = new FakeFirestore();
    for (let i = 0; i < 5; i += 1) {
      await logAdminAction(db, { actorId: 'ADMIN', actionType: 'TYPE_A', targetId: `t${i}` });
    }

    const page1 = await listAuditLogs(db, { limit: 2, offset: 0 });
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    const page3 = await listAuditLogs(db, { limit: 2, offset: 4 });
    expect(page3.items).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
  });
});
