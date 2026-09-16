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

async function openMonthly(page) {
  for (const frame of page.frames()) {
    const link = frame
      .locator('a[href*="teacher_month_schedule.cgi"]')
      .first();

    if (!(await link.count())) {
      continue;
    }

    const href = await link.getAttribute('href');

    if (!href) {
      continue;
    }

    const url = new URL(href, frame.url()).toString();

    await page.goto(url, {
      waitUntil: 'domcontentloaded'
    });

    await page.waitForTimeout(800);

    return;
  }

  throw new Error('月間スケジュールへのリンクが見つかりませんでした');
}

async function openMonth(page, year, month) {
  const wanted = `${year}${String(month).padStart(2, '0')}`;

  for (const frame of page.frames()) {
    const link = await monthUrlFromFrame(frame, year, month);

    if (!(await link.count())) {
      continue;
    }

    const href = await link.getAttribute('href');

    if (!href) {
      continue;
    }

    await page.goto(new URL(href, frame.url()).toString(), {
      waitUntil: 'domcontentloaded'
    });

    await page.waitForTimeout(800);

    return;
  }

  const current = page.frames().find((frame) =>
    frame.url().includes('teacher_month_schedule.cgi')
  );

  if (!current) {
    throw new Error('月間スケジュール画面を特定できませんでした');
  }

  const links = await current.locator('a').evaluateAll((elements) =>
    elements.map((element) => ({
      href: element.href || '',
      text: element.innerText || ''
    }))
  );

  const fallback = links.find((link) =>
    link.href.includes(`YEAR_MONTH=${wanted}`)
  );

  if (!fallback) {
    throw new Error(`${year}年${month}月のリンクが見つかりませんでした`);
  }

  await page.goto(fallback.href, {
    waitUntil: 'domcontentloaded'
  });

  await page.waitForTimeout(800);
}

async function resetTeachingTimeToFirst(page) {
  let frame = null;
  let button = null;

  for (let attempt = 0; attempt < 20; attempt++) {
    frame = page.frames().find((item) =>
      item.url().includes('teacher_month_schedule.cgi')
    );

    if (frame) {
      button = frame
        .locator(
          'img[title*="一番最初"], img[src*="rew_stop.gif"]'
        )
        .first();

      if (await button.count()) {
        break;
      }
    }

    await page.waitForTimeout(400);
  }

  if (!frame) {
    throw new Error('月間スケジュール画面が見つかりません');
  }

  if (!button || !(await button.count())) {
    throw new Error(
      '時間割を一番左へ戻すボタンが見つかりません'
    );
  }

  const src = (await button.getAttribute('src')) || '';
  const title = (await button.getAttribute('title')) || '';

  if (/disabled/i.test(src) || /disabled/i.test(title)) {
    await page.waitForTimeout(300);
    return;
  }

  const clickable = button.locator(
    'xpath=ancestor-or-self::*[self::a or self::button][1]'
  );

  if (await clickable.count()) {
    await clickable.click();
  } else {
    await button.click();
  }

  await page.waitForTimeout(1000);
}

function hasActiveStudent(cell) {
  const imageSources = (cell.imageSources || []).map((src) =>
    String(src).toLowerCase()
  );

  if (
    imageSources.length > 0 &&
    imageSources.every((src) => src.includes('icon_done.gif'))
  ) {
    return false;
  }

  const blocks = cell.studentBlocks || [];

  if (blocks.length === 0) {
    const value = [
      cell.text || '',
      cell.html || '',
      ...imageSources
    ].join(' ');

    if (/icon_done\.gif/i.test(value)) {
      return false;
    }

    if (/(済|休|予)/.test(value)) {
      return false;
    }

    return Boolean(cell.text || cell.hasFont);
  }

  const meaningfulBlocks = blocks.filter((block) => {
    const images = block.images || [];
    const html = String(block.html || '');

    return images.length > 0 || html.includes('<td');
  });

  const candidates =
    meaningfulBlocks.length > 0
      ? meaningfulBlocks
      : blocks;

  return candidates.some((block) => {
    const value = [
      block.text || '',
      block.html || '',
      ...(block.images || [])
    ].join(' ');

    if (/icon_done\.gif/i.test(value)) {
      return false;
    }

    if (/(済|休|予)/.test(value)) {
      return false;
    }

    if (
      /(icon_rest|icon_absent|icon_reserved|icon_holiday)/i.test(value)
    ) {
      return false;
    }

    return true;
  });
}

async function extractMonth(page, year, month) {
  const frame = page.frames().find((item) =>
    item.url().includes('teacher_month_schedule.cgi')
  );

  if (!frame) {
    throw new Error(
      `${year}年${month}月のスケジュールフレームがありません`
    );
  }

  const mainTable = frame.locator('table').nth(4);
  const tableCount = await mainTable.count();
  const directRows = mainTable.locator('tr');
  const rowCount = await directRows.count().catch(() => 0);

  if (!tableCount || rowCount < 30) {
    return {
      events: [],
      valid: false
    };
  }

  const allRows = await directRows.evaluateAll((rowElements) =>
    rowElements.map((row, rowIndex) => ({
      rowIndex,
      cells: [...row.children].map((cell) => ({
        text: (cell.innerText || '')
          .replace(/\s+/g, ' ')
          .trim(),

        html: cell.innerHTML || '',

        hasFont: Boolean(cell.querySelector('font')),

        hasImage: Boolean(cell.querySelector('img')),

        background:
          cell.getAttribute('bgcolor') ||
          cell.style.backgroundColor ||
          '',

        imageSources: [...cell.querySelectorAll('img')].map(
          (img) => img.getAttribute('src') || ''
        ),

        studentBlocks: [...cell.querySelectorAll('font')].map(
          (font) => {
            const parent =
              font.closest('a') ||
              font.parentElement ||
              font;

            return {
              text: (
                font.innerText ||
                font.textContent ||
                ''
              )
                .replace(/\s+/g, ' ')
                .trim(),

              html: parent.outerHTML || '',

              images: [...parent.querySelectorAll('img')].map(
                (img) =>
                  `${img.getAttribute('src') || ''} ${
                    img.getAttribute('alt') || ''
                  } ${
                    img.getAttribute('title') || ''
                  }`
              )
            };
          }
        )
      }))
    }))
  );

  const rows = allRows
    .filter((row) => row.cells.length >= 9)
    .slice(0, 32);

  const events = [];

  for (const [dayIndex, row] of rows.entries()) {
    const dayDigits = (row.cells[0]?.imageSources || [])
      .map((src) => {
        const match = src.match(
          /counter(?:\/color\d+)?\/counter(\d+)\.gif/i
        );

        return match ? match[1] : '';
      })
      .join('');

    const imageDay = Number(dayDigits);

    const day =
      imageDay >= 1 && imageDay <= 31
        ? imageDay
        : dayIndex + 1;

    if (day < 1 || day > 31) {
      continue;
    }

    for (let slot = 1; slot <= 7; slot++) {
      const cell = row.cells[slot + 1];

      if (!cell) {
        continue;
      }

      if (!cell.hasFont && !cell.text) {
        continue;
      }

      if (!hasActiveStudent(cell)) {
        continue;
      }

      const times = SLOT_TIMES[slot];

      if (!times) {
        continue;
      }

      const [startTime, endTime] = times;

      events.push({
        date: `${year}-${String(month).padStart(2, '0')}-${String(
          day
        ).padStart(2, '0')}`,

        slot,

        startTime,

        endTime,

        detail: clean(cell.text)
      });
    }
  }

  const unique = new Map(
    events.map((event) => [
      `${event.date}|${event.slot}`,
      event
    ])
  );

  return {
    events: [...unique.values()],
    valid:
      rows.length >= 30 &&
      rows.some((row) => row.cells.length >= 9)
  };
}

export async function fetchSchedule() {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, {
      waitUntil: 'domcontentloaded'
    });

    await page
      .locator('input[type="text"]')
      .first()
      .fill(process.env.JUKU_ACCOUNT);

    await page
      .locator('input[type="password"]')
      .first()
      .fill(process.env.JUKU_PASSWORD);

    await Promise.all([
      page.waitForLoadState('domcontentloaded').catch(() => {}),
      page
        .locator('input[type="submit"], button[type="submit"]')
        .first()
        .click()
    ]);

    await page.waitForTimeout(800);

    await openMonthly(page);

    const now = new Date();

    const current = {
      year: now.getFullYear(),
      month: now.getMonth() + 1
    };

    const following = nextMonth(
      current.year,
      current.month
    );

    const targets = [current, following];

    const allEvents = [];
    let validMonths = 0;

    for (const target of targets) {
      await openMonth(
        page,
        target.year,
        target.month
      );

      await resetTeachingTimeToFirst(page);

      const extracted = await extractMonth(
        page,
        target.year,
        target.month
      );

      console.log(
        `MONTH_EXTRACTED ${target.year}-${String(
          target.month
        ).padStart(2, '0')} events=${extracted.events.length} valid=${extracted.valid}`
      );

      if (extracted.valid) {
        validMonths++;
      }

      allEvents.push(...extracted.events);
    }

    const result = [
      ...new Map(
        allEvents.map((item) => [
          `${item.date}|${item.slot}`,
          item
        ])
      ).values()
    ];

    if (validMonths !== targets.length) {
      throw new Error(
        '対象月のスケジュールを完全に確認できなかったため、同期を中止しました'
      );
    }

    return result;
  } finally {
    await browser.close();
  }
}
