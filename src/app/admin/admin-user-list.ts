import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { collection, getDocs, getFirestore, query, orderBy, limit } from 'firebase/firestore';

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
              <span style="display: flex; align-items: center;">
                {{ user.displayName || user.email || '名前未設定のユーザー' }}
                @if (user.isOver35Hours) {
                  <span style="color: red; font-size: 0.85em; font-weight: bold; margin-left: 8px; background: #ffebee; padding: 2px 6px; border-radius: 4px;">⚠️ 35h超過</span>
                }
              </span>
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
    const db = getFirestore();
    const querySnapshot = await getDocs(collection(db, 'users'));

    const userList = await Promise.all(
      querySnapshot.docs.map(async (doc: any) => {
        const userData = { id: doc.id, ...doc.data(), isOver35Hours: false };

        try {
          const recordsQuery = query(
            collection(db, 'users', doc.id, 'attendanceRecords'),
            orderBy('timestamp', 'desc'),
            limit(200)
          );
          const recordsSnapshot = await getDocs(recordsQuery);

          // 今週の月曜日の始まり（0時0分0秒）を取得
          const now = new Date();
          const dayOfWeek = now.getDay();
          const weekStart = new Date(now);
          weekStart.setDate(now.getDate() - dayOfWeek);
          weekStart.setHours(0, 0, 0, 0);

          // 計算しやすいようにデータを古い順（昇順）に並べ替える
          const records = recordsSnapshot.docs
            .map((doc: any) => ({
              type: doc.data()['type'],
              timestamp: doc.data()['timestamp']?.toDate(),
            }))
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

          let totalMs = 0;
          let currentClockIn: Date | null = null;
          let currentBreakStart: Date | null = null;

          for (const record of records) {
            // 今週のデータだけを計算の対象にする
            if (record.timestamp < weekStart) continue;

            if (record.type === 'clockIn') {
              currentClockIn = record.timestamp;
            } else if (record.type === 'clockOut' && currentClockIn) {
              totalMs += (record.timestamp.getTime() - currentClockIn.getTime());
              currentClockIn = null; // 次の出勤に備えてリセット
            } else if (record.type === 'breakStart') {
              currentBreakStart = record.timestamp;
            } else if (record.type === 'breakEnd' && currentBreakStart) {
              // 休憩時間はトータルの労働時間からマイナスする
              totalMs -= (record.timestamp.getTime() - currentBreakStart.getTime());
              currentBreakStart = null;
            }
          }

          const hours = totalMs / (1000 * 60 * 60);
          
          userData.isOver35Hours = hours > 35;

        } catch (error) {
          console.error('Error calculating weekly hours for user', doc.id, error);
        }

        return userData;
      })
    );

    this.users.set(userList);
  }
}