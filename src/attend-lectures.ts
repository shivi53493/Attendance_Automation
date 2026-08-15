import { Page, BrowserContext } from '@playwright/test';
import { Lecture } from './types';
import {
  getDelayUntil,
  isLectureUpcoming,
  isLectureInProgress,
  formatTime,
  formatDuration,
} from './time-utils';
import { joinTeamsMeeting, leaveTeamsMeeting } from './join-teams';
import { logger as defaultLogger, Logger } from './logger';

const MEETING_DURATION_MS = 50 * 60 * 1000; // stay in each meeting for 50 minutes

/**
 * Orchestrates attending all upcoming lectures by navigating the SAME tab
 * to each Teams link at the correct scheduled time, staying for 15
 * minutes, leaving, and moving to the next one. No new tabs are opened or
 * closed — joinTeamsMeeting() just navigates `page` in place.
 *
 * @param context - Playwright BrowserContext, used once up front to grant
 *   camera/mic permissions so the pre-join screen never hits a native
 *   permission prompt for any lecture.
 * @param page - Playwright page instance (LMS dashboard initially, then
 *   reused as the Teams meeting tab for every lecture)
 * @param lectures - Array of Lecture objects (sorted by start time)
 * @param displayName - Name to fill on each lecture's pre-join screen for
 *   this student
 * @param dryRun - If true, logs the plan without actually opening links
 * @param log - Pass a per-student createLogger(label) for multi-student
 *   runs so log lines are prefixed. Defaults to the plain global logger.
 */
export async function attendLectures(
  context: BrowserContext,
  page: Page,
  lectures: Lecture[],
  displayName: string,
  dryRun: boolean = false,
  log: Logger = defaultLogger
): Promise<void> {
  // Filter to only upcoming lectures (not yet ended)
  const upcomingLectures = lectures.filter(isLectureUpcoming);

  if (upcomingLectures.length === 0) {
    log.warn('No upcoming lectures found for today. All lectures have already ended.');
    return;
  }

  // Print the day's schedule
  log.divider();
  log.schedule(`📋 Today's Schedule — ${upcomingLectures.length} lecture(s) remaining:`);
  log.divider();

  upcomingLectures.forEach((lecture, index) => {
    const status = isLectureInProgress(lecture) ? '🟢 IN PROGRESS' : '⏳ Upcoming';
    log.info(
      `  ${index + 1}. [${lecture.code}] ${lecture.subject}`
    );
    log.info(
      `     ⏰ ${lecture.timing}  |  ${status}`
    );
  });

  log.divider();

  if (dryRun) {
    log.warn('🧪 DRY RUN MODE — No links will be opened.');
    log.divider();

    upcomingLectures.forEach((lecture) => {
      const delay = getDelayUntil(lecture.startTime);
      if (delay > 0) {
        log.info(
          `  Would wait ${formatDuration(delay)}, then open: [${lecture.code}] ${lecture.subject}`
        );
      } else {
        log.info(
          `  Would open NOW (already started): [${lecture.code}] ${lecture.subject}`
        );
      }
    });

    log.divider();
    log.success('Dry run complete. No actions taken.');
    return;
  }

  // Grant camera/mic permissions once up front so Chromium never shows the
  // native permission bubble on any lecture's pre-join screen.
  try {
    await context.grantPermissions(['camera', 'microphone'], {
      origin: 'https://teams.microsoft.com',
    });
  } catch (err) {
    log.warn(`Could not grant camera/mic permissions: ${err}`);
  }

  // Attend each lecture, reusing the same `page` throughout
  for (let i = 0; i < upcomingLectures.length; i++) {
    const lecture = upcomingLectures[i];
    const nextLecture = upcomingLectures[i + 1];

    // Calculate how long to wait before this lecture starts
    const delayMs = getDelayUntil(lecture.startTime);

    if (delayMs > 0) {
      log.info(
        `⏳ Waiting ${formatDuration(delayMs)} until [${lecture.code}] ${lecture.subject} starts at ${formatTime(lecture.startTime)}...`
      );

      // Wait until the lecture start time
      await sleep(delayMs);
    }

    // Navigate the same tab into the Teams meeting and auto-join
    log.divider();
    log.join(`🚀 Joining lecture: [${lecture.code}] ${lecture.subject}`);
    log.join(`   Time: ${lecture.timing}`);
    log.join(`   Link: ${lecture.link.substring(0, 80)}...`);

    try {
      await joinTeamsMeeting(page, lecture.link, displayName, log);
      log.success(`✅ Joined Teams meeting for [${lecture.code}] ${lecture.subject}`);

      // Wait in the meeting for exactly 15 minutes
      log.info(`⏳ Staying in the meeting for ${MEETING_DURATION_MS / 60000} minutes as scheduled...`);
      await sleep(MEETING_DURATION_MS);

      // Leave the meeting
      await leaveTeamsMeeting(page, log);
    } catch (error) {
      log.error(`Error during Teams meeting for [${lecture.code}]: ${error}`);
      // Continue to next lecture even if this one fails — the next
      // joinTeamsMeeting() call will navigate `page` away regardless.
    }

    // Wait until it's time for the next lecture
    if (nextLecture) {
      const waitUntilNext = getDelayUntil(nextLecture.startTime);
      if (waitUntilNext > 0) {
        log.info(
          `📖 Left lecture [${lecture.code}]. Next lecture [${nextLecture.code}] starts at ${formatTime(nextLecture.startTime)}.`
        );
        log.info(`   Waiting ${formatDuration(waitUntilNext)} until next lecture starts...`);

        // Wait until just before the next lecture starts
        await sleep(waitUntilNext);
      }
    }
  }

  log.divider();
  log.success('🎉 All lectures for today have been attended!');
  log.divider();
}

/**
 * Async sleep utility.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
