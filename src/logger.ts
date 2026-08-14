/**
 * Simple colored console logger with timestamps.
 */

function getTimestamp(): string {
  const now = new Date();
  return now.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export interface Logger {
  info(msg: string): void;
  success(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  schedule(msg: string): void;
  join(msg: string): void;
  divider(): void;
}

export const logger: Logger = {
  info(msg: string): void {
    console.log(`\x1b[36m[${getTimestamp()}] ℹ  ${msg}\x1b[0m`);
  },

  success(msg: string): void {
    console.log(`\x1b[32m[${getTimestamp()}] ✅ ${msg}\x1b[0m`);
  },

  warn(msg: string): void {
    console.log(`\x1b[33m[${getTimestamp()}] ⚠  ${msg}\x1b[0m`);
  },

  error(msg: string): void {
    console.log(`\x1b[31m[${getTimestamp()}] ❌ ${msg}\x1b[0m`);
  },

  schedule(msg: string): void {
    console.log(`\x1b[35m[${getTimestamp()}] 📅 ${msg}\x1b[0m`);
  },

  join(msg: string): void {
    console.log(`\x1b[34m[${getTimestamp()}] 🔗 ${msg}\x1b[0m`);
  },

  divider(): void {
    console.log(`\x1b[90m${'─'.repeat(60)}\x1b[0m`);
  },
};

/**
 * Creates a Logger that prefixes every line with `[label]`. Used so that
 * when multiple students run simultaneously, their interleaved console
 * output can still be told apart at a glance.
 *
 * Everything else about the logger (colors, timestamps, methods) is
 * identical to the default `logger` — only the label prefix is added.
 */
export function createLogger(label: string): Logger {
  const tag = `[${label}]`;
  return {
    info(msg: string): void {
      logger.info(`${tag} ${msg}`);
    },
    success(msg: string): void {
      logger.success(`${tag} ${msg}`);
    },
    warn(msg: string): void {
      logger.warn(`${tag} ${msg}`);
    },
    error(msg: string): void {
      logger.error(`${tag} ${msg}`);
    },
    schedule(msg: string): void {
      logger.schedule(`${tag} ${msg}`);
    },
    join(msg: string): void {
      logger.join(`${tag} ${msg}`);
    },
    divider(): void {
      logger.divider();
    },
  };
}