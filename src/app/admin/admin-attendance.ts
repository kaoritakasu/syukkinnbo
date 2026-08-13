import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AdminAttendanceService } from './admin-attendance.service';

@Component({
  selector: 'app-admin-attendance',
  imports: [RouterLink],
  templateUrl: './admin-attendance.html',
  styleUrl: './admin-attendance.scss',
})
export class AdminAttendance implements OnInit, OnDestroy {
  protected readonly adminAttendanceService = inject(AdminAttendanceService);

  ngOnInit(): void {
    this.adminAttendanceService.start();
  }

  ngOnDestroy(): void {
    this.adminAttendanceService.stop();
  }
}
