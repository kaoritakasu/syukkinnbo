export type AttendanceType = 'clockIn' | 'clockOut' | 'breakStart' | 'breakEnd';
export interface AttendanceRecord {
  type: AttendanceType;
  timestamp: Date;
  timeLabel: string;
  typeLabel: string;
  latitude?: number;
  longitude?: number;
}

const TYPE_LABELS: Record<AttendanceType, string> = {
  clockIn: '出勤',
  clockOut: '退勤',
  breakStart: '休憩開始',
  breakEnd: '休憩終了',
};

export function getTypeLabel(type: AttendanceType): string {
  return TYPE_LABELS[type];
}

export interface AttendanceDayGroup {
  dateKey: string;
  dateLabel: string;
  records: AttendanceRecord[];
  workDurationLabel: string;
  breakDurationLabel: string;
  actualWorkDurationMs: number;
  actualWorkDurationLabel: string;
}

export interface AttendanceMonthGroup {
  monthKey: string;
  monthLabel: string;
  actualWorkDurationLabel: string;
  days: AttendanceDayGroup[];
}

export const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
export const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
});
export const monthFormatter = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long' });

export function isSameMinute(a: Date, b: Date): boolean {
  return Math.floor(a.getTime() / 60000) === Math.floor(b.getTime() / 60000);
}

export function toDateKey(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// days must be sorted newest first; grouping preserves that order for months.
export function groupDaysByMonth(days: AttendanceDayGroup[]): AttendanceMonthGroup[] {
  const groups = new Map<string, AttendanceMonthGroup>();
  for (const day of days) {
    const monthKey = day.dateKey.slice(0, 7);
    let group = groups.get(monthKey);
    if (!group) {
      group = {
        monthKey,
        monthLabel: monthFormatter.format(day.records[0]?.timestamp ?? new Date()),
        actualWorkDurationLabel: '',
        days: [],
      };
      groups.set(monthKey, group);
    }
    group.days.push(day);
  }
  for (const group of groups.values()) {
    const totalMs = group.days.reduce((sum, day) => sum + day.actualWorkDurationMs, 0);
    group.actualWorkDurationLabel = formatDuration(totalMs);
  }
  return [...groups.values()];
}

// records must be in chronological (ascending) order; unmatched trailing clockIn is ignored.
export function calculateWorkDurationMs(records: { type: AttendanceType; timestamp: Date }[]): number {
  let totalMs = 0;
  let clockInAt: Date | null = null;
  for (const record of records) {
    if (record.type === 'clockIn') {
      clockInAt = record.timestamp;
    } else if (record.type === 'clockOut' && clockInAt) {
      totalMs += record.timestamp.getTime() - clockInAt.getTime();
      clockInAt = null;
    }
  }
  return totalMs;
}

// records must be in chronological (ascending) order; unmatched trailing breakStart is ignored.
export function calculateBreakDurationMs(records: { type: AttendanceType; timestamp: Date }[]): number {
  let totalMs = 0;
  let breakStartAt: Date | null = null;
  for (const record of records) {
    if (record.type === 'breakStart') {
      breakStartAt = record.timestamp;
    } else if (record.type === 'breakEnd' && breakStartAt) {
      totalMs += record.timestamp.getTime() - breakStartAt.getTime();
      breakStartAt = null;
    }
  }
  return totalMs;
}

export function calculateActualWorkDurationMs(records: { type: AttendanceType; timestamp: Date }[]): number {
  return Math.max(0, calculateWorkDurationMs(records) - calculateBreakDurationMs(records));
}

export function formatDuration(ms: number): string {
  if (ms <= 0) {
    return '';
  }
  const totalMinutes = Math.round(ms / 60000);
  return `${Math.floor(totalMinutes / 60)}時間${totalMinutes % 60}分`;
}
