import { Locator } from '@playwright/test';
import { logger as defaultLogger, Logger } from './logger';

/**
 * Retries an async operation with a delay between attempts.
 *
 * Use this to wrap anything sensitive to transient network conditions
 * (a full navigation + join flow, for example) so a single slow moment
 * doesn't fail the whole run. On failure it logs, waits `delayMs`, and
 * tries `fn` again from scratch, up to `retries` extra times.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; delayMs?: number; label?: string; log?: Logger } = {}
): Promise<T> {
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 3000;
  const label = options.label ?? 'operation';
  const log = options.log ?? defaultLogger;

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === retries + 1;
      log.warn(
        `${label} failed on attempt ${attempt}/${retries + 1}: ${err}` +
          (isLastAttempt ? '' : ` — retrying in ${delayMs}ms...`)
      );
      if (!isLastAttempt) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

/**
 * Polls a set of locators until one becomes visible, or `timeoutMs`
 * elapses. Returns the first locator that appears, or null on timeout.
 *
 * This replaces blind `page.waitForTimeout(N)` calls: it returns the
 * instant something is actually ready instead of always waiting a fixed
 * duration, and it tolerates slow connections by polling for the full
 * timeout instead of giving up after one quick check.
 */
export async function waitForAnyVisible(
  candidates: Locator[],
  timeoutMs: number,
  pollIntervalMs: number = 500
): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    for (const locator of candidates) {
      try {
        if (await locator.isVisible({ timeout: pollIntervalMs })) {
          return locator;
        }
      } catch {
        // not visible / detached yet — keep polling
      }
    }
  }

  return null;
}