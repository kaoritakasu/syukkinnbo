import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from '../auth/auth.service';

export const adminGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  await authService.ready();

  const isAdmin = authService.isAdmin();
  console.log('[DEBUG adminGuard] Guard から返す値:', isAdmin ? 'true (許可)' : 'false / UrlTree (拒否)');
  return isAdmin ? true : router.createUrlTree(['/']);
};
