module.exports = {
  apps: [{
    name: 'brightlook-api',
    cwd: '/var/www/brightlook-crm/backend',
    script: 'src/server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    env_production: {
      NODE_ENV: 'production',
    },
  }],
};
