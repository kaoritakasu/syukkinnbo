import { Routes } from '@angular/router';
import { adminGuard } from './admin/admin.guard';

export const routes: Routes = [
  // もしここに path: '' （ホーム画面）などの他の設定があったら、それは残してくださいね！
  {
    path: 'admin',
    canActivate: [adminGuard], // 👈 警備員の設定を復活させました！
    children: [
      {
        path: '', 
        loadComponent: () => import('./admin/admin-user-list').then((m) => m.AdminUserList),
      },
      {
        path: ':userId', 
        loadComponent: () => import('./admin/admin-attendance').then((m) => m.AdminAttendance),
      },
    ],
  }
];