const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const SCHEMA_PATH = path.resolve(__dirname, '..', '..', 'database', 'schema.sql');

const IGNORABLE_PG_CODES = new Set([
  '42P04', // duplicate_database
  '42P07', // duplicate_table
  '42710', // duplicate_object
  '42501', // insufficient_privilege
  '42701', // duplicate_column
  '23505', // unique_violation
]);

function pgClient(database) {
  return new Client({
    host: config.db.host,
    port: config.db.port,
    database,
    user: config.db.user,
    password: config.db.password,
  });
}

async function ensureDatabaseExists() {
  const client = pgClient('postgres');
  try {
    await client.connect();
    const { rows } = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [config.db.name],
    );
    if (rows.length === 0) {
      const dbName = config.db.name.replace(/"/g, '""');
      const owner = config.db.user.replace(/"/g, '""');
      await client.query(`CREATE DATABASE "${dbName}" OWNER "${owner}"`);
      console.log(`[DB] Database "${config.db.name}" criada.`);
    }
    return true;
  } catch (err) {
    if (err.code === '42P04') return true;
    console.warn('[DB] Erro ao garantir database:', err.message);
    return false;
  } finally {
    await client.end();
  }
}

function parseStatements(sql) {
  const parts = sql.split(/;\s*\n/);
  const statements = [];
  let buffer = '';

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    buffer += (buffer ? ';\n' : '') + trimmed;
    const inDoBlock = buffer.includes('DO $$') && !buffer.trimEnd().endsWith('END $$');

    if (!inDoBlock) {
      const stmt = (buffer + ';').trim();
      if (stmt.length > 2) statements.push(stmt);
      buffer = '';
    }
  }

  if (buffer.trim()) statements.push((buffer + ';').trim());
  return statements;
}

async function runSchema(client) {
  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(`Schema não encontrado: ${SCHEMA_PATH}`);
  }

  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const statements = parseStatements(sql);

  for (let i = 0; i < statements.length; i++) {
    try {
      await client.query(statements[i]);
    } catch (err) {
      if (!IGNORABLE_PG_CODES.has(err.code)) {
        console.error(`[DB] Erro statement ${i + 1}/${statements.length}:`, err.message);
        throw err;
      }
    }
  }

  console.log(`[DB] ${statements.length} statements executados.`);
}

async function initDatabase() {
  try {
    await ensureDatabaseExists();

    const client = pgClient(config.db.name);
    await client.connect();
    await runSchema(client);
    await client.end();

    console.log('[DB] Schema inicializado.');
    return true;
  } catch (err) {
    console.error('[DB] Init falhou:', err.message);
    return false;
  }
}

module.exports = { initDatabase };
