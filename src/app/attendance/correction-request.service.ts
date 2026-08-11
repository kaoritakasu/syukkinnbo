import { Injectable, Signal, effect, inject, signal } from '@angular/core';
import {
  Timestamp,
  Unsubscribe,
  addDoc,
  collection,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';

import { AuthService } from '../auth/auth.service';
import { firebaseApp } from '../core/firebase-app';
import { AttendanceType, getTypeLabel } from './attendance-format';

const firestore = getFirestore(firebaseApp);
const REQUESTS_LIMIT = 100;

export const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export type CorrectionRequestStatus = 'pending' | 'approved' | 'rejected';

const STATUS_LABELS: Record<CorrectionRequestStatus, string> = {
  pending: '申請中',
  approved: '承認済み',
  rejected: '却下',
};

export function getCorrectionStatusLabel(status: CorrectionRequestStatus): string {
  return STATUS_LABELS[status];
}

export interface CorrectionRequestInput {
  type: AttendanceType;
  originalAt: Date;
  correctedAt: Date;
  reason: string;
}

export interface CorrectionRequest {
  id: string;
  type: AttendanceType;
  typeLabel: string;
  originalAt: Date;
  originalLabel: string;
  correctedAt: Date;
  correctedLabel: string;
  reason: string;
  status: CorrectionRequestStatus;
  statusLabel: string;
}

@Injectable({ providedIn: 'root' })
export class CorrectionRequestService {
  private readonly authService = inject(AuthService);

  // Newest first, sourced directly from the Firestore query order.
  private readonly requestsSignal = signal<CorrectionRequest[]>([]);

  readonly requests: Signal<CorrectionRequest[]> = this.requestsSignal;

  private unsubscribeRequests: Unsubscribe | null = null;

  constructor() {
    effect(() => {
      const user = this.authService.user();

      this.unsubscribeRequests?.();
      this.unsubscribeRequests = null;

      if (!user) {
        this.requestsSignal.set([]);
        return;
      }

      const requestsQuery = query(
        collection(firestore, 'users', user.uid, 'correctionRequests'),
        orderBy('createdAt', 'desc'),
        limit(REQUESTS_LIMIT),
      );

      this.unsubscribeRequests = onSnapshot(requestsQuery, (snapshot) => {
        this.requestsSignal.set(
          snapshot.docs
            .filter((doc) => doc.data()['createdAt'])
            .map((doc) => {
              const data = doc.data();
              const type = data['type'] as AttendanceType;
              const originalAt = (data['originalAt'] as Timestamp).toDate();
              const correctedAt = (data['correctedAt'] as Timestamp).toDate();
              const status = data['status'] as CorrectionRequestStatus;
              return {
                id: doc.id,
                type,
                typeLabel: getTypeLabel(type),
                originalAt,
                originalLabel: dateTimeFormatter.format(originalAt),
                correctedAt,
                correctedLabel: dateTimeFormatter.format(correctedAt),
                reason: data['reason'] as string,
                status,
                statusLabel: getCorrectionStatusLabel(status),
              };
            }),
        );
      });
    });
  }

  async submit(input: CorrectionRequestInput): Promise<void> {
    const user = this.authService.user();
    if (!user) {
      throw new Error('ログインしていません');
    }

    const requestsRef = collection(firestore, 'users', user.uid, 'correctionRequests');
    await addDoc(requestsRef, {
      type: input.type,
      originalAt: Timestamp.fromDate(input.originalAt),
      correctedAt: Timestamp.fromDate(input.correctedAt),
      reason: input.reason,
      status: 'pending',
      createdAt: serverTimestamp(),
    });
  }
}
