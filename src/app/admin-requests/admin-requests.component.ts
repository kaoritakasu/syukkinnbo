import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

import { AdminCorrectionRequestService } from '../admin/admin-correction-request.service';

@Component({
  selector: 'app-admin-requests',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './admin-requests.component.html',
  styleUrl: './admin-requests.component.scss',
})
export class AdminRequestsComponent implements OnInit, OnDestroy {
  private readonly adminCorrectionRequestService = inject(AdminCorrectionRequestService);

  protected readonly reviewMessage = signal<string | null>(null);
  protected readonly isProcessing = signal(false);

  protected readonly pendingRequests = computed(() =>
    this.adminCorrectionRequestService
      .requests()
      .filter((r) => r.status === 'pending')
      .sort((a, b) => b.correctedAt.getTime() - a.correctedAt.getTime())
  );

  protected readonly reviewedRequests = computed(() =>
    this.adminCorrectionRequestService
      .requests()
      .filter((r) => r.status !== 'pending')
      .sort((a, b) => b.correctedAt.getTime() - a.correctedAt.getTime())
  );

  ngOnInit(): void {
    this.adminCorrectionRequestService.start();
  }

  ngOnDestroy(): void {
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
    this.isProcessing.set(true);

    try {
      await action();
      this.reviewMessage.set('処理が完了しました');
    } catch (err) {
      console.error(err);
      this.reviewMessage.set(
        err instanceof Error ? `エラー: ${err.message}` : '処理に失敗しました'
      );
    } finally {
      this.isProcessing.set(false);
    }
  }
}
