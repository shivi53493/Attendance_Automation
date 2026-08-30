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

/**
 * Orchestrates attending all upcoming lectures by navigating the SAME tab
 * to each Teams link at the correct scheduled time, staying until each
 * lecture's scheduled end time, leaving, and moving to the next one.
 * No new tabs are opened or closed — joinTeamsMeeting() just navigates `page` in place.
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

  // Print dry-run plan or return
  if (dryRun) {
    log.warn('🧪 DRY RUN MODE — No links will be opened.');
    log.divider();

    upcomingLectures.forEach((lecture) => {
      const delay = getDelayUntil(lecture.startTime);
      const stayDuration = getDelayUntil(lecture.endTime);
      if (delay > 0) {
        log.info(
          `  Would wait ${formatDuration(delay)}, then open in new context: [${lecture.code}] ${lecture.subject} (stay until ${formatTime(lecture.endTime)}, ~${formatDuration(stayDuration)})`
        );
      } else {
        log.info(
          `  Would open NOW in new context (already started): [${lecture.code}] ${lecture.subject} (stay until ${formatTime(lecture.endTime)}, ~${formatDuration(stayDuration)})`
        );
      }
    });

    log.divider();
    log.success('Dry run complete. No actions taken.');
    return;
  }

  const browser = context.browser();

  // Close the initial LMS tab/page once we start attending lectures if browser is available
  if (browser && page && !page.isClosed()) {
    await page.close().catch(() => {});
  }

  // Attend each lecture in a fresh browser context
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

    log.divider();
    log.join(`🚀 Creating fresh browser context for lecture: [${lecture.code}] ${lecture.subject}`);
    log.join(`   Time: ${lecture.timing}`);
    log.join(`   Link: ${lecture.link.substring(0, 80)}...`);

    let currentContext: BrowserContext = context;
    let currentPage: Page = page;
    let createdNewContext = false;

    if (browser) {
      currentContext = await browser.newContext();
      currentPage = await currentContext.newPage();
      createdNewContext = true;

      try {
        await currentContext.grantPermissions(['camera', 'microphone'], {
          origin: 'https://teams.microsoft.com',
        });
      } catch (err) {
        log.warn(`Could not grant camera/mic permissions: ${err}`);
      }
    }

    try {
      await joinTeamsMeeting(currentPage, lecture.link, displayName, log);
      log.success(`✅ Joined Teams meeting flow for [${lecture.code}] ${lecture.subject}`);

      // Calculate remaining duration until lecture end time
      const remainingMs = getDelayUntil(lecture.endTime);

      if (remainingMs > 0) {
        log.info(
          `⏳ Staying in the lecture/lobby until end time ${formatTime(lecture.endTime)} (${formatDuration(remainingMs)} remaining)...`
        );
        await stayInMeetingWithLobbyMonitoring(currentPage, lecture.endTime, log);
      } else {
        log.warn(
          `⚠️ Lecture end time (${formatTime(lecture.endTime)}) has already passed. Leaving meeting.`
        );
      }

      // Leave the meeting / lobby
      await leaveTeamsMeeting(currentPage, log);
    } catch (error) {
      log.error(`Error during Teams meeting for [${lecture.code}]: ${error}`);
      // Continue to next lecture even if this one fails
    } finally {
      if (createdNewContext) {
        log.info(`🧹 Closing browser context for lecture [${lecture.code}]...`);
        await currentContext.close().catch(() => {});
      }
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
 * Monitors the meeting page until `endTime`, logging whether
 * the student is currently waiting in the lobby or has been admitted to the live call.
 */
async function stayInMeetingWithLobbyMonitoring(
  page: Page,
  endTime: Date,
  log: Logger
): Promise<void> {
  let wasAdmitted = false;
  let lastLogTime = 0;

  while (Date.now() < endTime.getTime()) {
    const remainingMs = Math.max(0, endTime.getTime() - Date.now());

    const isLobbyVisible = await page
      .getByText(/Someone will let you in shortly/i)
      .isVisible()
      .catch(() => false);

    const isInMeetingVisible = await page
      .getByRole('button', { name: /Leave/i })
      .or(page.locator('[data-tid="call-hangup"]'))
      .or(page.locator('#hangup-button'))
      .isVisible()
      .catch(() => false);

    if (isInMeetingVisible && !wasAdmitted) {
      wasAdmitted = true;
      log.success('🎉 Host admitted student into the live lecture room!');
    }

    // Log status update every 30 seconds
    if (Date.now() - lastLogTime >= 30000) {
      lastLogTime = Date.now();
      const remMins = Math.ceil(remainingMs / 60000);
      if (isInMeetingVisible) {
        log.info(`🟢 Active in live lecture room (${remMins} min remaining)`);
      } else if (isLobbyVisible) {
        log.info(`⏳ Waiting in Teams lobby queue ("Someone will let you in shortly") (${remMins} min remaining)`);
      } else {
        log.info(`⏱️ In lecture session (${remMins} min remaining)`);
      }
    }

    // Sleep in 5-second intervals to stay responsive
    const checkInterval = Math.min(5000, remainingMs);
    if (checkInterval <= 0) break;
    await sleep(checkInterval);
  }
}

/**
 * Async sleep utility.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}