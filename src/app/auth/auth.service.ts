import { Injectable, computed, signal } from '@angular/core';
import {
  GoogleAuthProvider,
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { doc, getFirestore, setDoc } from 'firebase/firestore';

import { environment } from '../../environments/environment';
import { firebaseApp } from '../core/firebase-app';

const auth = getAuth(firebaseApp);
const firestore = getFirestore(firebaseApp);

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<User | null>(null);
  readonly loading = signal(true);

  readonly isAdmin = computed(() => {
    const email = this.user()?.email;
    const result = !!email && environment.adminEmails.includes(email);
    console.log('[DEBUG isAdmin] ユーザーメール:', email);
    console.log('[DEBUG isAdmin] environment.adminEmails:', environment.adminEmails);
    console.log('[DEBUG isAdmin] 判定結果:', result);
    return result;
  });

  private resolveReady!: () => void;
  private readonly readyPromise = new Promise<void>((resolve) => {
    this.resolveReady = resolve;
  });

  constructor() {
    onAuthStateChanged(auth, (user) => {
      this.user.set(user);
      this.loading.set(false);
      this.resolveReady();

      if (user) {
        setDoc(
          doc(firestore, 'users', user.uid),
          { displayName: user.displayName, email: user.email },
          { merge: true },
        ).catch((err) => console.error(err));
      }
    });
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  loginWithGoogle(): Promise<void> {
    return signInWithPopup(auth, new GoogleAuthProvider()).then(() => undefined);
  }

  logout(): Promise<void> {
    return signOut(auth);
  }
}
