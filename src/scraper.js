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
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function nextMonth(year, month) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function monthUrlFromFrame(frame, year, month) {
  return frame.locator(`a[href*="YEAR_MONTH=${year}${String(month).padStart(2, '0')}"]`).first();
}

async function openMonthly(page) {
  for (const frame of page.frames()) {
    const link = frame.locator('a[href*="teacher_month_schedule.cgi"]').first();
    if (await link.count()) {
      const href = await link.getAttribute('href');
      const url = new URL(href, frame.url()).toString();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      return;
    }
  }
  throw new Error('月間スケジュールへのリンクが見つかりませんでした');
}

async function openMonth(page, year, month) {
  const wanted = `${year}${String(month).padStart(2, '0')}`;
  for (const frame of page.frames()) {
    const link = await monthUrlFromFrame(frame, year, month);
    if (await link.count()) {
      const href = await link.getAttribute('href');
      await page.goto(new URL(href, frame.url()).toString(), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      return;
    }
  }
  const current = page.frames().find((frame) => frame.url().includes('teacher_month_schedule.cgi'));
  if (!current) throw new Error('月間スケジュール画面を特定できませんでした');
  const links = await current.locator('a').evaluateAll((els) => els.map((a) => ({ href: a.href || '', text: a.innerText || '' })));
  const fallback = links.find((link) => link.href.includes(`YEAR_MONTH=${wanted}`));
  if (!fallback) throw new Error(`${year}年${month}月のリンクが見つかりませんでした`);
  await page.goto(fallback.href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
}

function parseDateFromHref(href, year, month) {
  try {
    const params = new URL(href).searchParams;
    const y = Number(params.get('YEAR') || params.get('year') || params.get('CALENDAR_YEAR') || year);
    const m = Number(params.get('MONTH') || params.get('month') || params.get('CALENDAR_MONTH') || month);
    const raw = params.get('DAY') || params.get('day') || params.get('DATE') || params.get('date') || params.get('DAY_OF_MONTH');
    if (raw && /^\d{1,2}$/.test(raw) && Number(raw) >= 1 && Number(raw) <= 31) {
      return `${y}-${String(m).padStart(2, '0')}-${String(Number(raw)).padStart(2, '0')}`;
    }
    const match = href.match(/(?:DATE|DAY)[=_-](\d{1,2})/i);
    if (match) return `${year}-${String(month).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
  } catch {}
  return null;
}

function slotFromValue(value) {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 7) return n;
  if (Number.isInteger(n) && n >= 0 && n <= 6) return n + 1;
  return null;
}

function slotFromHref(href) {
  try {
    const params = new URL(href).searchParams;
    for (const key of ['TEACHING_TIME_INDEX', 'teaching_time_index', 'BEGIN_TEACHING_TIME_INDEX', 'begin_teaching_time_index', 'PERIOD', 'period']) {
      const slot = slotFromValue(params.get(key));
      if (slot) return slot;
    }
  } catch {}
  return null;
}

function statusDecision(text, html) {
  const value = `${text} ${html}`;
  if (/icon_done\.gif/i.test(value)) return false;
  if (/講/.test(value)) return true;
  if (/[済休予]/.test(value)) return false;
  // A lesson block with no status glyph text represents the blank state.
  return true;
}

function hasActiveStudent(cell) {
  const blocks = (cell.studentBlocks || []).filter((block) => block.text);
  if (blocks.length === 0) return Boolean(cell.text);
  return blocks.some((block) => {
    const value = `${block.text} ${block.html} ${block.images.join(' ')}`;
    if (/icon_done\.gif/i.test(value)) return false;
    if (/講/.test(value)) return true;
    if (/[済休予]/.test(value)) return false;
    return true;
  });
}

async function extractMonth(page, year, month) {
  const frame = page.frames().find((item) => item.url().includes('teacher_month_schedule.cgi'));
  if (!frame) throw new Error(`${year}年${month}月の月間表フレームがありません`);

  const mainTable = frame.locator('table').nth(4);
  const mainTableInfo = await mainTable.count();
  const directRows = mainTable.locator('tr');
  const rowCount = await directRows.count().catch(() => 0);
  if (mainTableInfo && rowCount >= 30) {
    const allRows = await directRows.evaluateAll((rowEls) => rowEls.map((row, rowIndex) => ({
      rowIndex,
      cells: [...row.children].map((cell) => ({
        text: (cell.innerText || '').replace(/\s+/g, ' ').trim(),
        html: cell.innerHTML || '',
        hasFont: Boolean(cell.querySelector('font')),
        hasImage: Boolean(cell.querySelector('img')),
        background: cell.getAttribute('bgcolor') || cell.style.backgroundColor || '',
        imageSources: [...cell.querySelectorAll('img')].map((img) => img.getAttribute('src') || ''),
        studentBlocks: [...cell.querySelectorAll('font')].map((font) => {
          const parent = font.closest('a') || font.parentElement || font;
          return {
            text: (font.innerText || font.textContent || '').replace(/\s+/g, ' ').trim(),
            html: parent.outerHTML || '',
            images: [...parent.querySelectorAll('img')].map((img) => `${img.getAttribute('src') || ''} ${img.getAttribute('alt') || ''} ${img.getAttribute('title') || ''}`)
          };
        })
      }))
    })));
    const rows = allRows.filter((row) => row.cells.length >= 9).slice(0, 32);
    const events = [];
    for (const [dayIndex, row] of rows.entries()) {
      const dayDigits = (row.cells[0]?.imageSources || [])
        .map((src) => src.match(/counter(?:\/color\d+)?\/counter(\d+)\.gif/i)?.[1] || '')
        .join('');
      const imageDay = Number(dayDigits);
      const day = imageDay >= 1 && imageDay <= 31 ? imageDay : dayIndex + 1;
      if (day < 1 || day > 31 || row.cells.length < 9) continue;
      for (let slot = 1; slot <= 7; slot++) {
        const cell = row.cells[slot + 1];
        if (!cell) continue;
        const content = `${cell.text} ${cell.html}`;
        if (!cell.hasFont && !cell.text) continue;
        if (!hasActiveStudent(cell)) continue;
        const [startTime, endTime] = SLOT_TIMES[slot];
        events.push({
          date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          slot,
          startTime,
          endTime,
          detail: cell.text
        });
      }
    }
    const unique = new Map(events.map((event) => [`${event.date}|${event.slot}`, event]));
    return { events: [...unique.values()], valid: rows.length >= 30 && rows.some((row) => row.cells.length >= 9) };
  }

  return { events: [], valid: false };
}

export async function fetchSchedule() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="text"]').first().fill(process.env.JUKU_ACCOUNT);
    await page.locator('input[type="password"]').first().fill(process.env.JUKU_PASSWORD);
    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => {}),
      page.locator('input[type="submit"], button[type="submit"]').first().click()
    ]);
    await page.waitForTimeout(800);
    await openMonthly(page);

    const now = new Date();
    const targets = [
      { year: now.getFullYear(), month: now.getMonth() + 1 },
      nextMonth(now.getFullYear(), now.getMonth() + 1)
    ];
    const all = [];
    let validMonths = 0;
    for (const target of targets) {
      await openMonth(page, target.year, target.month);
      const extracted = await extractMonth(page, target.year, target.month);
      console.log(`MONTH_EXTRACTED ${target.year}-${String(target.month).padStart(2, '0')} events=${extracted.events.length} valid=${extracted.valid}`);
      if (extracted.valid) validMonths++;
      all.push(...extracted.events);
    }
    const result = [...new Map(all.map((item) => [`${item.date}|${item.slot}`, item])).values()];
    if (validMonths !== targets.length) throw new Error('今月・来月の月間表を完全に確認できませんでした。安全のためカレンダー更新を中止します。');
    return result;
  } finally {
    await browser.close();
  }
}
