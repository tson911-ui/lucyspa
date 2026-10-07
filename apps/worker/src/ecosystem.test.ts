import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// The production process list (`ecosystem.config.cjs`, Phase 6 P6-7). The worker must stay exactly ONE process: its schedulers
// (21:30 jobs, inventory alerts, the 08:00 expiry scan) and queue consumers would run twice, and the API stays single in Wave 1
// (Owner decision OQ-26). Only the web renders pages without payment logic or a database connection, so only it may be clustered.
interface PmApp {
  name: string;
  exec_mode: string;
  instances: number;
  script: string;
  args?: string;
  max_memory_restart?: string;
}
const load = (environment: Record<string, string | undefined> = {}): PmApp[] => {
  const keys = ['WEB_INSTANCES', 'WEB_PORT', 'WEB_MAX_MEMORY', 'LUCYSPA_ROOT'];
  const saved = keys.map((key) => [key, process.env[key]] as const);
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, environment);
    const path = '../../../ecosystem.config.cjs';
    const require = createRequire(import.meta.url);
    delete require.cache[require.resolve(path)];
    return (require(path) as { apps: PmApp[] }).apps;
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};
const named = (apps: PmApp[], name: string): PmApp => {
  const app = apps.find((candidate) => candidate.name === name);
  assert.ok(app, name);
  return app;
};

test('the worker and the API are single fork processes, whatever the environment says', () => {
  for (const environment of [{}, { WEB_INSTANCES: '6' }, { WEB_INSTANCES: '0' }]) {
    const apps = load(environment);
    for (const name of ['lucyspa-worker', 'lucyspa-api']) {
      const app = named(apps, name);
      assert.equal(app.exec_mode, 'fork', name);
      assert.equal(app.instances, 1, name);
    }
  }
});

test('the web is the only clustered process: 3 by default, a bad number falls back, the port is configurable', () => {
  const web = named(load(), 'lucyspa-web');
  assert.equal(web.exec_mode, 'cluster');
  assert.equal(web.instances, 3);
  assert.match(web.args ?? '', /^start --hostname 127\.0\.0\.1 --port 3000$/);
  assert.equal(named(load({ WEB_INSTANCES: '4', WEB_PORT: '3100' }), 'lucyspa-web').instances, 4);
  assert.match(named(load({ WEB_PORT: '3100' }), 'lucyspa-web').args ?? '', /--port 3100$/);
  for (const bad of ['0', '-2', 'abc', '']) {
    assert.equal(named(load({ WEB_INSTANCES: bad }), 'lucyspa-web').instances, 3, bad);
  }
  assert.deepEqual(
    load().map((app) => app.name),
    ['lucyspa-web', 'lucyspa-api', 'lucyspa-worker'],
  );
});

test('every process has a memory ceiling (the server has no swap)', () => {
  for (const app of load()) assert.match(app.max_memory_restart ?? '', /^\d+M$/, app.name);
});
