import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
admin.initializeApp();
const firestore = admin.firestore();
export const onNotificationCreated = functions.firestore
    .document('notifications/{notificationId}')
    .onCreate(async (snapshot) => {
    const notification = snapshot.data();
    if (notification.type !== 'weekly35hours' || notification.notificationSent) {
        return;
    }
    try {
        const userDoc = await firestore.collection('users').doc(notification.userId).get();
        const user = userDoc.data();
        const admins = await firestore
            .collection('users')
            .where('role', '==', 'admin')
            .get();
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
        }
        await snapshot.ref.update({ notificationSent: true });
    }
    catch (error) {
        console.error('Error processing notification:', error);
        throw new functions.https.HttpsError('internal', 'Failed to process notification');
    }
});
//# sourceMappingURL=index.js.map