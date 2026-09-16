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
