import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminAttendanceService } from './admin-attendance.service';
import { AdminCorrectionRequestService } from './admin-correction-request.service';

@Component({
  selector: 'app-admin-attendance',
  imports: [RouterLink],
  templateUrl: './admin-attendance.html',
  styleUrl: './admin-attendance.scss',
})
export class AdminAttendance implements OnInit, OnDestroy {
  protected readonly adminAttendanceService = inject(AdminAttendanceService);
  protected readonly adminCorrectionRequestService = inject(AdminCorrectionRequestService);

  protected readonly reviewMessage = signal<string | null>(null);

  protected readonly pendingCorrectionRequests = computed(() =>
    this.adminCorrectionRequestService.requests().filter((r) => r.status === 'pending'),
  );
  protected readonly reviewedCorrectionRequests = computed(() =>
    this.adminCorrectionRequestService.requests().filter((r) => r.status !== 'pending'),
  );

  ngOnInit(): void {
    this.adminAttendanceService.start();
    this.adminCorrectionRequestService.start();
  }

  ngOnDestroy(): void {
    this.adminAttendanceService.stop();
    this.adminCorrectionRequestService.stop();
  }

  protected approve(uid: string, requestId: string): void {
    this.review(() => this.adminCorrectionRequestService.approve(uid, requestId));
  }

  protected reject(uid: string, requestId: string): void {
    this.review(() => this.adminCorrectionRequestService.reject(uid, requestId));
  }

  private async review(action: () => Promise<void>): Promise<void> {
    this.reviewMessage.set(null);
    try {
      await action();
    } catch (err) {
      console.error(err);
      this.reviewMessage.set('処理に失敗しました');
    }
  }
}
