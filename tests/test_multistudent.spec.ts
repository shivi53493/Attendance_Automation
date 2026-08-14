import { test, Browser, BrowserContext } from '@playwright/test';
import { config } from '../src/config';
import { attendLectures } from '../src/attend-lectures';
import { logger, createLogger } from '../src/logger';
import { Lecture } from '../src/types';

/**
 * TEST-ONLY spec. Same idea as test-attend-lectures.spec.ts (manually
 * provided Teams links, no LMS login/scrape needed), but with MULTIPLE
 * students attending the SAME shared lecture schedule at the same time —
 * i.e. link1 is joined by every student simultaneously, then everyone
 * moves to link2 together, then link3, etc. This mirrors a real class
 * where every student's LMS dashboard shows the same lecture timetable.
 *
 * How the "simultaneous" part actually works: each student runs their own
 * independent call to attendLectures() with the exact SAME Lecture[] (same
 * startTime Date objects). attendLectures() internally sleeps until each
 * lecture's startTime before joining — since all students are sleeping
 * until the identical timestamp, they naturally join link1 at the same
 * moment, then link2 at the same moment, and so on. No extra
 * synchronization code is needed; it falls out of sharing one schedule.
 *
 * SETUP:
 *   1. Fill in SHARED_TEST_LECTURES below with your 3 real Teams links,
 *      spaced ~16 min apart (matches the 15-min in-meeting stay).
 *   2. List your students in TEST_STUDENTS (label + displayName only —
 *      no per-student lecture data needed anymore).
 *   3. DRY_RUN=true first to confirm the shared schedule/timing looks
 *      right for every student with zero real joins, then DRY_RUN=false
 *      for a live run.
 *
 * RUN:
 *   npx playwright test tests/test-multi-student-attend-lectures.spec.ts --headed
 */

function minutesFromNow(mins: number): Date {
  return new Date(Date.now() + mins * 60 * 1000);
}

interface TestStudent {
  label: string;
  displayName: string;
}

/**
 * The ONE shared schedule every student follows — exactly like a real
 * class where all students see the same lecture links on their dashboard.
 * Space each startTime ~16 min after the previous one so link2 kicks off
 * right as everyone is leaving link1 (15-min stay), instead of a long idle
 * gap in between.
 */
const SHARED_TEST_LECTURES: Lecture[] = [
  {
    subject: 'Test Subject 1',
    code: 'TEST-1',
    timing: 'manual-test-entry',
    startTime: minutesFromNow(1),
    endTime: minutesFromNow(6),
    link: 'https://teams.live.com/meet/9323796621135?p=vPdu9CqicwPEf6s8FX',
  },
//   {
//     subject: 'Test Subject 2',
//     code: 'TEST-2',
//     timing: 'manual-test-entry',
//     startTime: minutesFromNow(17),
//     endTime: minutesFromNow(32),
//     link: 'https://teams.live.com/meet/9323796621135?p=vPdu9CqicwPEf6s8FX',
//   },
//   {
//     subject: 'Test Subject 3',
//     code: 'TEST-3',
//     timing: 'manual-test-entry',
//     startTime: minutesFromNow(33),
//     endTime: minutesFromNow(48),
//     link: 'https://teams.live.com/meet/9323796621135?p=vPdu9CqicwPEf6s8FX',
//   },
];

/**
 * The students who will all attend SHARED_TEST_LECTURES together. Add or
 * remove entries freely — every student here joins every link in
 * SHARED_TEST_LECTURES at the same time as the others.
 */
const TEST_STUDENTS: TestStudent[] = [
  { label: 'Student1', displayName: 'SUE019441 (SHIVAM KUMAR)' },
  { label: 'Student2', displayName: 'SUE019442 (PRIYA SHARMA)' },
  { label: 'Student3', displayName: 'SUE019443 (RAHUL VERMA)' },
];

/**
 * Runs attendLectures() for one test student against the SHARED schedule,
 * in its own isolated browser context, with logs prefixed by that
 * student's label.
 */
async function runForTestStudent(browser: Browser, student: TestStudent): Promise<void> {
  const log = createLogger(student.label);
  let context: BrowserContext | undefined;

  try {
    context = await browser.newContext();
    const page = await context.newPage();

    log.divider();
    log.info(`🧪 Starting test run for ${student.displayName}`);
    log.divider();

    await attendLectures(context, page, SHARED_TEST_LECTURES, student.displayName, config.DRY_RUN, log);

    log.success(`🎉 Test run complete for ${student.displayName}`);
  } catch (err) {
    log.error(`Test run failed for ${student.displayName}: ${err}`);
    throw err;
  } finally {
    if (context) {
      await context.close();
    }
  }
}

test('Test attendLectures flow: multiple students, shared lecture schedule', async ({ browser }) => {
  test.setTimeout(90 * 60 * 1000); // 90 min ceiling — adjust if you add more/longer lectures

  logger.divider();
  logger.info(
    `🧪 TEST MODE — ${TEST_STUDENTS.length} student(s) sharing ${SHARED_TEST_LECTURES.length} lecture(s)`
  );
  logger.info('   Every student joins each link at the same time as the others.');
  logger.info(`   Mode: ${config.DRY_RUN ? '🧪 DRY RUN' : '🔴 LIVE'}`);
  logger.divider();

  // Promise.allSettled (not all()) so one student's link/join failure
  // doesn't cancel the others — same behavior as the production
  // multi-student orchestrator.
  const results = await Promise.allSettled(
    TEST_STUDENTS.map((student) => runForTestStudent(browser, student))
  );

  logger.divider();
  logger.schedule('📋 Test run summary:');
  results.forEach((result, i) => {
    const student = TEST_STUDENTS[i];
    if (result.status === 'fulfilled') {
      logger.success(`  ✅ ${student.label} — completed`);
    } else {
      logger.error(`  ❌ ${student.label} — failed: ${result.reason}`);
    }
  });
  logger.divider();
});