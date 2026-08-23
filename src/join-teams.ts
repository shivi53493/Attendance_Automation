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
      // click it.
      await dismissExternalProtocolDialog(page);
      await handleTeamsLandingPage(page, log);
      await handlePreJoinScreen(page, launcherUrl, displayName, log);
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
    await page.waitForTimeout(5000);
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
 * Performs Microsoft Teams step-by-step sign in flow strictly by clicking UI elements:
 * 1. Click "Sign in" button
 * 2. Fill email (sk0542759@gmail.com) & click Next
 * 3. Wait until URL contains "login.live.com"
 * 4. Press Escape to close any FIDO/Passkey popup
 * 5. Click "Other ways to sign in" button (waiting for networkidle)
 * 6. Click "Use your password" button (waiting for networkidle)
 * 7. Fill password (SHivAM@#4321) & click primaryButton
 * 8. Click primaryButton again (for "Stay signed in?" prompt)
 */
async function performTeamsSignIn(page: Page, log: Logger): Promise<void> {
  log.info('Step 1: Looking for "Sign in" button...');
  const signInBtn = page.getByRole('button', { name: 'Sign in' }).or(
    page.getByRole('button', { name: /sign in/i })
  );
  if (await signInBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    log.info('Clicking "Sign in" button...');
    await signInBtn.click({ timeout: config.ACTION_TIMEOUT_MS });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }

  log.info('Step 2: Entering email...');
  const emailInput = page.getByTestId('emailInput').or(
    page.locator('input[type="email"]')
  ).or(
    page.getByRole('textbox', { name: /email/i })
  ).or(
    page.locator('input[name="loginfmt"]')
  );
  await emailInput.waitFor({ state: 'visible', timeout: config.ACTION_TIMEOUT_MS });
  await emailInput.click();
  const email = process.env.TEAMS_EMAIL || 'sk0542759@gmail.com';
  await emailInput.fill(email);
  await page.waitForTimeout(500);

  log.info('Step 2b: Clicking Next button...');
  const nextBtn = page.getByTestId('authLoginDialogNextButton').or(
    page.locator('input[type="submit"]')
  ).or(
    page.getByRole('button', { name: /next/i })
  ).or(
    page.locator('#idSIButton9')
  );
  await nextBtn.click({ timeout: config.ACTION_TIMEOUT_MS });

  log.info('Step 3: Waiting for URL to contain "login.live.com"...');
  await page.waitForURL((url) => url.href.includes('login.live.com') || url.href.includes('login.microsoftonline.com'), {
    timeout: config.NAVIGATION_TIMEOUT_MS,
  }).catch((err) => {
    log.warn(`URL wait notice: ${err}`);
  });
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1000);

  log.info('Step 3b: Pressing Escape key to close passkey/FIDO popup...');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  log.info('Step 4: Looking for "Other ways to sign in"...');
  const otherWaysBtn = page.getByRole('button', { name: /Other ways to sign in/i }).or(
    page.getByText(/Other ways to sign in/i)
  ).or(
    page.locator('a:has-text("Other ways to sign in")')
  ).or(
    page.locator('#otc-link, #cantAccessAccount, [data-bind*="otherWays"], #signInAnotherWay')
  ).or(
    page.getByRole('link', { name: /Other ways to sign in/i })
  );

  const hasOtherWays = await otherWaysBtn.isVisible({ timeout: 10000 }).catch(() => false);
  if (hasOtherWays) {
    log.info('Clicking "Other ways to sign in"...');
    await otherWaysBtn.click({ timeout: config.ACTION_TIMEOUT_MS });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
      return page.waitForLoadState('domcontentloaded');
    });
    await page.waitForTimeout(1000);
  } else {
    log.info('"Other ways to sign in" not visible, checking password step directly...');
  }

  log.info('Step 5: Looking for "Use your password" option...');
  const usePasswordBtn = page.locator('[aria-label="Use your password"]').or(
    page.locator('span[role="button"]:has-text("Use your password")')
  ).or(
    page.locator('div[role="group"][aria-label="Use your password"]')
  ).or(
    page.locator('span.fui-Link:has-text("Use your password")')
  ).or(
    page.getByText('Use your password', { exact: true })
  ).or(
    page.locator('div').filter({ hasText: /^Use your password$/ })
  ).or(
    page.getByRole('button', { name: /Use your password/i })
  ).or(
    page.locator('#idA_PWD_SwitchToPassword')
  );

  const targetPasswordBtn = usePasswordBtn.first();
  const hasUsePassword = await targetPasswordBtn.isVisible({ timeout: 10000 }).catch(() => false);
  if (hasUsePassword) {
    log.info('Found "Use your password" option. Clicking...');
    try {
      await targetPasswordBtn.click({ timeout: config.ACTION_TIMEOUT_MS });
    } catch {
      await targetPasswordBtn.click({ force: true, timeout: config.ACTION_TIMEOUT_MS });
    }
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
      return page.waitForLoadState('domcontentloaded');
    });
    await page.waitForTimeout(1000);
  } else {
    log.info('"Use your password" option not visible (might already be on password screen)...');
  }

  log.info('Step 6: Entering password...');
  const passwordInput = page.getByRole('textbox', { name: /Password/i }).or(
    page.locator('input[type="password"]')
  ).or(
    page.locator('input[name="passwd"]')
  ).or(
    page.locator('#i0116, #i0118')
  );

  await passwordInput.waitFor({ state: 'visible', timeout: config.ACTION_TIMEOUT_MS });
  await passwordInput.click();
  await passwordInput.clear().catch(() => {});
  const password = process.env.TEAMS_PASSWORD || 'SHivAM@#4321';
  await passwordInput.pressSequentially(password, { delay: 20 });
  await page.waitForTimeout(300);
  await passwordInput.evaluate((el: HTMLElement) => el.blur()).catch(() => {});
  await page.waitForTimeout(500);

  log.info('Step 7: Submitting password via Primary Button / Enter key...');
  const primaryBtn = page.locator('button[data-testid="primaryButton"]').or(
    page.getByTestId('primaryButton')
  ).or(
    page.locator('button[type="submit"]')
  ).or(
    page.getByRole('button', { name: 'Next' })
  ).or(
    page.getByRole('button', { name: /sign in/i })
  ).or(
    page.locator('#idSIButton9')
  );

  const targetPrimaryBtn = primaryBtn.first();

  // Try submitting via Enter key first
  try {
    log.info('Pressing Enter key on password field...');
    await passwordInput.press('Enter');
    await page.waitForTimeout(1000);
  } catch (err) {
    log.warn(`Enter key submission notice: ${err}`);
  }

  // Click primary button if still visible
  if (await targetPrimaryBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    log.info('Clicking primary button ("Next" / "Sign in")...');
    try {
      await targetPrimaryBtn.click({ timeout: config.ACTION_TIMEOUT_MS });
    } catch {
      await targetPrimaryBtn.click({ force: true, timeout: config.ACTION_TIMEOUT_MS });
    }
  }

  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
    return page.waitForLoadState('domcontentloaded');
  });
  await page.waitForTimeout(2000);

  log.info('Step 8: Checking for "Stay signed in?" prompt...');
  if (await targetPrimaryBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    log.info('Confirming "Stay signed in?" prompt...');
    try {
      await targetPrimaryBtn.click({ timeout: config.ACTION_TIMEOUT_MS });
    } catch {
      await targetPrimaryBtn.click({ force: true, timeout: config.ACTION_TIMEOUT_MS });
    }
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
      return page.waitForLoadState('domcontentloaded');
    });
    await page.waitForTimeout(2000);
  }

  log.success('🔑 Microsoft Teams sign-in flow completed via UI buttons.');
}

/**
 * Handles the Teams pre-join screen:
 * - Checks if "Sign in" button is present and performs button-driven authentication
 * - After sign-in (or directly if already signed in), clicks ONLY "Join now" (skips camera/mic toggles & display name fill)
 */
async function handlePreJoinScreen(
  page: Page,
  launcherUrl: string,
  displayName: string,
  log: Logger
): Promise<void> {
  log.info('Waiting for pre-join screen / sign-in options...');

  const preJoinIndicators = [
    page.getByRole('button', { name: 'Sign in' }),
    page.getByRole('button', { name: /sign in/i }),
    page.getByRole('button', { name: /join now/i }),
    page.getByRole('button', { name: /join meeting/i }),
    page.getByText(/Someone will let you in shortly/i),
  ];

  const ready = await waitForAnyVisible(preJoinIndicators, config.NAVIGATION_TIMEOUT_MS);
  if (!ready) {
    await dumpDebugInfo(page, 'prejoin-not-ready', log);
    throw new Error(
      'Pre-join screen never became interactive (likely a slow connection still loading assets).'
    );
  }

  const signInBtn = page.getByRole('button', { name: 'Sign in' }).or(
    page.getByRole('button', { name: /sign in/i })
  );

  if (await signInBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    log.info('🔑 "Sign in" button detected. Executing Teams sign-in procedure via UI buttons...');
    await performTeamsSignIn(page, log);

    // Wait for natural redirect or handle landing button if shown again
    await page.waitForLoadState('domcontentloaded', { timeout: config.NAVIGATION_TIMEOUT_MS }).catch(() => {});
    await handleTeamsLandingPage(page, log);
  }

  // Per user instruction:
  // After successful sign in, ONLY click "Join now" button (no filling name, no camera off, no mic off)
  await clickJoinNow(page, displayName, log);
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
        await page.waitForTimeout(5000);
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

      await page.waitForTimeout(5000);
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
 * Turns the microphone off (mutes mic) with verification: after each attempt
 * it re-reads the toggle's aria-checked state to confirm it actually flipped,
 * instead of assuming a click/uncheck worked. Retries up to 3 times with short
 * per-attempt timeouts, so a slow-loading toggle gets multiple bounded
 * chances instead of one long blocking wait that looks "stuck".
 */
async function turnMicOff(page: Page, log: Logger): Promise<void> {
  const micSwitch = page.getByRole('switch', { name: 'Mute mic (Ctrl+Shift+M)' }).or(
    page.getByRole('switch', { name: /Mute mic/i })
  ).or(
    page.getByRole('switch', { name: /microphone/i })
  ).or(
    page.getByRole('button', { name: /mic/i })
  ).or(
    page.locator('[data-tid="toggle-mute"]')
  ).or(
    page.getByLabel(/mic/i)
  );

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const visible = await micSwitch.isVisible({ timeout: 5000 }).catch(() => false);
      if (!visible) {
        log.warn(`Mic toggle not visible yet (attempt ${attempt}/3), waiting...`);
        await page.waitForTimeout(5000);
        continue;
      }

      const state = await micSwitch.getAttribute('aria-checked').catch(() => null);
      if (state === 'false') {
        log.info('Mic already OFF.');
        return;
      }

      try {
        await micSwitch.uncheck({ timeout: config.ACTION_TIMEOUT_MS });
      } catch {
        await micSwitch.click({ timeout: config.ACTION_TIMEOUT_MS });
      }

      await page.waitForTimeout(5000);
      const confirmedOff = await micSwitch.getAttribute('aria-checked').catch(() => null);
      if (confirmedOff === 'false') {
        log.info('Mic turned OFF.');
        return;
      }

      log.warn(`Mic toggle attempt ${attempt}/3 did not confirm OFF state, retrying...`);
    } catch (err) {
      log.warn(`Mic toggle attempt ${attempt}/3 failed: ${err}`);
    }
  }

  log.warn('Could not confirm mic is OFF after 3 attempts — continuing with the join anyway.');
}

/**
 * Fills the display name field with realistic keypresses and blur events
 * so Teams React UI updates input validation state reliably in headed/headless mode.
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
      await nameInput.clear().catch(() => {});
      // Use pressSequentially to simulate real keypresses so Teams React validation handlers fire
      await nameInput.pressSequentially(displayName, { delay: 30 });
      await page.waitForTimeout(5000);
      // Blur the input to guarantee validation event triggers
      await nameInput.evaluate((el: HTMLElement) => el.blur()).catch(() => {});
      await page.waitForTimeout(5000);
      log.info(`Filled display name: ${displayName}`);
    }
  } catch (err) {
    log.warn(`Could not fill display name: ${err}`);
  }
}

/**
 * Clicks "Join now" or submits the pre-join form via Enter key.
 * Verifies transition into either the meeting room or the lobby ("Someone will let you in shortly").
 */
async function clickJoinNow(page: Page, displayName: string, log: Logger): Promise<void> {
  log.info('Looking for "Join now" button...');

  const joinButton = page.getByRole('button', { name: /join now/i }).or(
    page.getByRole('button', { name: /join meeting/i })
  ).or(
    page.getByText(/join now/i)
  ).or(
    page.getByRole('button', { name: /^join$/i })
  );

  const nameInput = page.getByRole('textbox', { name: /Type your name/i }).or(
    page.locator('input[placeholder*="name" i]')
  );

  // Check if already in lobby or meeting first
  const alreadyIn = await waitForMeetingOrLobby(page, log, 5000);
  if (alreadyIn !== 'timeout') {
    log.info(`Already transitioned to (${alreadyIn}). Skipping join click.`);
    return;
  }

  const visible = await joinButton.isVisible({ timeout: config.ACTION_TIMEOUT_MS }).catch(() => false);
  if (!visible) {
    await dumpDebugInfo(page, 'prejoin-not-found', log);
    throw new Error('Could not find "Join now" button.');
  }

  // Ensure button becomes enabled before clicking
  let enabled = await joinButton.isEnabled().catch(() => false);
  if (!enabled) {
    log.warn('"Join now" button is currently disabled. Re-triggering name input focus...');
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(5000);
    }
    enabled = await joinButton.isEnabled().catch(() => false);
  }

  // Try submitting via Enter key first (native Teams behavior on name input)
  let submittedViaEnter = false;
  if (await nameInput.isVisible().catch(() => false)) {
    try {
      log.info('Submitting pre-join form via Enter key on display name input...');
      await nameInput.press('Enter');
      await page.waitForTimeout(5000);
      submittedViaEnter = true;
    } catch (err) {
      log.warn(`Enter key submission failed: ${err}`);
    }
  }

  // If join button is still present/visible after Enter, click it explicitly
  if (await joinButton.isVisible().catch(() => false)) {
    try {
      log.info('Clicking "Join now" button...');
      await joinButton.click({ timeout: config.ACTION_TIMEOUT_MS });
      log.success('✅ Clicked "Join now" button.');
    } catch (err) {
      log.warn(`Click on "Join now" failed: ${err}`);
    }
  }

  // Wait for transition to confirm entry into meeting or lobby
  log.info('Waiting for transition into meeting or lobby ("Someone will let you in shortly")...');
  const transition = await waitForMeetingOrLobby(page, log, 15000);

  if (transition === 'lobby') {
    log.success('⏳ Entered Teams lobby ("Someone will let you in shortly"). Waiting to be admitted!');
  } else if (transition === 'in-meeting') {
    log.success('🎉 Successfully joined the meeting directly!');
  } else {
    log.warn('Joined status transition settled — assuming joined or waiting in lobby.');
  }
}

/**
 * Checks whether the page has transitioned into the meeting room or the lobby.
 */
async function waitForMeetingOrLobby(
  page: Page,
  log: Logger,
  timeoutMs: number = 10000
): Promise<'in-meeting' | 'lobby' | 'timeout'> {
  const startTime = Date.now();

  const lobbyIndicators = [
    page.getByText(/Someone will let you in shortly/i),
    page.getByText(/will let you in/i),
    page.locator('h1:has-text("will let you in")'),
    page.locator('div:has-text("will let you in")'),
  ];

  const meetingIndicators = [
    page.getByRole('button', { name: /Leave/i }),
    page.locator('[data-tid="call-hangup"]'),
    page.locator('#hangup-button'),
  ];

  while (Date.now() - startTime < timeoutMs) {
    for (const indicator of meetingIndicators) {
      if (await indicator.isVisible().catch(() => false)) {
        return 'in-meeting';
      }
    }

    for (const indicator of lobbyIndicators) {
      if (await indicator.isVisible().catch(() => false)) {
        return 'lobby';
      }
    }

    await page.waitForTimeout(5000);
  }

  return 'timeout';
}

/**
 * Leaves the Teams meeting by locating and clicking the "Leave" button or "Cancel" (if in lobby).
 * Any post-call survey ("How was the call quality?") is left alone — it
 * doesn't need dismissing since the next lecture's joinTeamsMeeting() will
 * navigate this same tab away from it anyway.
 *
 * @param log - Pass a per-student createLogger(label) for multi-student runs.
 */
export async function leaveTeamsMeeting(page: Page, log: Logger = defaultLogger): Promise<void> {
  log.info('Leaving Microsoft Teams meeting / lobby...');
  try {
    const leaveButton = page.getByRole('button', { name: /Leave/i }).or(
      page.getByRole('button', { name: /hang up/i })
    ).or(
      page.locator('[data-tid="call-hangup"]')
    ).or(
      page.locator('#hangup-button')
    ).or(
      page.getByRole('button', { name: /Cancel/i })
    );

    if (await leaveButton.isVisible({ timeout: config.ACTION_TIMEOUT_MS })) {
      await leaveButton.click({ timeout: config.ACTION_TIMEOUT_MS });
      log.success('✅ Successfully left meeting / lobby.');
    } else {
      log.warn('Leave/Cancel button not found. Continuing to next lecture regardless.');
    }
  } catch (err) {
    log.warn(`Could not click Leave button: ${err}`);
  }
}