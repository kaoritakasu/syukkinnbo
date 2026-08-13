import { Routes } from '@angular/router';

import { adminGuard } from './admin/admin.guard';

export const routes: Routes = [
  {
    path: 'admin',
    canActivate: [adminGuard],
    children: [
      {
        path: 'requests',
        loadComponent: () => import('./admin-requests/admin-requests.component').then((m) => m.AdminRequestsComponent),
      },
      {
        path: '',
        loadComponent: () => import('./admin/admin-attendance').then((m) => m.AdminAttendance),
      },
    ],
  },
];
