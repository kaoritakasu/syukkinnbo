import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { collection, getDocs, getFirestore, QuerySnapshot, DocumentData } from 'firebase/firestore';

@Component({
  selector: 'app-admin-user-list',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="card">
      <div class="card-header" style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
        <h2>👥 ユーザー一覧</h2>
        <a routerLink="/" class="btn btn-outline" style="text-decoration: none;">🏠 ホームへ</a>
      </div>

      <ul style="list-style: none; padding: 0;">
        @for (user of users(); track user.id) {
          <li style="border-bottom: 1px solid #eee; padding: 15px 10px;">
            <a [routerLink]="['/admin', user.id]" style="text-decoration: none; color: #333; display: block; width: 100%; font-weight: bold;">
              {{ user.name || user.email || '名前未設定のユーザー' }} ＞
            </a>
          </li>
        } @empty {
          <p>ユーザーが見つかりません。</p>
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