import { chromium } from 'playwright';

const BASE_URL = 'https://www.mplanning.co.jp/grow/';

const SLOT_TIMES = {
  1: ['10:15', '11:35'],
  2: ['12:30', '13:50'],
  3: ['14:00', '15:20'],
  4: ['15:30', '16:50'],
  5: ['17:00', '18:20'],
  6: ['18:30', '19:50'],
  7: ['20:00', '21:20']
};

function clean(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nextMonth(year, month) {
  if (month === 12) {
    return { year: year + 1, month: 1 };
  }

  return { year, month: month + 1 };
}

function monthUrlFromFrame(frame, year, month) {
  const yearMonth = `${year}${String(month).padStart(2, '0')}`;

  return frame
    .locator(`a[href*="YEAR_MONTH=${yearMonth}"]`)
    .first();
}
