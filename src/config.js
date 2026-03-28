require('dotenv').config();

module.exports = {
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'breakerbot',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  },
  admins: (process.env.ADMINS || '')
    .split(',')
    .map(n => n.trim())
    .filter(Boolean)
    .map(n => `${n}@s.whatsapp.net`),
  baileys: {
    version: [2, 3000, 1033893291],
    browser: ['Windows', 'Google Chrome', '145.0.0'],
  },
};
