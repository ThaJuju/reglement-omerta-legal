module.exports = {
  apps: [{
    name: 'omerta-legal',
    script: '/var/www/omerta-legal/server.js',
    cwd: '/var/www/omerta-legal',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    max_memory_restart: '128M',
    env: {
      NODE_ENV: 'production',
      PORT: 3007,
      HOST: '0.0.0.0',
    },
  }],
};
