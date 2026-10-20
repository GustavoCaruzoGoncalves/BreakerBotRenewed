import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { config, projectPath } from '../src/config.js';
import { getErrorMessage, getPostgresErrorCode } from '../src/lib/errors.js';
import { parseStatements } from '../src/database/init.js';

const { Client } = pg;
const MIGRATIONS_DIR = projectPath('database', 'migrations');

async function main(): Promise<void> {
  const client = new Client({
    host: config.db.host,
    port: config.db.port,
    database: config.db.name,
    user: config.db.user,
    password: config.db.password,
  });

  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('[DB] Nenhuma pasta database/migrations.');
    await client.end();
    return;
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations WHERE filename = $1',
      [file],
    );
    if (rows.length > 0) {
      console.log(`[DB] Skip (já aplicada): ${file}`);
      continue;
    }

    const sqlPath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const statements = parseStatements(sql);

    console.log(`[DB] Aplicando ${file} (${statements.length} statements)...`);
    try {
      await client.query('BEGIN');
      for (const statement of statements) {
        if (!statement.trim()) continue;
        await client.query(statement);
      }
      await client.query(
        `INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`,
        [file],
      );
      await client.query('COMMIT');
      console.log(`[DB] OK: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[DB] Falha em ${file}:`, getErrorMessage(err), getPostgresErrorCode(err));
      process.exitCode = 1;
      break;
    }
  }

  await client.end();
}

void main();
