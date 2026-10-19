/**
 * Bootstrap local: cria role/banco e aplica schema.
 * Superusuário: POSTGRES_PASSWORD ou PGPASSWORD (senha do usuário `postgres` na instalação).
 */
import pg from 'pg';
import { config } from '../src/config.js';
import { initDatabase } from '../src/database/init.js';
import { testConnection } from '../src/database/pool.js';

const { Client } = pg;

async function runBootstrapAsPostgres(appPassword: string): Promise<boolean> {
  const superPassword = process.env.POSTGRES_PASSWORD ?? process.env.PGPASSWORD;
  if (!superPassword) {
    console.error(
      '[DB] Defina POSTGRES_PASSWORD (senha do superusuário postgres) no .env ou no ambiente.',
    );
    return false;
  }

  const client = new Client({
    host: config.db.host,
    port: config.db.port,
    database: 'postgres',
    user: 'postgres',
    password: superPassword,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();

    const { rows: roleRows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'breakerbot_user') AS exists`,
    );
    const pwd = appPassword.replace(/'/g, "''");
    if (roleRows[0]?.exists) {
      await client.query(
        `ALTER ROLE breakerbot_user WITH LOGIN PASSWORD '${pwd}' CREATEDB`,
      );
    } else {
      await client.query(
        `CREATE ROLE breakerbot_user WITH LOGIN PASSWORD '${pwd}' CREATEDB`,
      );
    }

    const { rows: dbRows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'breakerbot_db') AS exists`,
    );
    if (!dbRows[0]?.exists) {
      await client.query(`CREATE DATABASE breakerbot_db OWNER breakerbot_user`);
    }

    await client.query(`GRANT ALL PRIVILEGES ON DATABASE breakerbot_db TO breakerbot_user`);

    console.log('[DB] Usuário e banco bootstrap aplicados.');
    return true;
  } catch (err) {
    console.error('[DB] Bootstrap como postgres falhou:', err instanceof Error ? err.message : err);
    return false;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const ok = await initDatabase();
  if (ok) {
    await testConnection();
    console.log('[DB] Já configurado e conectando com', config.db.user);
    return;
  }

  if (!config.db.password) {
    console.error('[DB] DB_PASSWORD vazio no .env.');
    process.exitCode = 1;
    return;
  }

  console.log('[DB] Tentando bootstrap com superusuário postgres...');
  const boot = await runBootstrapAsPostgres(config.db.password);
  if (!boot) {
    process.exitCode = 1;
    return;
  }

  const after = await initDatabase();
  if (!after) {
    process.exitCode = 1;
    return;
  }
  await testConnection();
  console.log('[DB] Setup local concluído.');
}

void main();
