const _stdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => {
  if (typeof chunk === 'string' && (chunk.includes('Closing session') || chunk.includes('_chains'))) return true;
  return _stdoutWrite(chunk, ...rest);
};

require('./lib/logger');
const { initDatabase } = require('./database/init');
const db = require('./database/pool');
const { connect } = require('./bot');

async function start() {
  const dbOk = await initDatabase();
  if (dbOk) {
    await db.testConnection();
  } else {
    console.warn('[DB] Init falhou — funcionalidades de banco podem não funcionar.');
  }

  await connect();
}

start();
