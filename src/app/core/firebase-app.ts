import { getApp, getApps, initializeApp } from 'firebase/app';

import { environment } from '../../environments/environment';

export const firebaseApp = getApps().length ? getApp() : initializeApp(environment.firebaseConfig);
