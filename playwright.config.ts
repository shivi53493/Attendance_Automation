import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

/**
 * Load environment variables from .env file.
 */
dotenv.config({ path: path.resolve(__dirname, '.env') });

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
    /* Run in headed mode so Teams can open visually */
    headless: process.env.HEADLESS === 'true',

    /* Action timeout for individual operations */
    actionTimeout: 30000,

    /* Auto-grant microphone and camera permissions for Teams */
    permissions: ['microphone', 'camera'],

    /* Collect trace on failure */
    trace: 'on-first-retry',
  },

  /* Only Chromium — Teams works best in Chrome */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
