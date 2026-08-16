import { test, Browser, BrowserContext } from '@playwright/test';
import { config } from '../src/config';
import { loginToLMS } from '../src/lms-login';
import { scrapeLectures } from '../src/scrape-lectures';
import { attendLectures } from '../src/attend-lectures';
import { loadStudents } from '../src/students-loader';
import { logger, createLogger } from '../src/logger';
import { StudentProfile } from '../src/types';

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

    await loginToLMS(page, student.username, student.password, log);

    const lectures = await scrapeLectures(page, log);

    if (lectures.length === 0) {
      log.warn('No lectures found for today. Nothing to attend.');
      return;
    }

    await attendLectures(context, page, lectures, student.displayName, config.DRY_RUN, log);

    log.success(`🎉 Finished all lectures for ${student.username}`);
  } catch (err) {
    log.error(`Fatal error for ${student.username}: ${err}`);
    throw err;
  } finally {
    if (context) {
      await context.close();
    }
  }
}

test('Multi-student parallel lecture attendance', async ({ browser }) => {
  test.setTimeout(6 * 60 * 60 * 1000);

  logger.divider();
  logger.info('🎓 Multi-Student Automated Lecture Attendance — Starting...');
  logger.info(`   Mode: ${config.DRY_RUN ? '🧪 DRY RUN' : '🔴 LIVE'}`);
  logger.divider();

  let students = loadStudents(config.STUDENTS_CSV_PATH);

  // If STUDENT_USERNAME is set (as it is in the GitHub Actions matrix),
  // restrict this run to ONLY that student. This is what makes the
  // matrix strategy actually isolate one student per job/runner instead
  // of every job redundantly running all students in parallel and
  // starving the runner's CPU/RAM.
  const targetUsername = process.env.STUDENT_USERNAME?.trim();
  if (targetUsername) {
    students = students.filter((s) => s.username === targetUsername);
    if (students.length === 0) {
      throw new Error(
        `STUDENT_USERNAME="${targetUsername}" was set but no matching row was found in ${config.STUDENTS_CSV_PATH}. ` +
          `Check that the username in your STUDENTS_CSV secret exactly matches the matrix value.`
      );
    }
    logger.info(`STUDENT_USERNAME filter active — running only for ${targetUsername}`);
  }

  logger.info(`Loaded ${students.length} student(s) from ${config.STUDENTS_CSV_PATH}`);
  students.forEach((s, i) => logger.info(`  ${i + 1}. ${s.label} (${s.username})`));
  logger.divider();

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
