import { Component, DestroyRef, computed, inject, signal, effect } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { collection, getDocs, getFirestore, query, collectionGroup, where, onSnapshot, updateDoc, doc, writeBatch, serverTimestamp, Timestamp, getDoc, QueryDocumentSnapshot, QuerySnapshot } from 'firebase/firestore';

import { AttendanceType } from './attendance/attendance-format';
import { AttendanceService } from './attendance/attendance.service';
import { CorrectionRequestService } from './attendance/correction-request.service';
import { AuthService } from './auth/auth.service';

const CORRECTION_TYPE_OPTIONS: { value: AttendanceType; label: string }[] = [
  { value: 'clockIn', label: '出勤' },
  { value: 'clockOut', label: '退勤' },
  { value: 'breakStart', label: '休憩開始' },
  { value: 'breakEnd', label: '休憩終了' },
];

const TYPE_LABELS: { [key: string]: string } = {
  'clockIn': '出勤',
  'clockOut': '退勤',
  'breakStart': '休憩開始',
  'breakEnd': '休憩終了',
};

const clockDateFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
});

const clockTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const STATUS_LABELS: any = {
  notClockedIn: '未出勤',
  clockedIn: '出勤中',
  onBreak: '休憩中',
  clockedOut: '退勤済み',
};

@Component({
  selector: 'app-root',
  imports: [DatePipe, RouterLink, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('Pathoslogos 出勤簿');
  protected readonly authService = inject(AuthService);
  protected readonly attendanceService = inject(AttendanceService);
  protected readonly correctionRequestService = inject(CorrectionRequestService);
  protected readonly isAdmin = computed(() => this.authService.user()?.email === 'kaori.takasu@pathoslogos.co.jp');
  protected readonly pendingCorrectionCount = signal<number>(0);
  protected readonly pendingRequests = signal<any[]>([]);
  protected readonly showPendingRequests = signal(false);
  protected readonly showAdminPopup = signal(false);
  protected readonly showResultPopup = signal(false);
  
  // ▼ これが足りなかったスイッチ（変数） ▼
  protected readonly showRequestHistory = signal(false);
  
  protected readonly reviewedRequests = signal<any[]>([]);
  private unsubscribePendingRequests: any = null;
  protected readonly saving = signal(false);
  protected readonly reviewingRequestId = signal<string | null>(null);
  protected readonly statusMessage = signal<string | null>(null);
  protected readonly statusLabel = computed(() => STATUS_LABELS[this.attendanceService.todayStatus()]);

  protected readonly correctionTypeOptions = CORRECTION_TYPE_OPTIONS;
  protected readonly typeLabels = TYPE_LABELS;
  protected readonly showCorrectionForm = signal(false);
  protected readonly showHistory = signal(false);
  protected readonly correctionType = signal<AttendanceType>('clockIn');
  protected readonly correctionOriginalAt = signal('');
  protected readonly correctionCorrectedAt = signal('');
  protected readonly correctionReason = signal('');
  protected readonly correctionSaving = signal(false);
  protected readonly correctionMessage = signal<string | null>(null);

  protected readonly now = signal(new Date());
  protected readonly nowDateLabel = computed(() => clockDateFormatter.format(this.now()));
  protected readonly nowTimeLabel = computed(() => clockTimeFormatter.format(this.now()));

  protected readonly workingMembers = signal<{ uid: string; displayName: string }[]>([]);
  protected readonly router = inject(Router);
  protected readonly currentRoute = signal<string>('/');
  protected readonly hasPunchedInToday = signal(false);
  protected readonly hasPunchedOutToday = signal(false);

  constructor() {
    const intervalId = setInterval(() => this.now.set(new Date()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(intervalId));
    this.loadWorkingMembers();
    const membersIntervalId = setInterval(() => this.loadWorkingMembers(), 10000);
    inject(DestroyRef).onDestroy(() => clearInterval(membersIntervalId));

    this.router.events
      .pipe(
        filter(event => event instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe((event: any) => {
        this.currentRoute.set(event.url);
      });

    effect(() => {
      if (this.isAdmin()) {
        const db = getFirestore();
        const pendingQuery = query(
          collectionGroup(db, 'correctionRequests'),
          where('status', '==', 'pending')
        );

        this.unsubscribePendingRequests = onSnapshot(pendingQuery, async (snapshot: QuerySnapshot) => {
          this.pendingCorrectionCount.set(snapshot.docs.length);

          const requests = await Promise.all(
            snapshot.docs.map(async (docSnap: QueryDocumentSnapshot) => {
              const data = docSnap.data();
              const userId = docSnap.ref.parent?.parent?.id;

              let userDisplayName = '不明なユーザー';
              if (userId) {
                try {
                  const userDoc = await getDoc(doc(db, 'users', userId));
                  if (userDoc.exists()) {
                    userDisplayName = userDoc.data()['displayName'] || '不明なユーザー';
                  }
                } catch (err) {
                  console.error('Failed to load user:', err);
                }
              }

              return {
                id: docSnap.id,
                userId,
                userDisplayName,
                type: data['type'],
                originalAt: data['originalAt'].toDate(),
                originalAtTimestamp: data['originalAt'],
                correctedAt: data['correctedAt'].toDate(),
                correctedAtTimestamp: data['correctedAt'],
                reason: data['reason'],
                status: data['status'],
                createdAt: data['createdAt'].toDate(),
              };
            })
          );
          this.pendingRequests.set(requests);
        });
      } else {
        if (this.unsubscribePendingRequests) {
          this.unsubscribePendingRequests();
        }
        this.pendingCorrectionCount.set(0);

        const user = this.authService.user();
        if (user) {
          const db = getFirestore();
          const requestsRef = collection(db, 'users', user.uid, 'correctionRequests');
          const q = query(requestsRef, where('status', 'in', ['approved', 'rejected']));

          onSnapshot(q, (snapshot: QuerySnapshot) => {
            const seenIds = JSON.parse(localStorage.getItem('seenRequestIds') || '[]');

            const unnotified = snapshot.docs
              .map((doc: QueryDocumentSnapshot) => ({ id: doc.id, ref: doc.ref, ...doc.data() }))
              .filter((data: any) => !seenIds.includes(data.id));

            if (unnotified.length > 0) {
              this.reviewedRequests.set(unnotified);
              this.showResultPopup.set(true);
            }
          });
        }
      }
    });
  }

  protected login(): void {
    this.authService.loginWithGoogle().catch((err) => console.error(err));
  }

  protected logout(): void {
    this.authService.logout().catch((err) => console.error(err));
  }

  protected navigateToAdmin(): void {
    this.router.navigate(['/admin']);
  }

  protected clockIn(): void {
    if (this.hasPunchedInToday()) return;
    this.record(() => this.attendanceService.clockIn(), 'おはようございます');
  }

  protected clockOut(): void {
    if (this.hasPunchedOutToday()) return;
    this.record(() => this.attendanceService.clockOut(), 'お疲れさまでした');
  }

  protected breakStart(): void {
    this.record(() => this.attendanceService.breakStart(), '休憩開始を記録しました');
  }

  protected breakEnd(): void {
    this.record(() => this.attendanceService.breakEnd(), '休憩終了を記録しました');
  }

  private async record(action: () => Promise<void>, successMessage: string): Promise<void> {
    this.saving.set(true);
    this.statusMessage.set(null);
    try {
      await action();
      this.statusMessage.set(successMessage);

      if (successMessage === 'おはようございます') {
        this.hasPunchedInToday.set(true);
      } else if (successMessage === 'お疲れさまでした') {
        this.hasPunchedOutToday.set(true);
      }

      const utterance = new SpeechSynthesisUtterance(successMessage);
      utterance.lang = 'ja-JP';
      speechSynthesis.speak(utterance);
    } catch (err) {
      console.error(err);
      this.statusMessage.set('記録に失敗しました');
    } finally {
      this.saving.set(false);
    }
  }

  protected openCorrectionForm(): void {
    this.showCorrectionForm.set(true);
    this.correctionMessage.set(null);
  }

  protected closeCorrectionForm(): void {
    this.showCorrectionForm.set(false);
  }

  protected openHistory(): void {
    this.showHistory.set(true);
  }

  protected closeHistory(): void {
    this.showHistory.set(false);
  }

  protected setCorrectionType(value: string): void {
    this.correctionType.set(value as AttendanceType);
  }

  protected setCorrectionOriginalAt(value: string): void {
    this.correctionOriginalAt.set(value);
  }

  protected setCorrectionCorrectedAt(value: string): void {
    this.correctionCorrectedAt.set(value);
  }

  protected setCorrectionReason(value: string): void {
    this.correctionReason.set(value);
  }

  protected async submitCorrectionRequest(): Promise<void> {
    const originalAt = new Date(this.correctionOriginalAt());
    const correctedAt = new Date(this.correctionCorrectedAt());

    if (Number.isNaN(originalAt.getTime()) || Number.isNaN(correctedAt.getTime())) {
      this.correctionMessage.set('打刻ミスをした日時と変更後の日時を入力してください');
      return;
    }
    if (!this.correctionReason().trim()) {
      this.correctionMessage.set('理由を入力してください');
      return;
    }
    if (!this.attendanceService.hasExactRecord(this.correctionType(), originalAt)) {
      this.correctionMessage.set('入力した「打刻ミスをした日時」と一致する打刻記録が見つかりません。時刻を確認してください。');
      return;
    }

    this.correctionSaving.set(true);
    this.correctionMessage.set(null);
    try {
      await this.correctionRequestService.submit({
        type: this.correctionType(),
        originalAt,
        correctedAt,
        reason: this.correctionReason().trim(),
      });
      this.correctionMessage.set('管理者に打刻修正を申請しました');
      this.correctionOriginalAt.set('');
      this.correctionCorrectedAt.set('');
      this.correctionReason.set('');
      this.showCorrectionForm.set(false);
    } catch (err) {
      console.error(err);
      this.correctionMessage.set('申請に失敗しました');
    } finally {
      this.correctionSaving.set(false);
    }
  }

  private async loadWorkingMembers(): Promise<void> {
    const user = this.authService.user();
    if (!user) {
      this.workingMembers.set([]);
      return;
    }
    try {
      const db = getFirestore();
      const usersSnapshot = await getDocs(query(collection(db, 'users')));
      const working: { uid: string; displayName: string }[] = [];

      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        const userData = userDoc.data();
        const recordsSnapshot = await getDocs(query(collection(db, 'users', userId, 'attendanceRecords')));

        if (recordsSnapshot.docs.length > 0) {
          const lastRecord = recordsSnapshot.docs
            .map((doc: any) => doc.data())
            .sort((a: any, b: any) => b.timestamp.toDate().getTime() - a.timestamp.toDate().getTime())[0];

          const status = this.getStatus(lastRecord['type'], recordsSnapshot.docs);
          if (status === 'clockedIn' || status === 'onBreak') {
            working.push({
              uid: userId,
              displayName: userData['displayName'] || 'Unknown'
            });
          }
        }
      }

      this.workingMembers.set(working);
    } catch (err) {
      console.error('Failed to load working members:', err);
    }
  }

  private getStatus(_lastType: string, allRecords: any[]): string {
    const typeCounts: { [key: string]: number } = {};
    allRecords.forEach(doc => {
      const type = doc.data()['type'];
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });

    const clockInCount = typeCounts['clockIn'] || 0;
    const clockOutCount = typeCounts['clockOut'] || 0;
    const breakStartCount = typeCounts['breakStart'] || 0;
    const breakEndCount = typeCounts['breakEnd'] || 0;

    if (clockInCount > clockOutCount && breakStartCount > breakEndCount) {
      return 'onBreak';
    } else if (clockInCount > clockOutCount) {
      return 'clockedIn';
    } else {
      return 'clockedOut';
    }
  }

  protected async rejectRequest(request: any): Promise<void> {
    this.reviewingRequestId.set(request.id);
    try {
      const db = getFirestore();
      const requestRef = doc(db, 'users', request.userId, 'correctionRequests', request.id);
      await updateDoc(requestRef, {
        status: 'rejected',
        reviewedAt: serverTimestamp(),
        reviewedBy: this.authService.user()?.email || '',
      });
    } catch (err) {
      console.error('Failed to reject request:', err);
    } finally {
      this.reviewingRequestId.set(null);
    }
  }

  protected async approveRequest(request: any): Promise<void> {
    this.reviewingRequestId.set(request.id);
    try {
      const db = getFirestore();
      const recordsRef = collection(db, 'users', request.userId, 'attendanceRecords');

      const recordQuery = query(
        recordsRef,
        where('type', '==', request.type)
      );
      const recordSnapshot = await getDocs(recordQuery);

      const targetTimeMs = request.originalAt.getTime();
      const originalRecord = recordSnapshot.docs.find(doc => {
        const recordTimeMs = doc.data()['timestamp'].toDate().getTime();
        return Math.abs(recordTimeMs - targetTimeMs) <= 60000;
      });

      if (!originalRecord) {
        console.error('Original attendance record not found. 探した時間:', request.originalAt);
        alert('エラー: 修正対象の打刻データ（元の時間）が見つかりません。');
        this.reviewingRequestId.set(null);
        return;
      }

      const batch = writeBatch(db);

      batch.update(originalRecord.ref, {
        timestamp: request.correctedAtTimestamp,
        correctedFrom: originalRecord.data()['timestamp'],
      });

      const requestRef = doc(db, 'users', request.userId, 'correctionRequests', request.id);
      batch.update(requestRef, {
        status: 'approved',
        reviewedAt: serverTimestamp(),
        reviewedBy: this.authService.user()?.email || '',
      });

      await batch.commit();

    } catch (err) {
      console.error('Failed to approve request:', err);
      alert('承認処理中にエラーが発生しました。');
    } finally {
      this.reviewingRequestId.set(null);
    }
  }

  protected closeResultPopup(): void {
    this.showResultPopup.set(false);

    const seenIds = JSON.parse(localStorage.getItem('seenRequestIds') || '[]');

    for (const req of this.reviewedRequests()) {
      if (!seenIds.includes(req.id)) {
        seenIds.push(req.id);
      }
    }

    localStorage.setItem('seenRequestIds', JSON.stringify(seenIds));
    this.reviewedRequests.set([]);
  }

  // ▼ これが足りなかった関数 ▼
  protected openRequestHistory(): void {
    this.showRequestHistory.set(true);
  }

  protected closeRequestHistory(): void {
    this.showRequestHistory.set(false);
  }
}