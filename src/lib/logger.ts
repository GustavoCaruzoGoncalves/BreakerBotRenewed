import fs from 'node:fs';
import path from 'node:path';
import { projectPath } from '../config.js';

const LOG_PATH = projectPath('data', 'logs', 'error.log');

function describe(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const maybe = error as { stack?: unknown; message?: unknown };
    if (typeof maybe.stack === 'string') return maybe.stack;
    if (typeof maybe.message === 'string') return maybe.message;
  }
  return String(error);
}

export function logError(error: unknown): void {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${describe(error)}\n`);
  } catch {
    // logging should never crash the app
  }
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  logError(err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  logError(reason);
});
