import { fetchSchedule } from './scraper.js';
import { syncCalendar } from './calendar.js';

for (const name of ['JUKU_ACCOUNT', 'JUKU_PASSWORD', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) {
  if (!process.env[name]) throw new Error(`環境変数 ${name} が設定されていません`);
}

const items = await fetchSchedule();
if (!Array.isArray(items)) throw new Error('予定データの形式が不正です。カレンダー更新を中止します。');

const result = await syncCalendar(items);
console.log(`同期完了: 新規${result.created}件、更新${result.updated}件、削除${result.deleted}件、対象${result.total}件`);
