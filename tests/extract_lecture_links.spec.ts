import { test } from '@playwright/test';
import { config } from '../src/config';
import { loginToLMS } from '../src/lms-login';
import { scrapeLectures } from '../src/scrape-lectures';
import { attendLectures } from '../src/attend-lectures';
import { loadStudents } from '../src/students-loader';
import { logger } from '../src/logger';

/**
 * Single-student smoke test. Credentials now come from students.csv
 * (config.USERNAME/PASSWORD were removed in favor of the CSV-driven,
 * multi-student setup) — this test just runs the first row of the CSV.
 * For running every student at once, see multi-student-attendance.spec.ts.
 */
test('Automated Lecture Attendance (single student)', async ({ page, context }) => {
  logger.divider();
  logger.info('🎓 Automated Lecture Attendance System — Starting...');
  logger.info(`   Mode: ${config.DRY_RUN ? '🧪 DRY RUN' : '🔴 LIVE'}`);
  logger.divider();

  const students = loadStudents(config.STUDENTS_CSV_PATH);
  const student = students[0];
  logger.info(`Running for: ${student.label} (${student.username})`);

  // Step 1: Login to LMS
  await loginToLMS(page, student.username, student.password);

  // Step 2: Scrape today's lecture schedule
  const lectures = await scrapeLectures(page);

  if (lectures.length === 0) {
    logger.warn('No lectures found for today. Exiting.');
    return;
  }

  // Step 3: Attend lectures based on schedule (pass context for new tab handling)
  await attendLectures(context, page, lectures, student.displayName, config.DRY_RUN);

  logger.info('🎓 Attendance automation complete. Goodbye!');
});