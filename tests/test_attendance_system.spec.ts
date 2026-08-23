import { test } from '@playwright/test';
import { config } from '../src/config';
import { attendLectures } from '../src/attend-lectures';
import { logger } from '../src/logger';
import { Lecture } from '../src/types';

/**
 * TEST-ONLY spec.
 *
 * This does NOT modify or bypass any production logic. It exercises the
 * exact same attendLectures() used by extract_lecture_links.spec.ts — the
 * only difference is where the Lecture[] comes from:
 *
 *   Production: loginToLMS() -> scrapeLectures() -> attendLectures()
 *   This test:  (no login)   -> hand-built array  -> attendLectures()
 *
 * loginToLMS() and scrapeLectures() are skipped entirely because
 * attendLectures() never touches the LMS again after it receives its
 * lecture list — it only drives `page` through Teams. So skipping the
 * LMS steps doesn't change the code path being tested.
 *
 * SETUP:
 *   1. Replace the `link` value(s) below with real Teams meeting URLs
 *      (the same raw join links scrape-lectures.ts would have pulled from
 *      the LMS table).
 *   2. Adjust startTime/endTime so the meeting is upcoming/in-progress
 *      relative to when you run the test.
 *   3. Set DRY_RUN=true in .env first to sanity-check scheduling/logging
 *      with zero real joins, then set DRY_RUN=false for a live join test.
 *
 * RUN:
 *   npx playwright test tests/test-attend-lectures.spec.ts --headed
 */

function minutesFromNow(mins: number): Date {
  return new Date(Date.now() + mins * 60 * 1000);
}

/**
 * Each lecture's stay in-meeting is a fixed 15 minutes (MEETING_DURATION_MS
 * in attend-lectures.ts, unchanged). To see lecture N+1 kick off right as
 * lecture N is being left (instead of the script idling for a long gap),
 * space each startTime ~16 minutes after the previous one's startTime.
 *
 * Add/remove objects here freely — attendLectures() already loops over
 * however many you give it, in order, exactly like it would with a real
 * multi-row LMS table.
 */
const TEST_LECTURES: Lecture[] = [
  {
    subject: 'Test Subject 1',
    code: 'TEST-1',
    timing: 'manual-test-entry',
    startTime: minutesFromNow(1),
    endTime: minutesFromNow(16), // > start + 15 min stay
    link: 'https://teams.live.com/meet/9323796621135?p=vPdu9CqicwPEf6s8FX',
  },


  {
    subject: 'Test Subject 2',
    code: 'TEST-2',
    timing: 'manual-test-entry',
    startTime: minutesFromNow(17),
    endTime: minutesFromNow(32),
    link: 'https://teams.live.com/meet/9323796621135?p=vPdu9CqicwPEf6s8FX',
  },
  {
    subject: 'Test Subject 3',
    code: 'TEST-3',
    timing: 'manual-test-entry',
    startTime: minutesFromNow(33),
    endTime: minutesFromNow(48),
    link: 'https://teams.live.com/meet/9323796621135?p=vPdu9CqicwPEf6s8FX',
  },
];

test('Test attendLectures flow with manually defined lecture data', async ({ page, context }) => {
  // Default Playwright test timeout (30s) will otherwise kill this test
  // long before real meeting stays (15 min each) finish. Size this to
  // comfortably exceed your last lecture's endTime above.
  test.setTimeout(90 * 60 * 1000); // 90 min ceiling — adjust if you add more lectures

  logger.divider();
  logger.info('🧪 TEST MODE — using manually defined lecture data (no LMS scrape/login)');
  logger.info(`   Mode: ${config.DRY_RUN ? '🧪 DRY RUN' : '🔴 LIVE'}`);
  logger.divider();

  await attendLectures(context, page, TEST_LECTURES, 'SUE019457 (SHIVAM KUMAR)', config.DRY_RUN);

  logger.info('🧪 Test run complete.');
});