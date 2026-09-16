import { google } from 'googleapis';

const SOURCE = 'juku-calendar-sync';

function getCalendarClient() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.calendar({ version: 'v3', auth });
}

function eventKey(item) {
  return `${item.date}|${item.slot ?? item.period ?? item.detail ?? 'unknown'}`;
}

function toEvent(item) {
  const slot = item.slot ?? item.period ?? '';
  return {
    summary: `塾バイト${slot}`,
    description: item.detail || '',
    start: { dateTime: `${item.date}T${item.startTime}:00+09:00`, timeZone: 'Asia/Tokyo' },
    end: { dateTime: `${item.date}T${item.endTime}:00+09:00`, timeZone: 'Asia/Tokyo' },
    extendedProperties: { private: { source: SOURCE, sourceKey: eventKey(item) } }
  };
}

function sameEvent(old, next) {
  return old.summary === next.summary
    && (old.description || '') === (next.description || '')
    && old.start?.dateTime === next.start?.dateTime
    && old.start?.timeZone === next.start?.timeZone
    && old.end?.dateTime === next.end?.dateTime
    && old.end?.timeZone === next.end?.timeZone;
}

async function withRetry(operation) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const status = error?.response?.status;
      const reason = error?.response?.data?.error?.errors?.[0]?.reason;
      if (status !== 403 && status !== 429 && reason !== 'rateLimitExceeded') throw error;
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (2 ** attempt)));
    }
  }
}

async function listManagedEvents(calendar, calendarId) {
  const events = [];
  let pageToken;
  do {
    const response = await withRetry(() => calendar.events.list({
      calendarId,
      privateExtendedProperty: `source=${SOURCE}`,
      maxResults: 2500,
      singleEvents: false,
      pageToken
    }));
    events.push(...(response.data.items || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  return events;
}

export async function syncCalendar(items) {
  const calendar = getCalendarClient();
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';
  const existing = await listManagedEvents(calendar, calendarId);
  const byKey = new Map(existing.map((event) => [event.extendedProperties?.private?.sourceKey, event]));
  const desiredKeys = new Set();
  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const item of items) {
    const event = toEvent(item);
    const key = event.extendedProperties.private.sourceKey;
    desiredKeys.add(key);
    const old = byKey.get(key);
    try {
      if (old) {
        if (!sameEvent(old, event)) {
          await withRetry(() => calendar.events.update({ calendarId, eventId: old.id, requestBody: event }));
          updated++;
        }
      } else {
        await withRetry(() => calendar.events.insert({ calendarId, requestBody: event }));
        created++;
      }
    } catch (error) {
      const apiError = error?.response?.data?.error;
      const reason = apiError?.errors?.map((entry) => entry.reason).filter(Boolean).join(',') || '';
      throw new Error(`GoogleカレンダーAPIで失敗: 操作=${old ? 'update' : 'insert'} 日付=${item.date} 時限=${item.slot} HTTP=${error?.response?.status || 'unknown'} 理由=${apiError?.message || error.message}${reason ? ` (${reason})` : ''}`);
    }
  }

  for (const old of existing) {
    const key = old.extendedProperties?.private?.sourceKey;
    if (key && !desiredKeys.has(key)) {
      await withRetry(() => calendar.events.delete({ calendarId, eventId: old.id }));
      deleted++;
    }
  }

  return { created, updated, deleted, total: items.length };
}
