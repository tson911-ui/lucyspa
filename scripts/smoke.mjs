import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = [];

async function availablePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function start(name, args, cwd, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const state = { name, child, output: '', error: undefined };
  child.on('error', (error) => {
    state.error = error;
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      state.output = (state.output + chunk.toString()).slice(-12000);
    });
  }
  children.push(state);
  return state;
}

async function waitFor(state, check) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (state.error || state.child.exitCode !== null)
      throw new Error(`${state.name} exited before ready`);
    try {
      if (await check()) return;
    } catch {
      /* Retry only within the startup deadline. */
    }
    await delay(250);
  }
  throw new Error(`${state.name} startup timed out`);
}

async function completed(state) {
  let timer;
  try {
    const [code] = await Promise.race([
      once(state.child, 'exit'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${state.name} timed out`)), 45000);
      }),
    ]);
    assert.equal(code, 0, `${state.name} failed`);
  } finally {
    clearTimeout(timer);
  }
}

async function get(url) {
  return fetch(url, { signal: AbortSignal.timeout(4000) });
}

try {
  const apiPort = await availablePort();
  const webPort = await availablePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  const api = start(
    'API',
    ['--env-file-if-exists=../../.env', 'dist/main.js'],
    new URL('../apps/api/', import.meta.url),
    {
      NODE_ENV: 'production',
      API_HOST: '127.0.0.1',
      API_PORT: String(apiPort),
      WEB_ORIGIN: webUrl,
      SWAGGER_ENABLED: 'true',
    },
  );
  const worker = start(
    'worker',
    ['--env-file-if-exists=../../.env', 'dist/main.js'],
    new URL('../apps/worker/', import.meta.url),
  );
  const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
  const web = start(
    'web',
    [
      requireWeb.resolve('next/dist/bin/next'),
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(webPort),
    ],
    new URL('../apps/web/', import.meta.url),
    { NODE_ENV: 'production' },
  );
  await Promise.all([
    waitFor(api, async () => (await get(`${apiUrl}/health/ready`)).status === 200),
    waitFor(web, async () => (await get(`${webUrl}/health`)).status === 200),
    waitFor(worker, () => worker.output.includes('Worker ready')),
  ]);
  assert.deepEqual(await (await get(`${apiUrl}/health/ready`)).json(), {
    status: 'ok',
    service: 'api',
    checks: { database: 'up', redis: 'up' },
  });
  assert.deepEqual(await (await get(`${apiUrl}/health/live`)).json(), {
    status: 'ok',
    service: 'api',
  });
  const openapi = await (await get(`${apiUrl}/openapi.json`)).json();
  assert.deepEqual(Object.keys(openapi.paths).sort(), ['/health/live', '/health/ready']);
  const missing = await get(`${apiUrl}/unknown?token=never-echo-this`);
  assert.equal(missing.status, 404);
  assert.doesNotMatch(await missing.text(), /never-echo-this/);
  await completed(
    start('web HTTP smoke', ['scripts/smoke-web.mjs'], root, { WEB_SMOKE_URL: webUrl }),
  );
  await completed(
    start(
      'worker round trip',
      ['--env-file-if-exists=../../.env', 'dist/smoke.js'],
      new URL('../apps/worker/', import.meta.url),
    ),
  );
  console.log(
    'Production startup smoke passed: localized web, API/DB/Redis readiness, OpenAPI, BullMQ round trip.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Startup smoke failed');
  for (const state of children) console.error(`${state.name}:\n${state.output}`);
  process.exitCode = 1;
} finally {
  await Promise.all(
    children.map(async ({ child }) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}
