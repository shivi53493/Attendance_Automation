import { Page } from '@playwright/test';
import { config } from './config';
import { logger as defaultLogger, Logger } from './logger';

/**
 * Logs into the university LMS portal and dismisses any popup modals.
 *
 * @param page - Page to log in on (each student should use their own
 *   isolated browser context/page)
 * @param username - LMS username for this student
 * @param password - LMS password for this student
 * @param log - Logger to use; pass a per-student createLogger(label) for
 *   multi-student runs so log lines are prefixed. Defaults to the plain
 *   global logger for single-user use.
 */
export async function loginToLMS(
  page: Page,
  username: string,
  password: string,
  log: Logger = defaultLogger
): Promise<void> {
  log.info('Navigating to LMS login page...');
  await page.goto(config.LMS_URL, { waitUntil: 'domcontentloaded' });

  // Fill in credentials
  log.info(`Logging in as ${username}...`);
  await page.getByRole('textbox', { name: 'Username' }).click();
  await page.getByRole('textbox', { name: 'Username' }).fill(username);
  await page.getByRole('textbox', { name: 'Password' }).click();
  await page.getByRole('textbox', { name: 'Password' }).fill(password);

  // Click login button
  await page.getByRole('button', { name: 'Log In' }).click();
  log.info('Login button clicked, waiting for dashboard...');

  // Wait for the dashboard to load
  await page.waitForTimeout(5000);

  // Dismiss popup modal if it appears
  try {
    const referEarnModal = page.locator('#referEarn');

    // Check if the modal is visible (with a short timeout)
    if (await referEarnModal.isVisible({ timeout: 5000 })) {
      log.info('Refer popup detected, trying to close it...');
      
      const closeSelectors = [
        referEarnModal.locator('.close'),
        referEarnModal.locator('[data-dismiss="modal"]'),
        referEarnModal.locator('button:has-text("Close")'),
        referEarnModal.locator('a:has-text("Close")'),
        referEarnModal.locator('[aria-label="Close"]'),
        referEarnModal.locator('.modal-header .close'),
        referEarnModal.locator('.close-btn'),
        referEarnModal.getByRole('button', { name: /close/i }),
        referEarnModal.getByRole('button', { name: /x/i }),
      ];

      let closed = false;
      for (const selector of closeSelectors) {
        try {
          if (await selector.isVisible({ timeout: 1000 })) {
            await selector.click();
            log.info('Dismissed popup modal using a close selector.');
            closed = true;
            break;
          }
        } catch {
          // ignore and try next
        }
      }

      if (!closed) {
        log.warn('Could not find explicit close button, attempting to press Escape...');
        await page.keyboard.press('Escape');
      }
    } else {
      log.info('Refer popup modal is not visible.');
    }
  } catch (err) {
    // Modal didn't appear — that's fine
    log.info('No popup modal detected or error occurred, continuing...');
  }

  await page.waitForTimeout(2000);
  log.success('Successfully logged into LMS!');
}