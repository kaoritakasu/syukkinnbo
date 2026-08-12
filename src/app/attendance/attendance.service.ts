import { Injectable, Signal, computed, effect, inject, signal } from '@angular/core';
import {
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
import {
  AttendanceDayGroup,
  AttendanceMonthGroup,
  AttendanceRecord,
  AttendanceType,
  calculateActualWorkDurationMs,
  calculateBreakDurationMs,
  calculateWorkDurationMs,
  dateFormatter,
  formatDuration,
  getTypeLabel,
  groupDaysByMonth,
  isSameMinute,
  timeFormatter,
  toDateKey,
} from './attendance-format';

export type { AttendanceRecord, AttendanceDayGroup, AttendanceMonthGroup, AttendanceType };

const firestore = getFirestore(firebaseApp);
const HISTORY_LIMIT = 200;

export type AttendanceStatus = 'notClockedIn' | 'clockedIn' | 'onBreak' | 'clockedOut';

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly authService = inject(AuthService);

  // Newest first, sourced directly from the Firestore query order.
  private readonly records = signal<AttendanceRecord[]>([]);

  readonly todayStatus: Signal<AttendanceStatus> = computed(() => {
    const latest = this.records()[0];
    if (!latest) {
      return 'notClockedIn';
    }
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (latest.timestamp < startOfToday) {
      return 'notClockedIn';
    }
    switch (latest.type) {
      case 'clockIn':
      case 'breakEnd':
        return 'clockedIn';
      case 'breakStart':
        return 'onBreak';
      case 'clockOut':
        return 'clockedOut';
    }
  });

  readonly historyByDate: Signal<AttendanceDayGroup[]> = computed(() => {
    const groups = new Map<string, AttendanceDayGroup>();
    for (const record of this.records()) {
      let group = groups.get(toDateKey(record.timestamp));
      if (!group) {
        group = {
          dateKey: toDateKey(record.timestamp),
          dateLabel: dateFormatter.format(record.timestamp),
          records: [],
          workDurationLabel: '',
          breakDurationLabel: '',
          actualWorkDurationMs: 0,
          actualWorkDurationLabel: '',
        };
        groups.set(group.dateKey, group);
      }
      group.records.unshift(record);
    }
    for (const group of groups.values()) {
      group.workDurationLabel = formatDuration(calculateWorkDurationMs(group.records));
      group.breakDurationLabel = formatDuration(calculateBreakDurationMs(group.records));
      group.actualWorkDurationMs = calculateActualWorkDurationMs(group.records);
      group.actualWorkDurationLabel = formatDuration(group.actualWorkDurationMs);
    }
    return [...groups.values()];
  });

  readonly historyByMonth: Signal<AttendanceMonthGroup[]> = computed(() => groupDaysByMonth(this.historyByDate()));

  // Used to validate correction requests: the reported "original time" must
  // exactly match (to the minute) an actual punch of the same type.
  hasExactRecord(type: AttendanceType, at: Date): boolean {
    return this.records().some((record) => record.type === type && isSameMinute(record.timestamp, at));
  }

  private unsubscribeRecords: Unsubscribe | null = null;

  constructor() {
    effect(() => {
      const user = this.authService.user();

      this.unsubscribeRecords?.();
      this.unsubscribeRecords = null;

      if (!user) {
        this.records.set([]);
        return;
      }

      const recordsQuery = query(
        collection(firestore, 'users', user.uid, 'attendanceRecords'),
        orderBy('timestamp', 'desc'),
        limit(HISTORY_LIMIT),
      );

      this.unsubscribeRecords = onSnapshot(recordsQuery, (snapshot) => {
        this.records.set(
          snapshot.docs
            .filter((doc) => doc.data()['timestamp'])
            .map((doc) => {
              const data = doc.data();
              const timestamp = data['timestamp'].toDate();
              const type = data['type'] as AttendanceType;
              return {
                type,
                timestamp,
                timeLabel: timeFormatter.format(timestamp),
                typeLabel: getTypeLabel(type),
              };
            }),
        );
      });
    });
  }

  clockIn(): Promise<void> {
    return this.record('clockIn');
  }

  clockOut(): Promise<void> {
    return this.record('clockOut');
  }

  breakStart(): Promise<void> {
    return this.record('breakStart');
  }

  breakEnd(): Promise<void> {
    return this.record('breakEnd');
  }

 private async record(type: AttendanceType): Promise<void> {
    const user = this.authService.user();
    if (!user) {
      throw new Error('ログインしていません');
    }

    // ▼ GPSを取得する処理を追加
    const position = await this.getCurrentPosition();

    const recordsRef = collection(firestore, 'users', user.uid, 'attendanceRecords');
    
    // ▼ 保存するデータを組み立てる
    const recordData: any = {
      type,
      timestamp: serverTimestamp(),
    };

    if (position) {
      recordData.latitude = position.coords.latitude;
      recordData.longitude = position.coords.longitude;
    }

    await addDoc(recordsRef, recordData);
  }

private getCurrentPosition(): Promise<GeolocationPosition | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null); // GPS非対応ブラウザ
      } else {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos),
          (err) => resolve(null), // ユーザーが「許可しない」を押した時はエラーにせずスキップ
          { timeout: 5000, maximumAge: 0 } // 最大5秒待機
        );
      }
    });
  }
}