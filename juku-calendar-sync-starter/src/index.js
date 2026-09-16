import { fetchSchedule } from './scraper.js';
import { syncCalendar } from './calendar.js';

for (const name of ['JUKU_ACCOUNT', 'JUKU_PASSWORD', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) {
  if (!process.env[name]) throw new Error(`MISSING_ENV:${name}`);
}

console.log('SYNC_START');
const items = await fetchSchedule();
if (!Array.isArray(items)) throw new Error('INVALID_SCHEDULE_DATA');
console.log(`SCHEDULE_ITEMS:${items.length}`);

console.log(
  'SCHEDULE_DEBUG',
  items.map((item) => {
    const visible = {};

    for (const [key, value] of Object.entries(item)) {
      if (/date|day|slot|period|title|start|end|time/i.test(key)) {
        visible[key] = value;
      }
    }

    return visible;
  })
);

if (items.length === 0) {
  throw new Error(
    '授業を0件しか読み取れなかったため、安全のため同期を中止しました'
  );
}

const result = await syncCalendar(items);
console.log(`SYNC_RESULT:created=${result.created},updated=${result.updated},deleted=${result.deleted},total=${result.total}`);
