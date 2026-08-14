import { test, Browser, BrowserContext } from '@playwright/test';
import { config } from '../src/config';
import { loginToLMS } from '../src/lms-login';
import { scrapeLectures } from '../src/scrape-lectures';
import { attendLectures } from '../src/attend-lectures';
import { loadStudents } from '../src/students-loader';
import { logger, createLogger } from '../src/logger';
import { StudentProfile } from '../src/types';

/**
 * Runs the complete pipeline (login -> scrape -> attend) for ONE student,
 * in its own isolated browser context so their session/cookies never mix
 * with another student's. Every log line is prefixed with the student's
 * label so interleaved parallel output can still be told apart.
 *
 * Failures are caught and logged here rather than thrown, so one
 * student's failure (bad credentials, expired link, etc.) never stops
 * the others — see how it's called in the test below via
 * Promise.allSettled.
 */
async function runForStudent(browser: Browser, student: StudentProfile): Promise<void> {
  const log = createLogger(student.label);
  let context: BrowserContext | undefined;

  try {
    context = await browser.newContext();
    const page = await context.newPage();

    log.divider();
    log.info(`🎓 Starting automation for ${student.username}`);
    log.info(`   Mode: ${config.DRY_RUN ? '🧪 DRY RUN' : '🔴 LIVE'}`);
    log.divider();

    // Step 1: Login to LMS with this student's own credentials
    await loginToLMS(page, student.username, student.password, log);

    // Step 2: Scrape today's lecture schedule from this student's dashboard
    const lectures = await scrapeLectures(page, log);

    if (lectures.length === 0) {
      log.warn('No lectures found for today. Nothing to attend.');
      return;
    }

    // Step 3: Attend lectures, filling this student's own display name
    await attendLectures(context, page, lectures, student.displayName, config.DRY_RUN, log);

    log.success(`🎉 Finished all lectures for ${student.username}`);
  } catch (err) {
    log.error(`Fatal error for ${student.username}: ${err}`);
    throw err; // re-thrown so Promise.allSettled records it as 'rejected'
  } finally {
    if (context) {
      await context.close();
    }
  }
}

test('Multi-student parallel lecture attendance', async ({ browser }) => {
  // Generous ceiling: several lectures x 15 min stay each, running in
  // parallel across students, plus login/scrape overhead.
  test.setTimeout(6 * 60 * 60 * 1000); // 2 hours

  logger.divider();
  logger.info('🎓 Multi-Student Automated Lecture Attendance — Starting...');
  logger.info(`   Mode: ${config.DRY_RUN ? '🧪 DRY RUN' : '🔴 LIVE'}`);
  logger.divider();

  const students = loadStudents(config.STUDENTS_CSV_PATH);
  logger.info(`Loaded ${students.length} student(s) from ${config.STUDENTS_CSV_PATH}`);
  students.forEach((s, i) => logger.info(`  ${i + 1}. ${s.label} (${s.username})`));
  logger.divider();

  // Fully parallel: every student's pipeline starts at (roughly) the same
  // time, each in its own browser context. allSettled (not all()) so one
  // student's rejection doesn't cancel/abort the others.
  const results = await Promise.allSettled(
    students.map((student) => runForStudent(browser, student))
  );

  logger.divider();
  logger.schedule('📋 Multi-student run summary:');
  logger.divider();

  let successCount = 0;
  results.forEach((result, i) => {
    const student = students[i];
    if (result.status === 'fulfilled') {
      logger.success(`  ✅ ${student.label} (${student.username}) — completed`);
      successCount++;
    } else {
      logger.error(`  ❌ ${student.label} (${student.username}) — failed: ${result.reason}`);
    }
  });

  logger.divider();
  logger.info(`${successCount}/${students.length} student(s) completed successfully.`);
  logger.divider();
});