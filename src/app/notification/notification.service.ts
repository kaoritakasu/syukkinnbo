import { Injectable, Signal, computed, effect, inject, signal } from '@angular/core';
import {
  Unsubscribe,
  collection,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';

import { AuthService } from '../auth/auth.service';
import { firebaseApp } from '../core/firebase-app';

const firestore = getFirestore(firebaseApp);

export interface NotificationRecord {
  id: string;
  type: string;
  title: string;
  body: string;
  userId?: string;
  userEmail?: string;
  timestamp: Date;
  read: boolean;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly authService = inject(AuthService);
  readonly notifications = signal<NotificationRecord[]>([]);

  private unsubscribeNotifications: Unsubscribe | null = null;

  constructor() {
    effect(() => {
      const user = this.authService.user();

      this.unsubscribeNotifications?.();
      this.unsubscribeNotifications = null;

      if (!user) {
        this.notifications.set([]);
        return;
      }

      const notificationsQuery = query(
        collection(firestore, 'users', user.uid, 'notifications'),
        orderBy('timestamp', 'desc')
      );

      console.log('[Notification] Subscribing to user notifications:', user.uid);
      this.unsubscribeNotifications = onSnapshot(notificationsQuery, (snapshot) => {
        const notifs = snapshot.docs.map((doc) => ({
          id: doc.id,
          type: doc.data()['type'],
          title: doc.data()['title'],
          body: doc.data()['body'],
          userId: doc.data()['userId'],
          userEmail: doc.data()['userEmail'],
          timestamp: doc.data()['timestamp']?.toDate() || new Date(),
          read: doc.data()['read'] || false,
        } as NotificationRecord));

        console.log('[Notification] Notifications received:', { count: notifs.length, notifications: notifs });
        this.notifications.set(notifs);
      });
    });
  }

  markAsRead(notificationId: string): Promise<void> {
    const user = this.authService.user();
    if (!user) return Promise.reject('Not logged in');

    return new Promise((resolve, reject) => {
      const docRef = collection(firestore, 'users', user.uid, 'notifications');
      console.log('[Notification] Marking as read:', notificationId);
      // TODO: Implement update logic
      resolve();
    });
  }
}
