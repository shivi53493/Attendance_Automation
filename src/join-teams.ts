import { Page } from '@playwright/test';
import { randomUUID } from 'crypto';
import { config } from './config';
import { logger as defaultLogger, Logger } from './logger';
import { retry, waitForAnyVisible } from './retry-utils';

/**
 * Joins a Microsoft Teams meeting in the SAME tab — no new tab, and no
 * native "Open Microsoft Teams?" dialog to fight with.
 *
 * The trick: Teams' own launcher.html page accepts a `suppressPrompt=true`
 * query param that skips the external-protocol confirmation entirely and
 * drops you straight onto the "Join meeting from this browser" screen.
 *
 * Everything here is retried as a whole via retry-utils' `retry()`: if
 * navigation times out, or the pre-join screen never becomes interactive,
 * or "Join now" can't be found, the ENTIRE flow (fresh goto included)
 * is attempted again up to `config.MAX_RETRIES` extra times. This is what
 * makes it resilient to slow/flaky connections instead of failing outright
 * on one bad moment.
 *
 * @param page - The page to navigate (reused across lectures — no tabs
 *   are opened or closed by this function).
 * @param meetingLink - The raw Teams meeting URL scraped from the LMS.
 * @param displayName - Name to fill on the pre-join screen for this student.
 * @param log - Pass a per-student createLogger(label) for multi-student
 *   runs so log lines (and debug screenshot filenames) are distinguishable.
 *   Defaults to the plain global logger.
 */
export async function joinTeamsMeeting(
  page: Page,
  meetingLink: string,
  displayName: string,
  log: Logger = defaultLogger
): Promise<void> {
  await retry(
    async () => {
      const launcherUrl = buildLauncherUrl(meetingLink);

      log.info('Navigating directly to Teams launcher (same tab)...');
      await page.goto(launcherUrl, {
        waitUntil: 'domcontentloaded',
        timeout: config.NAVIGATION_TIMEOUT_MS,
      });

      // Defensive safety net only: suppressPrompt=true should prevent the
      // native "Open Microsoft Teams?" dialog outright. If Teams ever
      // ignores the param, Escape is the only way to dismiss it — that
      // dialog is browser chrome, not a page element, so no locator can
      // click it.
      await dismissExternalProtocolDialog(page);

      await handleTeamsLandingPage(page, log);
      await handlePreJoinScreen(page, displayName, log);
    },
    {
      retries: config.MAX_RETRIES,
      delayMs: config.RETRY_DELAY_MS,
      label: 'Join Teams meeting flow',
      log,
    }
  );
}

/**
 * Rebuilds the raw meeting link into Teams' launcher.html URL format,
 * which supports `suppressPrompt=true` to skip the native app-picker
 * dialog and land straight on "Join meeting from this browser".
 */
function buildLauncherUrl(meetingLink: string): string {
  const original = new URL(meetingLink);
  original.searchParams.set('launchAgent', 'join_only');
  original.searchParams.set('type', 'meetup-join');
  original.searchParams.set('anon', 'true');

  // Teams' launcher expects the "inner" URL as a hash-routed path, e.g.
  // "/_#/l/meetup-join/19:meeting_.../0?context=...&launchAgent=...".
  const innerPath = `/_#${original.pathname}${original.search}`;

  const launcher = new URL('https://teams.microsoft.com/dl/launcher/launcher.html');
  launcher.searchParams.set('url', innerPath);
  launcher.searchParams.set('type', 'meetup-join');
  launcher.searchParams.set('deeplinkId', randomUUID());
  launcher.searchParams.set('directDl', 'true');
  launcher.searchParams.set('msLaunch', 'true');
  launcher.searchParams.set('enableMobilePage', 'true');
  launcher.searchParams.set('suppressPrompt', 'true');

  return launcher.toString();
}

/**
 * Presses Escape to dismiss Chromium's native external-protocol dialog,
 * in case suppressPrompt=true doesn't fully prevent it in every case.
 * Cheap and harmless if the dialog never appears.
 */
async function dismissExternalProtocolDialog(page: Page): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.keyboard.press('Escape');
    } catch {
      // ignore — dialog likely wasn't present
    }
    await page.waitForTimeout(800);
  }
}

/**
 * Dumps a screenshot + current URL so failures are diagnosable instead of
 * just logging "not found" with no evidence. Filename includes a random
 * suffix so simultaneous students' debug shots never collide.
 */
async function dumpDebugInfo(page: Page, label: string, log: Logger): Promise<void> {
  try {
    const path = `debug-${label}-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
    await page.screenshot({ path, fullPage: true });
    log.warn(`Debug screenshot saved: ${path}`);
    log.warn(`Current URL: ${page.url()}`);
  } catch (err) {
    log.warn(`Failed to capture debug info: ${err}`);
  }
}

/**
 * Clicks "Join meeting from this browser" (or older-UI equivalents like
 * "Continue on this browser") on the launcher landing screen.
 *
 * Uses waitForAnyVisible() instead of a fixed sleep: it proceeds the
 * instant the button appears, and tolerates slow page loads by polling up
 * to config.NAVIGATION_TIMEOUT_MS instead of a hardcoded short window.
 */
async function handleTeamsLandingPage(page: Page, log: Logger): Promise<void> {
  log.info('Looking for "Join meeting from this browser" button...');

  const candidates = [
    page.getByRole('button', { name: /join meeting from this browser/i }),
    page.getByRole('button', { name: /continue on this browser/i }),
    page.locator('button[data-tid="joinOnWeb"]'),
    page.getByText(/join meeting from this browser/i),
    page.getByText(/continue on this browser/i),
  ];

  const match = await waitForAnyVisible(candidates, config.NAVIGATION_TIMEOUT_MS);

  if (!match) {
    // Not necessarily fatal — Teams sometimes skips straight to the
    // pre-join screen. handlePreJoinScreen()'s own readiness check will
    // catch it if nothing ever loads.
    log.warn('No landing page button detected — might already be on the pre-join screen.');
    return;
  }

  try {
    await match.click({ timeout: config.ACTION_TIMEOUT_MS });
    log.success('Clicked "Join meeting from this browser".');
  } catch (err) {
    log.warn(`Click on landing button failed, continuing: ${err}`);
    return;
  }

  // Clicking triggers a full navigation to the light-meetings/launch page.
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: config.NAVIGATION_TIMEOUT_MS });
  } catch {
    log.warn('Timed out waiting for navigation after landing click, proceeding anyway...');
  }
}

/**
 * Handles the Teams pre-join screen:
 * - Waits (dynamically) for the screen to actually be interactive
 * - Turns off camera (verified, with retries — this is what was getting
 *   "stuck" before: a single long blocking attempt with no verification)
 * - Fills display name
 * - Clicks "Join now"
 *
 * Throws if the pre-join screen never loads or "Join now" is never found,
 * so the outer retry() in joinTeamsMeeting() restarts the whole flow.
 */
async function handlePreJoinScreen(page: Page, displayName: string, log: Logger): Promise<void> {
  log.info('Waiting for pre-join screen to become interactive...');

  const preJoinIndicators = [
    page.getByRole('switch', { name: /Turn camera off/i }),
    page.getByRole('textbox', { name: /Type your name/i }),
    page.getByRole('button', { name: /join now/i }),
  ];

  const ready = await waitForAnyVisible(preJoinIndicators, config.NAVIGATION_TIMEOUT_MS);
  if (!ready) {
    await dumpDebugInfo(page, 'prejoin-not-ready', log);
    throw new Error(
      'Pre-join screen never became interactive (likely a slow connection still loading assets).'
    );
  }

  await turnCameraOff(page, log);
  await fillDisplayName(page, displayName, log);
  await clickJoinNow(page, log);
}

/**
 * Turns the camera off with verification: after each attempt it re-reads
 * the toggle's aria-checked state to confirm it actually flipped, instead
 * of assuming a click/uncheck worked. Retries up to 3 times with short
 * per-attempt timeouts, so a slow-loading toggle gets multiple bounded
 * chances instead of one long blocking wait that looks "stuck".
 */
async function turnCameraOff(page: Page, log: Logger): Promise<void> {
  const cameraSwitch = page.getByRole('switch', { name: /Turn camera off/i }).or(
    page.getByRole('button', { name: /camera/i })
  ).or(
    page.locator('[data-tid="toggle-video"]')
  ).or(
    page.getByLabel(/camera/i)
  );

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const visible = await cameraSwitch.isVisible({ timeout: 3000 }).catch(() => false);
      if (!visible) {
        log.warn(`Camera toggle not visible yet (attempt ${attempt}/3), waiting...`);
        await page.waitForTimeout(1000);
        continue;
      }

      const state = await cameraSwitch.getAttribute('aria-checked').catch(() => null);
      if (state === 'false') {
        log.info('Camera already OFF.');
        return;
      }

      try {
        await cameraSwitch.uncheck({ timeout: config.ACTION_TIMEOUT_MS });
      } catch {
        await cameraSwitch.click({ timeout: config.ACTION_TIMEOUT_MS });
      }

      await page.waitForTimeout(500);
      const confirmedOff = await cameraSwitch.getAttribute('aria-checked').catch(() => null);
      if (confirmedOff === 'false') {
        log.info('Camera turned OFF.');
        return;
      }

      log.warn(`Camera toggle attempt ${attempt}/3 did not confirm OFF state, retrying...`);
    } catch (err) {
      log.warn(`Camera toggle attempt ${attempt}/3 failed: ${err}`);
    }
  }

  log.warn('Could not confirm camera is OFF after 3 attempts — continuing with the join anyway.');
}

/**
 * Fills the display name field. Best-effort — not fatal if it fails,
 * since joining with the default name is preferable to not joining.
 */
async function fillDisplayName(page: Page, displayName: string, log: Logger): Promise<void> {
  try {
    const nameInput = page.getByRole('textbox', { name: /Type your name/i }).or(
      page.locator('input[placeholder*="name" i]')
    ).or(
      page.locator('input[aria-label*="name" i]')
    );

    if (await nameInput.isVisible({ timeout: config.ACTION_TIMEOUT_MS })) {
      await nameInput.click({ timeout: config.ACTION_TIMEOUT_MS });
      await nameInput.fill(displayName);
      log.info(`Filled display name: ${displayName}`);
    }
  } catch (err) {
    log.warn(`Could not fill display name: ${err}`);
  }
}

/**
 * Clicks "Join now". This IS fatal (throws) if it can't be found/clicked —
 * without it the meeting was never actually joined, so it's worth letting
 * the outer retry() restart the whole flow rather than silently moving on.
 */
async function clickJoinNow(page: Page, log: Logger): Promise<void> {
  log.info('Looking for "Join now" button...');

  const joinButton = page.getByRole('button', { name: /join now/i }).or(
    page.getByRole('button', { name: /join meeting/i })
  ).or(
    page.getByText(/join now/i)
  ).or(
    page.getByRole('button', { name: /^join$/i })
  );

  const visible = await joinButton.isVisible({ timeout: config.ACTION_TIMEOUT_MS }).catch(() => false);
  if (!visible) {
    await dumpDebugInfo(page, 'prejoin-not-found', log);
    throw new Error('Could not find "Join now" button.');
  }

  await joinButton.click({ timeout: config.ACTION_TIMEOUT_MS });
  log.success('✅ Clicked "Join now" — joining the meeting!');

  // Small settle wait for the in-meeting UI to mount; not blocking.
  await page.waitForTimeout(1500);
}

/**
 * Leaves the Teams meeting by locating and clicking the "Leave" button.
 * Any post-call survey ("How was the call quality?") is left alone — it
 * doesn't need dismissing since the next lecture's joinTeamsMeeting() will
 * navigate this same tab away from it anyway.
 *
 * @param log - Pass a per-student createLogger(label) for multi-student runs.
 */
export async function leaveTeamsMeeting(page: Page, log: Logger = defaultLogger): Promise<void> {
  log.info('Leaving Microsoft Teams meeting...');
  try {
    const leaveButton = page.getByRole('button', { name: /Leave/i }).or(
      page.getByRole('button', { name: /hang up/i })
    ).or(
      page.locator('[data-tid="call-hangup"]')
    ).or(
      page.locator('#hangup-button')
    );

    if (await leaveButton.isVisible({ timeout: config.ACTION_TIMEOUT_MS })) {
      await leaveButton.click({ timeout: config.ACTION_TIMEOUT_MS });
      log.success('✅ Successfully clicked Leave.');
    } else {
      log.warn('Leave button not found. Continuing to next lecture regardless.');
    }
  } catch (err) {
    log.warn(`Could not click Leave button: ${err}`);
  }
}