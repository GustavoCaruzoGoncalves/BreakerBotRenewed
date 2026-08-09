/** @type {{ apps: import('pm2').StartOptions[] }} */
module.exports = {
  apps: [
    {
      name: 'BreakerBot',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/pm2-bot-error.log',
      out_file: './logs/pm2-bot-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      kill_timeout: 10000,
    },
    {
      name: 'BreakerBotAPI',
      script: 'dist/api/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/pm2-api-error.log',
      out_file: './logs/pm2-api-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      kill_timeout: 10000,
    },
  ],
};
