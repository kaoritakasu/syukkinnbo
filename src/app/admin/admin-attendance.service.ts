import { Injectable, Signal, computed, signal } from '@angular/core';
import { Unsubscribe, collection, collectionGroup, getFirestore, limit, onSnapshot, orderBy, query } from 'firebase/firestore';

import { firebaseApp } from '../core/firebase-app';
import {
  AttendanceDayGroup,
  AttendanceMonthGroup,
  AttendanceType,
  calculateActualWorkDurationMs,
  calculateBreakDurationMs,
  calculateWorkDurationMs,
  dateFormatter,
  formatDuration,
  getTypeLabel,
  groupDaysByMonth,
  timeFormatter,
  toDateKey,
} from '../attendance/attendance-format';

const firestore = getFirestore(firebaseApp);
const RECORDS_LIMIT = 2000;

interface RawRecord {
  uid: string;
  type: AttendanceType;
  timestamp: Date;
  latitude?: number;
  longitude?: number;
}

export interface AdminUserHistory {
  uid: string;
  displayName: string;
  months: AttendanceMonthGroup[];
}

@Injectable({ providedIn: 'root' })
export class AdminAttendanceService {
  private readonly userNames = signal<Map<string, string>>(new Map());
  private readonly rawRecords = signal<RawRecord[]>([]);

  private unsubscribeUsers: Unsubscribe | null = null;
  private unsubscribeRecords: Unsubscribe | null = null;

  readonly historyByUser: Signal<AdminUserHistory[]> = computed(() => {
    const names = this.userNames();
    const perUser = new Map<string, { displayName: string; dayGroups: Map<string, AttendanceDayGroup> }>();

    for (const record of this.rawRecords()) {
      let userEntry = perUser.get(record.uid);
      if (!userEntry) {
        userEntry = { displayName: names.get(record.uid) ?? record.uid, dayGroups: new Map() };
        perUser.set(record.uid, userEntry);
      }

      const dateKey = toDateKey(record.timestamp);
      let dayGroup = userEntry.dayGroups.get(dateKey);
      if (!dayGroup) {
        dayGroup = {
          dateKey,
          dateLabel: dateFormatter.format(record.timestamp),
          records: [],
          workDurationLabel: '',
          breakDurationLabel: '',
          actualWorkDurationMs: 0,
          actualWorkDurationLabel: '',
        };
        userEntry.dayGroups.set(dateKey, dayGroup);
      }

      dayGroup.records.unshift({
        type: record.type,
        timestamp: record.timestamp,
        timeLabel: timeFormatter.format(record.timestamp),
        typeLabel: getTypeLabel(record.type),
        latitude: record.latitude,
        longitude: record.longitude,
      });
    }

    return [...perUser.entries()]
      .map(([uid, entry]) => {
        const days = [...entry.dayGroups.values()];
        for (const day of days) {
          day.workDurationLabel = formatDuration(calculateWorkDurationMs(day.records));
          day.breakDurationLabel = formatDuration(calculateBreakDurationMs(day.records));
          day.actualWorkDurationMs = calculateActualWorkDurationMs(day.records);
          day.actualWorkDurationLabel = formatDuration(day.actualWorkDurationMs);
        }
        return { uid, displayName: entry.displayName, months: groupDaysByMonth(days) };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ja'));
  });

  start(): void {
    if (this.unsubscribeUsers || this.unsubscribeRecords) {
      return;
    }

    this.unsubscribeUsers = onSnapshot(collection(firestore, 'users'), (snapshot) => {
      const names = new Map<string, string>();
      snapshot.forEach((userDoc) => {
        names.set(userDoc.id, (userDoc.data()['displayName'] as string) || userDoc.id);
      });
      this.userNames.set(names);
    });

    const recordsQuery = query(
      collectionGroup(firestore, 'attendanceRecords'),
      orderBy('timestamp', 'desc'),
      limit(RECORDS_LIMIT),
    );

    this.unsubscribeRecords = onSnapshot(recordsQuery, (snapshot) => {
      this.rawRecords.set(
        snapshot.docs
          .filter((recordDoc) => recordDoc.data()['timestamp'])
          .map((recordDoc) => ({
            uid: recordDoc.ref.parent.parent!.id,
            type: recordDoc.data()['type'] as AttendanceType,
            timestamp: recordDoc.data()['timestamp'].toDate(),
            latitude: recordDoc.data()['latitude'],
            longitude: recordDoc.data()['longitude'],
          })),
      );
    });
  }

  stop(): void {
    this.unsubscribeUsers?.();
    this.unsubscribeRecords?.();
    this.unsubscribeUsers = null;
    this.unsubscribeRecords = null;
    this.rawRecords.set([]);
  }
}
