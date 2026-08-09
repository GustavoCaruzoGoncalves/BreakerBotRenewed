import pg from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config, isDevelopment } from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err: Error) => {
  console.error('[DB] Pool error:', err.message);
});

/**
 * O driver `pg` serializa qualquer valor JS para o tipo da coluna, então os
 * parâmetros são `unknown` — a garantia de tipo fica no SQL e nas interfaces `*Row`.
 */
export type QueryParams = readonly unknown[];

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: QueryParams,
): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await pool.query<T>(text, params as unknown[] | undefined);
  const ms = Date.now() - start;
  if (isDevelopment() && ms > 100) {
    console.log('[DB] Slow query:', { text: text.substring(0, 80), ms });
  }
  return result;
}

export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

export async function testConnection(): Promise<boolean> {
  try {
    const { rows } = await query<{ now: Date }>('SELECT NOW()');
    console.log('[DB] Conectado:', rows[0]?.now);
    return true;
  } catch (err) {
    console.error('[DB] Conexão falhou:', err instanceof Error ? err.message : err);
    return false;
  }
}
