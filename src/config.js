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
  aura: {
    enabled: ['1', 'true', 'yes', 'on', 'sim'].includes(
      (process.env.AURA_ENABLED || '').trim().toLowerCase(),
    ),
  },
  baileys: {
    // Fallback se fetchLatestBaileysVersion falhar; o bot.js busca a versão atual em runtime.
    version: [2, 3000, 1035194821],
    browser: ['Mac OS', 'Safari', '18.0'],
  },
};
