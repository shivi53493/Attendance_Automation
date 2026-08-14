import { Page } from '@playwright/test';
import { Lecture } from './types';
import { parseTimingToDate } from './time-utils';
import { logger as defaultLogger, Logger } from './logger';

/**
 * Scrapes the "Today's Lecture" table from the LMS dashboard.
 * Returns an array of Lecture objects sorted by start time.
 *
 * @param log - Pass a per-student createLogger(label) for multi-student
 *   runs so log lines are prefixed. Defaults to the plain global logger.
 */
export async function scrapeLectures(page: Page, log: Logger = defaultLogger): Promise<Lecture[]> {
  log.info('Looking for the lecture schedule table...');

  // Wait for the lecture table to be present on the page
  const tableSelector = 'table.table-striped.table-bordered.table-hover';
  await page.waitForSelector(tableSelector, { timeout: 15000 });

  log.info('Lecture table found. Scraping lecture data...');

  // Extract data from each row in the table body
  const rawLectures = await page.evaluate((selector) => {
    const table = document.querySelector(selector);
    if (!table) return [];

    const rows = table.querySelectorAll('tbody tr');
    const results: Array<{
      subject: string;
      code: string;
      timing: string;
      link: string;
    }> = [];

    rows.forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) return;

      const subject = cells[0]?.textContent?.trim() || '';
      const code = cells[1]?.textContent?.trim() || '';
      const timing = cells[2]?.textContent?.trim() || '';
      const linkElement = cells[3]?.querySelector('a[href]');
      const link = linkElement?.getAttribute('href') || '';

      if (subject && timing && link) {
        results.push({ subject, code, timing, link });
      }
    });

    return results;
  }, tableSelector);

  // Parse timing strings into Date objects
  const parsedLectures: Lecture[] = rawLectures.map((lecture) => {
    const { startTime, endTime } = parseTimingToDate(lecture.timing);
    return {
      ...lecture,
      startTime,
      endTime,
    };
  });

  // Sort by start time
  parsedLectures.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  log.success(`Found ${parsedLectures.length} lecture(s) in today's schedule.`);
  return parsedLectures;
}