import { Component, inject, computed, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AdminAttendanceService } from './admin-attendance.service';

@Component({
  selector: 'app-admin-attendance',
  standalone: true,
  imports: [RouterLink, CommonModule],
  templateUrl: './admin-attendance.html',
  styleUrl: './admin-attendance.scss',
})
export class AdminAttendance implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly adminAttendanceService = inject(AdminAttendanceService);

  protected readonly userId = computed(() => this.route.snapshot.paramMap.get('userId') || '');
  protected readonly userHistory = computed(() => {
    const userId = this.userId();
    if (!userId) return null;
    return this.adminAttendanceService.historyByUser().find(u => u.uid === userId) || null;
  });

  ngOnInit(): void {
    this.adminAttendanceService.start();
  }

  ngOnDestroy(): void {
    this.adminAttendanceService.stop();
  }
}
