import { createNotification, listNotifications, markNotificationRead } from './notificationService.js';
import { FakeFirestore } from './testUtils/fakeFirestore.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

describe('createNotification', () => {
  test('writes a document with expiresAt exactly 30 days after createdAt', async () => {
    const db = new FakeFirestore();

    const notification = await createNotification(db, {
      targetRole: 'MERCHANT',
      merchantId: 'm1',
      message: 'Your payout has been released.',
      category: 'VAULT_MATURED',
    });

    expect(notification.read).toBe(false);
    expect(notification.createdAt).toBeInstanceOf(Date);
    expect(notification.expiresAt).toBeInstanceOf(Date);
    expect(notification.expiresAt.getTime() - notification.createdAt.getTime()).toBe(THIRTY_DAYS_MS);

    const snap = await db.collection('notifications').doc(notification.notificationId).get();
    expect(snap.data().expiresAt).toBeInstanceOf(Date);
  });

  test('a platform-wide notification uses merchantId: null', async () => {
    const db = new FakeFirestore();

    const notification = await createNotification(db, {
      targetRole: 'ADMIN',
      merchantId: null,
      message: 'New chargeback logged.',
      category: 'CHARGEBACK_CREATED',
    });

    expect(notification.merchantId).toBeNull();
  });
});

describe('listNotifications — scoping', () => {
  test('a merchant sees their own notifications plus MERCHANT-wide broadcasts, not another merchant\'s or admin-targeted ones', async () => {
    const db = new FakeFirestore();
    await createNotification(db, { targetRole: 'MERCHANT', merchantId: 'm1', message: 'For m1 only', category: 'X' });
    await createNotification(db, { targetRole: 'MERCHANT', merchantId: 'm2', message: 'For m2 only', category: 'X' });
    await createNotification(db, { targetRole: 'MERCHANT', merchantId: null, message: 'Broadcast to all merchants', category: 'X' });
    await createNotification(db, { targetRole: 'ADMIN', merchantId: null, message: 'For admins only', category: 'X' });

    const result = await listNotifications(db, { merchantId: 'm1', isAdmin: false });

    const messages = result.items.map((n) => n.message).sort();
    expect(messages).toEqual(['Broadcast to all merchants', 'For m1 only'].sort());
  });

  test('an admin sees only ADMIN-targeted notifications', async () => {
    const db = new FakeFirestore();
    await createNotification(db, { targetRole: 'MERCHANT', merchantId: 'm1', message: 'For m1 only', category: 'X' });
    await createNotification(db, { targetRole: 'ADMIN', merchantId: null, message: 'For admins only', category: 'X' });

    const result = await listNotifications(db, { isAdmin: true });

    expect(result.items.map((n) => n.message)).toEqual(['For admins only']);
  });
});

describe('markNotificationRead — ownership', () => {
  test('a merchant marking their own notification read succeeds', async () => {
    const db = new FakeFirestore();
    const notification = await createNotification(db, {
      targetRole: 'MERCHANT',
      merchantId: 'm1',
      message: 'For m1 only',
      category: 'X',
    });

    const result = await markNotificationRead(db, { notificationId: notification.notificationId, merchantId: 'm1', isAdmin: false });
    expect(result.read).toBe(true);
  });

  test('a merchant marking another merchant\'s notification read is rejected', async () => {
    const db = new FakeFirestore();
    const notification = await createNotification(db, {
      targetRole: 'MERCHANT',
      merchantId: 'm2',
      message: 'For m2 only',
      category: 'X',
    });

    await expect(
      markNotificationRead(db, { notificationId: notification.notificationId, merchantId: 'm1', isAdmin: false })
    ).rejects.toThrow(/does not belong to the caller/);
  });
});
