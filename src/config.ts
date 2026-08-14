import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  LMS_URL: process.env.LMS_URL || 'https://sutech.univlms.com/signin/index?redirect=/',
  HEADLESS: process.env.HEADLESS === 'true',
  DRY_RUN: process.env.DRY_RUN === 'true',

  // Path to the CSV file listing every student to run the pipeline for.
  // Columns: username,password,displayName,label (label is optional).
  STUDENTS_CSV_PATH: process.env.STUDENTS_CSV_PATH || path.resolve(__dirname, '..', 'students.csv'),

  // --- Timing knobs (all milliseconds) ---
  // Tune these via .env if your connection is consistently slow/fast,
  // instead of editing timeouts scattered through the code.

  // How long page.goto() / full-page navigations are allowed to take.
  NAVIGATION_TIMEOUT_MS: parseIntEnv('NAVIGATION_TIMEOUT_MS', 90000),

  // How long a single UI action (click, fill, uncheck) is allowed to take.
  ACTION_TIMEOUT_MS: parseIntEnv('ACTION_TIMEOUT_MS', 20000),

  // How many extra attempts a failed join flow gets before giving up on
  // that lecture entirely (1 initial attempt + this many retries).
  MAX_RETRIES: parseIntEnv('MAX_RETRIES', 2),

  // Delay between retry attempts.
  RETRY_DELAY_MS: parseIntEnv('RETRY_DELAY_MS', 3000),
};