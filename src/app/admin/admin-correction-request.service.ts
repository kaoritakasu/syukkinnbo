import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import {
  DocumentReference,
  Timestamp,
  Unsubscribe,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { AttendanceType, getTypeLabel, isSameMinute } from '../attendance/attendance-format';
import {
  CorrectionRequestStatus,
  CorrectionRequestType,
  dateTimeFormatter,
  getCorrectionStatusLabel,
  getCorrectionRequestTypeLabel,
} from '../attendance/correction-request.service';
import { AuthService } from '../auth/auth.service';
import { firebaseApp } from '../core/firebase-app';

const firestore = getFirestore(firebaseApp);
const REQUESTS_LIMIT = 500;

interface RawRequest {
  id: string;
  uid: string;
  requestType: CorrectionRequestType;
  type: AttendanceType;
  originalAt: Date;
  correctedAt?: Date;
  reason: string;
  status: CorrectionRequestStatus;
}

export interface AdminCorrectionRequest {
  id: string;
  uid: string;
  displayName: string;
  requestType: CorrectionRequestType;
  requestTypeLabel: string;
  type: AttendanceType;
  typeLabel: string;
  originalAt: Date;
  originalLabel: string;
  correctedAt?: Date;
  correctedLabel?: string;
  reason: string;
  status: CorrectionRequestStatus;
  statusLabel: string;
}

@Injectable({ providedIn: 'root' })
export class AdminCorrectionRequestService {
  private readonly authService = inject(AuthService);

  private readonly userNames = signal<Map<string, string>>(new Map());
  private readonly rawRequests = signal<RawRequest[]>([]);

  private unsubscribeUsers: Unsubscribe | null = null;
  private unsubscribeRequests: Unsubscribe | null = null;

  readonly requests: Signal<AdminCorrectionRequest[]> = computed(() => {
    const names = this.userNames();
    return this.rawRequests().map((request) => ({
      id: request.id,
      uid: request.uid,
      displayName: names.get(request.uid) ?? request.uid,
      requestType: request.requestType,
      requestTypeLabel: getCorrectionRequestTypeLabel(request.requestType),
      type: request.type,
      typeLabel: getTypeLabel(request.type),
      originalAt: request.originalAt,
      originalLabel: dateTimeFormatter.format(request.originalAt),
      correctedAt: request.correctedAt,
      correctedLabel: request.correctedAt ? dateTimeFormatter.format(request.correctedAt) : undefined,
      reason: request.reason,
      status: request.status,
      statusLabel: getCorrectionStatusLabel(request.status),
    }));
  });

  start(): void {
    if (this.unsubscribeUsers || this.unsubscribeRequests) {
      return;
    }

    this.unsubscribeUsers = onSnapshot(collection(firestore, 'users'), (snapshot) => {
      const names = new Map<string, string>();
      snapshot.forEach((userDoc) => {
        names.set(userDoc.id, (userDoc.data()['displayName'] as string) || userDoc.id);
      });
      this.userNames.set(names);
    });

    const requestsQuery = query(
      collectionGroup(firestore, 'correctionRequests'),
      orderBy('createdAt', 'desc'),
      limit(REQUESTS_LIMIT),
    );

    this.unsubscribeRequests = onSnapshot(requestsQuery, (snapshot) => {
      this.rawRequests.set(
        snapshot.docs
          .filter((requestDoc) => requestDoc.data()['createdAt'])
          .map((requestDoc) => {
            const data = requestDoc.data();
            const correctedAtTs = data['correctedAt'] as Timestamp | undefined;
            return {
              id: requestDoc.id,
              uid: requestDoc.ref.parent.parent!.id,
              requestType: (data['requestType'] || 'modify') as CorrectionRequestType,
              type: data['type'] as AttendanceType,
              originalAt: (data['originalAt'] as Timestamp).toDate(),
              correctedAt: correctedAtTs?.toDate(),
              reason: data['reason'] as string,
              status: data['status'] as CorrectionRequestStatus,
            };
          }),
      );
    });
  }

  reject(uid: string, requestId: string): Promise<void> {
    return this.updateStatus(uid, requestId, 'rejected');
  }

  private updateStatus(uid: string, requestId: string, status: 'approved' | 'rejected'): Promise<void> {
    const adminEmail = this.authService.user()?.email;
    if (!adminEmail) {
      throw new Error('管理者としてログインしていません');
    }

    return updateDoc(doc(firestore, 'users', uid, 'correctionRequests', requestId), {
      status,
      reviewedAt: serverTimestamp(),
      reviewedBy: adminEmail,
    });
  }

  async approve(uid: string, requestId: string): Promise<void> {
    const adminEmail = this.authService.user()?.email;
    if (!adminEmail) {
      throw new Error('管理者としてログインしていません');
    }

    const request = this.rawRequests().find((r) => r.uid === uid && r.id === requestId);
    if (!request) {
      throw new Error('申請が見つかりません');
    }

    const batch = writeBatch(firestore);

    batch.update(doc(firestore, 'users', uid, 'correctionRequests', requestId), {
      status: 'approved',
      reviewedAt: serverTimestamp(),
      reviewedBy: adminEmail,
    });

    if (request.requestType === 'modify') {
      const match = await this.findMatchingRecord(uid, request.type, request.originalAt);
      if (!match) {
        throw new Error('修正対象の打刻記録が見つかりません');
      }
      if (!request.correctedAt) {
        throw new Error('修正申請に修正後の日時が設定されていません');
      }
      batch.update(match.ref, {
        type: request.type,
        timestamp: Timestamp.fromDate(request.correctedAt),
        correctedFrom: match.timestamp,
      });
    } else if (request.requestType === 'add') {
      const timestamp = request.correctedAt || request.originalAt;
      if (!timestamp) {
        throw new Error('追加申請に日時が設定されていません');
      }
      batch.set(doc(collection(firestore, 'users', uid, 'attendanceRecords')), {
        type: request.type,
        timestamp: Timestamp.fromDate(timestamp),
      });
    } else if (request.requestType === 'delete') {
      const match = await this.findMatchingRecord(uid, request.type, request.originalAt);
      if (!match) {
        throw new Error('削除対象の打刻記録が見つかりません');
      }
      batch.delete(match.ref);
    }

    await batch.commit();
  }

  // Looks for the punch of the same type, on the same calendar day, whose
  // timestamp falls in the same minute as the reported mistake time (the
  // request form only accepts submission when such a record exists). Returns
  // null when the employee forgot to punch at all (no candidate that day).
  private async findMatchingRecord(
    uid: string,
    type: AttendanceType,
    originalAt: Date,
  ): Promise<{ ref: DocumentReference; timestamp: Timestamp } | null> {
    const startOfDay = new Date(originalAt);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const dayQuery = query(
      collection(firestore, 'users', uid, 'attendanceRecords'),
      where('timestamp', '>=', Timestamp.fromDate(startOfDay)),
      where('timestamp', '<', Timestamp.fromDate(endOfDay)),
    );

    const snapshot = await getDocs(dayQuery);

    let best: { ref: DocumentReference; timestamp: Timestamp } | null = null;
    let bestDiffMs = Infinity;

    for (const recordDoc of snapshot.docs) {
      const data = recordDoc.data();
      if (data['type'] !== type || !data['timestamp']) {
        continue;
      }
      const timestamp = data['timestamp'] as Timestamp;
      if (!isSameMinute(timestamp.toDate(), originalAt)) {
        continue;
      }
      const diffMs = Math.abs(timestamp.toMillis() - originalAt.getTime());
      if (diffMs < bestDiffMs) {
        bestDiffMs = diffMs;
        best = { ref: recordDoc.ref, timestamp };
      }
    }

    return best;
  }

  stop(): void {
    this.unsubscribeUsers?.();
    this.unsubscribeRequests?.();
    this.unsubscribeUsers = null;
    this.unsubscribeRequests = null;
    this.rawRequests.set([]);
  }
}
