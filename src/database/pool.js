const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[DB] Pool error:', err.message);
});

async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const ms = Date.now() - start;
  if (process.env.NODE_ENV === 'development' && ms > 100) {
    console.log('[DB] Slow query:', { text: text.substring(0, 80), ms });
  }
  return result;
}

async function getClient() {
  return pool.connect();
}

async function testConnection() {
  try {
    const { rows } = await query('SELECT NOW()');
    console.log('[DB] Conectado:', rows[0].now);
    return true;
  } catch (err) {
    console.error('[DB] Conexão falhou:', err.message);
    return false;
  }
}

module.exports = { pool, query, getClient, testConnection };
