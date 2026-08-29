import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

/**
 * Load environment variables from .env file.
 */
dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * Path to the Microsoft/Teams session captured by
 * scripts/capture-session.ts. When present, it's loaded as the browser's
 * storageState so the automation reuses the same trusted, signed-in
 * identity your manual browser has — this is what lets Teams auto-admit
 * instead of parking the join in the "Someone will let you in shortly"
 * lobby.
 */
const storageStatePath = path.resolve(__dirname, 'auth', 'teams-session.json');
const hasStoredSession = fs.existsSync(storageStatePath);

/**
 * Playwright configuration for the Attendance Automation system.
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',

  /* Disable parallel — we run one sequential attendance flow */
  fullyParallel: false,

  /* No retries — attendance is a one-shot flow */
  retries: 0,

  /* Single worker — sequential execution */
  workers: 1,

  /* Reporter */
  reporter: 'html',

  /* Global timeout: 12 hours (the script may run all day) */
  globalTimeout: 12 * 60 * 60 * 1000,

  /* Individual test timeout: 12 hours */
  timeout: 12 * 60 * 60 * 1000,

  /* Shared settings */
  use: {
    /* Set timezone to IST */
    timezoneId: 'Asia/Kolkata',

    /* Run in headed mode so Teams can open visually */
    headless: process.env.HEADLESS === 'true',

    /* Action timeout for individual operations */
    actionTimeout: 30000,

    /* Auto-grant microphone and camera permissions for Teams */
    permissions: ['microphone', 'camera'],

    /* Collect trace on failure */
    trace: 'on-first-retry',

    /* Reuse the captured Microsoft/Teams session (if one exists) so the
     * automated browser is treated as the same signed-in identity as a
     * manual browser instead of a fresh, cookie-less anonymous session.
     * Without this, Teams can't verify the joiner matches the meeting's
     * expected attendee and holds every join in the lobby. */
    ...(hasStoredSession ? { storageState: storageStatePath } : {}),

    launchOptions: {
      args: [
        // Disable WebAuthn / Passkey OS popups so Microsoft Login defaults to password
        '--disable-features=WebAuthentication,WebAuthenticationUI',
        '--disable-webauthn',
        // Without a real webcam/mic, Teams' getUserMedia() can hang or
        // throw inside its own pre-join JS. These give Chromium a fake
        // device to enumerate so that code path completes normally,
        // which matters most when running headless in CI.
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        // Reduces (not eliminates) some headless-specific automation
        // fingerprinting signals.
        '--disable-blink-features=AutomationControlled',
      ],
    },
  },

  /* Only Chromium — Teams works best in Chrome */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});