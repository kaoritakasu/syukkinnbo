import { Routes } from '@angular/router';

import { adminGuard } from './admin/admin.guard';

export const routes: Routes = [
  {
    path: 'admin',
    loadComponent: () => import('./admin/admin-attendance').then((m) => m.AdminAttendance),
    canActivate: [adminGuard],
  },
];
