// pm2 process definitions for the production server (Phase 6 P6-7). Server: 6 cores, 7.8 GB RAM, no swap.
//
//   lucyspa-web     CLUSTER, `WEB_INSTANCES` processes (default 3). The website only renders pages and proxies /api; it holds
//                   no payment logic and no database connection, so several copies are safe.
//   lucyspa-api     ONE process (fork). It also serves the POS, the PayOS webhook and re-authentication (Owner decision OQ-26:
//                   the API stays single in Wave 1).
//   lucyspa-worker  EXACTLY ONE process (fork). The schedulers (21:30 jobs, inventory alerts, 08:00 expiry scan) and the BullMQ
//                   consumers would run twice with two copies. `ecosystem.config.test.ts` fails if this is ever changed.
//
// Normal use on the server is only:  pm2 start ecosystem.config.cjs --only lucyspa-web   (see docs/PHASE6_WAVE1_DEPLOY_CHECKLIST.md)
// The api and worker entries mirror how they already run and are kept here so that the singleton rule is written down and tested.
//
// Environment (all optional):
//   LUCYSPA_ROOT   the checkout (default: the folder of this file, `/opt/lucyspa` on the server)
//   WEB_INSTANCES  number of web processes (default 3)
//   WEB_PORT       the port nginx forwards to (default 3000)
//   WEB_MAX_MEMORY a web process is restarted by pm2 above this size (default 700M; one process settles at 400-470 MB under load)
const root = process.env.LUCYSPA_ROOT || __dirname;
const nodeEnvFiles = [
  '--env-file-if-exists=../../.env',
  '--env-file-if-exists=../../.env.auth.local',
];
const instances = Number.parseInt(process.env.WEB_INSTANCES || '3', 10);

module.exports = {
  apps: [
    {
      name: 'lucyspa-web',
      cwd: `${root}/apps/web`,
      script: 'node_modules/next/dist/bin/next',
      args: `start --hostname 127.0.0.1 --port ${process.env.WEB_PORT || '3000'}`,
      exec_mode: 'cluster',
      instances: Number.isInteger(instances) && instances >= 1 ? instances : 3,
      // No swap on the server: a process that grows past this is restarted by pm2 instead of being killed by the kernel
      // together with whatever else it takes down. One instance restarts at a time, the others keep answering.
      max_memory_restart: process.env.WEB_MAX_MEMORY || '700M',
      kill_timeout: 8000,
      listen_timeout: 20000,
      exp_backoff_restart_delay: 200,
      max_restarts: 20,
      env: { NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
    },
    {
      name: 'lucyspa-api',
      cwd: `${root}/apps/api`,
      script: 'dist/main.js',
      node_args: nodeEnvFiles,
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '700M',
      kill_timeout: 8000,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'lucyspa-worker',
      cwd: `${root}/apps/worker`,
      script: 'dist/main.js',
      node_args: nodeEnvFiles,
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '500M',
      kill_timeout: 8000,
      env: { NODE_ENV: 'production' },
    },
  ],
};
