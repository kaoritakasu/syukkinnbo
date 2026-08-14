import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { QueryDocumentSnapshot } from 'firebase-admin/firestore';

admin.initializeApp();
const firestore = admin.firestore();

interface User {
  email?: string;
  displayName?: string;
  role?: string;
}

interface Notification {
  userId: string;
  userEmail: string;
  type: string;
  timestamp: admin.firestore.Timestamp;
  read: boolean;
  notificationSent?: boolean;
}

export const onNotificationCreated = functions.firestore
  .document('notifications/{notificationId}')
  .onCreate(async (snapshot: QueryDocumentSnapshot): Promise<void> => {
    const notification = snapshot.data() as Notification;
    console.log('[35h-CF] Trigger fired for notification:', { docId: snapshot.id, type: notification.type, notificationSent: notification.notificationSent });

    if (notification.type !== 'weekly35hours' || notification.notificationSent) {
      console.log('[35h-CF] Skipping (not weekly35hours or already sent):', { type: notification.type, notificationSent: notification.notificationSent });
      return;
    }

    try {
      console.log('[35h-CF] Processing weekly35hours notification for user:', notification.userId);
      const userDoc = await firestore.collection('users').doc(notification.userId).get();
      const user = userDoc.data() as User | undefined;
      console.log('[35h-CF] User data retrieved:', { userId: notification.userId, displayName: user?.displayName, email: notification.userEmail });

      const admins = await firestore
        .collection('users')
        .where('role', '==', 'admin')
        .get();
      console.log('[35h-CF] Found admins:', { count: admins.docs.length, adminIds: admins.docs.map((doc) => doc.id) });

      const notificationMessage = {
        title: '週間労働時間が35時間に達しました',
        body: `ユーザー: ${user?.displayName || notification.userEmail} (${notification.userEmail})`,
        timestamp: new Date().toISOString(),
        userId: notification.userId,
        userEmail: notification.userEmail,
      };

      const adminIds = admins.docs.map((doc) => doc.id);

      for (const adminId of adminIds) {
        await firestore
          .collection('users')
          .doc(adminId)
          .collection('notifications')
          .add({
            type: 'weekly35hours_alert',
            title: notificationMessage.title,
            body: notificationMessage.body,
            userId: notification.userId,
            userEmail: notification.userEmail,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            read: false,
          });
        console.log('[35h-CF] Admin notification created for:', adminId);
      }

      await snapshot.ref.update({ notificationSent: true });
      console.log('[35h-CF] Notification processing completed successfully');
    } catch (error) {
      console.error('[35h-CF] Error processing notification:', error);
      throw new functions.https.HttpsError(
        'internal',
        'Failed to process notification'
      );
    }
  });
