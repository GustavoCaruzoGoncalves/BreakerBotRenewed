import { initDatabase } from '../src/database/init.js';
import { testConnection } from '../src/database/pool.js';

async function main(): Promise<void> {
  const ok = await initDatabase();
  if (!ok) {
    process.exitCode = 1;
    return;
  }
  await testConnection();
  console.log('[DB] Conexão OK.');
}

void main();
