/**
 * VisualCore Logger Adapter
 *
 * Provides a logger compatible with the VisualCore module interface.
 * Uses pino (via Fastify) when available, falls back to console.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
  const prefix = {
    debug: '[VisualCore:DEBUG]',
    info: '[VisualCore:INFO]',
    warn: '[VisualCore:WARN]',
    error: '[VisualCore:ERROR]',
  }[level];

  const dataStr = data ? ` ${JSON.stringify(data)}` : '';

  switch (level) {
    case 'debug':
      console.debug(`${prefix} ${msg}${dataStr}`);
      break;
    case 'info':
      console.info(`${prefix} ${msg}${dataStr}`);
      break;
    case 'warn':
      console.warn(`${prefix} ${msg}${dataStr}`);
      break;
    case 'error':
      console.error(`${prefix} ${msg}${dataStr}`);
      break;
  }
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => log('debug', msg, data),
  info: (msg: string, data?: Record<string, unknown>) => log('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log('error', msg, data),
};
