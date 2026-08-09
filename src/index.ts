import './lib/stdoutFilter.js';
import './lib/logger.js';
import { initDatabase } from './database/init.js';
import * as db from './database/pool.js';
import { connect } from './bot.js';

async function start(): Promise<void> {
  const dbOk = await initDatabase();
  if (dbOk) {
    await db.testConnection();
  } else {
    console.warn('[DB] Init falhou — funcionalidades de banco podem não funcionar.');
  }

  await connect();
}

void start();
