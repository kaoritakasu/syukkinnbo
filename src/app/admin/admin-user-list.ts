import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { collection, getDocs, getFirestore, QuerySnapshot, DocumentData } from 'firebase/firestore';

@Component({
  selector: 'app-admin-user-list',
  standalone: true,
  imports: [RouterLink],
  styles: [`
    .btn {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #d7dae0;
      border-radius: 0.625rem;
      background: #ffffff;
      color: #1f2430;
      padding: 0.75rem 1.25rem;
      min-height: 2.75rem;
      font-size: 0.9375rem;
      font-weight: 600;
      font-family: inherit;
      line-height: 1.2;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease;
    }
    .btn:hover:not(:disabled) {
      border-color: #2563eb;
      color: #2563eb;
    }
    .btn:active:not(:disabled) {
      transform: scale(0.97);
    }
    .btn:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }
    .btn-ghost {
      border-color: transparent;
      background: transparent;
    }
  `],
  template: `
    <section class="card" style="border-top: 4px solid #007bff; box-shadow: 0 2px 8px rgba(0, 123, 255, 0.1);">
      <div class="card-header" style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; background: #f8fbff; padding: 15px; border-bottom: 2px solid #cce5ff; border-radius: 4px;">
        <h2 style="margin: 0; color: #0056b3; font-size: 1.5em;">👥 ユーザー一覧</h2>
        <button type="button" class="btn btn-ghost" routerLink="/">← 戻る</button>
      </div>

      <ul style="list-style: none; padding: 0; margin: 0;">
        @for (user of users(); track user.id) {
          <li style="border-bottom: 1px solid #e1ecf4; padding: 0; transition: background 0.2s;">
            <a [routerLink]="['/admin', user.id]" style="text-decoration: none; color: #004085; display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 15px 10px; font-weight: 500; transition: background 0.2s; cursor: pointer;" (mouseenter)="$any($event.currentTarget).style.background='#f0f5ff'" (mouseleave)="$any($event.currentTarget).style.background='white'">
              <span>{{ user.displayName || user.email || '名前未設定のユーザー' }}</span>
              <span style="color: #007bff; font-weight: bold; margin-left: 10px;">＞</span>
            </a>
          </li>
        } @empty {
          <p style="color: #6c757d; text-align: center; padding: 20px; margin: 0;">ユーザーが見つかりません。</p>
        }
      </ul>
    </section>
  `
})
export class AdminUserList implements OnInit {
  users = signal<any[]>([]);

  async ngOnInit() {
    const querySnapshot = await getDocs(collection(getFirestore(), 'users'));
    const userList = querySnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
    this.users.set(userList);
  }
}