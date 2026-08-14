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
  setDoc,
  doc,
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
  readonly records = signal<AttendanceRecord[]>([]);

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

  private readonly weeklyWorkHoursMs: Signal<number> = computed(() => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);

    let totalMs = 0;
    for (const group of this.historyByDate()) {
      const dayDate = new Date(group.dateKey);
      if (dayDate >= weekStart) {
        totalMs += group.actualWorkDurationMs;
      }
    }
    return totalMs;
  });

  readonly weeklyWorkHours: Signal<number> = computed(() => this.weeklyWorkHoursMs() / (1000 * 60 * 60));

  // Used to validate correction requests: the reported "original time" must
  // exactly match (to the minute) an actual punch of the same type.
  hasExactRecord(type: AttendanceType, at: Date): boolean {
    return this.records().some((record) => record.type === type && isSameMinute(record.timestamp, at));
  }

  private unsubscribeRecords: Unsubscribe | null = null;
  private notifiedWeekStart: string | null = null;

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
                latitude: data['latitude'],
                longitude: data['longitude'],
              };
            }),
        );
      });
   });

    effect(() => {
      const user = this.authService.user();
      if (!user) return;

      const hours = this.weeklyWorkHours();
      const now = new Date();
      const dayOfWeek = now.getDay();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - dayOfWeek);
      const weekStartKey = toDateKey(weekStart);

      if (hours >= 35 && this.notifiedWeekStart !== weekStartKey) {
        this.notifiedWeekStart = weekStartKey;
        this.createNotification(user.uid, user.email || '');
      }
    });
  }

  private async createNotification(userId: string, userEmail: string): Promise<void> {
    try {
      const notifRef = doc(collection(firestore, 'notifications'));
      await setDoc(notifRef, {
        userId,
        userEmail,
        type: 'weekly35hours',
        timestamp: serverTimestamp(),
        read: false,
      });
    } catch (error) {
      console.error('Failed to create notification:', error);
    }
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

    const position = await this.getCurrentPosition();

    const recordsRef = collection(firestore, 'users', user.uid, 'attendanceRecords');

    const recordData: any = {
      type,
      timestamp: serverTimestamp(),
    };

    if (position) {
      recordData.latitude = position.lat;
      recordData.longitude = position.lng;
    }

    await addDoc(recordsRef, recordData);
  }

private getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
      } else {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          (err) => resolve(null),
          { timeout: 5000, maximumAge: 0 }
        );
      }
    });
  }
}