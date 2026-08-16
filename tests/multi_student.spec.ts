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

/**
 * Filters the loaded student list down to just the one matching
 * STUDENT_USERNAME (set by the GitHub Actions matrix). Comparison is
 * case-insensitive and whitespace-trimmed on both sides so harmless
 * formatting differences between the matrix value and the CSV don't
 * cause a false "no matching row" failure.
 *
 * If STUDENT_USERNAME isn't set at all (e.g. running locally without the
 * matrix), all students are returned unfiltered — original multi-student
 * parallel behavior is preserved for local/manual runs.
 */
function filterToTargetStudent(students: StudentProfile[]): StudentProfile[] {
  const rawTarget = process.env.STUDENT_USERNAME;
  if (!rawTarget || !rawTarget.trim()) {
    return students;
  }

  const targetUsername = rawTarget.trim();
  const targetLower = targetUsername.toLowerCase();

  const matched = students.filter(
    (s) => s.username.trim().toLowerCase() === targetLower
  );

  if (matched.length === 0) {
    // Debug aid: print exactly what usernames were parsed from the CSV,
    // with lengths, so typos / case / hidden whitespace are obvious
    // instead of a bare "not found" error.
    logger.error(
      `Looking for STUDENT_USERNAME="${targetUsername}" (length ${targetUsername.length})`
    );
    if (students.length === 0) {
      logger.error('  The CSV loaded ZERO students — check STUDENTS_CSV secret content/format.');
    } else {
      students.forEach((s) => {
        const trimmed = s.username.trim();
        logger.error(
          `  CSV has: "${s.username}" (length ${s.username.length}, trimmed "${trimmed}") ` +
            `— case-insensitive match: ${trimmed.toLowerCase() === targetLower}`
        );
      });
    }

    throw new Error(
      `STUDENT_USERNAME="${targetUsername}" was set but no matching row was found in ${config.STUDENTS_CSV_PATH}. ` +
        `Check the debug output above for the exact usernames the CSV parsed, and compare against the matrix value ` +
        `for typos, case, or stray whitespace.`
    );
  }

  if (matched.length > 1) {
    logger.warn(
      `STUDENT_USERNAME="${targetUsername}" matched ${matched.length} rows in the CSV — using the first one. ` +
        `Check for duplicate usernames in students.csv.`
    );
  }

  return [matched[0]];
}

test('Multi-student parallel lecture attendance', async ({ browser }) => {
  // Generous ceiling: several lectures x 15 min stay each, running in
  // parallel across students, plus login/scrape overhead.
  test.setTimeout(6 * 60 * 60 * 1000);

  logger.divider();
  logger.info('🎓 Multi-Student Automated Lecture Attendance — Starting...');
  logger.info(`   Mode: ${config.DRY_RUN ? '🧪 DRY RUN' : '🔴 LIVE'}`);
  logger.divider();

  let students = loadStudents(config.STUDENTS_CSV_PATH);
  logger.info(`Loaded ${students.length} student(s) from ${config.STUDENTS_CSV_PATH}`);
  students.forEach((s, i) => logger.info(`  ${i + 1}. ${s.label} (${s.username})`));
  logger.divider();

  // If STUDENT_USERNAME is set (as it is in the GitHub Actions matrix),
  // restrict this run to ONLY that student. This is what makes the
  // matrix strategy actually isolate one student per job/runner instead
  // of every job redundantly running all students in parallel and
  // starving the runner's CPU/RAM.
  students = filterToTargetStudent(students);

  if (process.env.STUDENT_USERNAME) {
    logger.info(`STUDENT_USERNAME filter active — running only for ${students[0].username}`);
    logger.divider();
  }

  // Fully parallel: every remaining student's pipeline starts at (roughly)
  // the same time, each in its own browser context. allSettled (not
  // all()) so one student's rejection doesn't cancel/abort the others.
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
