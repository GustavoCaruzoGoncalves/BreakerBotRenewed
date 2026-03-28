const fs = require('fs');
const path = require('path');

const LOG_PATH = path.resolve(__dirname, '..', '..', 'data', 'logs', 'error.log');

function logError(error) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    const line = `[${new Date().toISOString()}] ${error?.stack || error?.message || error}\n`;
    fs.appendFileSync(LOG_PATH, line);
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

module.exports = { logError };
