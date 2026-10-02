// The screenshot helper is a quality gate (CLAUDE.md, docs/UXUI_REDESIGN_DESIGN.md 21.2): it must fail hard, with a
// non-zero exit code and no image, when the server is down or answers an error, instead of photographing an error page.
// These cases stop before any browser starts, so they need no Edge/Chrome and run in CI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const script = join(repo, 'scripts', 'uxui-screens.mjs');

/** Async on purpose: the in-process test server must keep answering while the helper runs. */
function run(
  name: string,
  url: string,
  extra: string[] = [],
): Promise<{ status: number | null; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [script, name, url, '--widths', '360', ...extra], {
      cwd: repo,
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('close', (status) => done({ status, stderr }));
  });
}

const image = (name: string) => join(repo, '.local', 'uxui-screens', `${name}-360-light.png`);

test('an unreachable server fails the gate (exit 3) and writes no image', async () => {
  const closed = createServer();
  await new Promise<void>((done) => closed.listen(0, '127.0.0.1', done));
  const { port } = closed.address() as AddressInfo;
  await new Promise((done) => closed.close(done));
  const result = await run('gate-test-down', `http://127.0.0.1:${port}/`);
  assert.equal(result.status, 3);
  assert.match(result.stderr, /unreachable/);
  assert.equal(existsSync(image('gate-test-down')), false);
});

test('an HTTP error page fails the gate (exit 3) and writes no image', async () => {
  const server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end('<html><body>not found</body></html>');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  try {
    const result = await run('gate-test-404', `http://127.0.0.1:${port}/`);
    assert.equal(result.status, 3);
    assert.match(result.stderr, /HTTP 404/);
    assert.equal(existsSync(image('gate-test-404')), false);
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(image('gate-test-404'), { force: true });
  }
});

test('the helper documents the gate and CLAUDE.md forbids unopened screenshots', () => {
  const source = readFileSync(script, 'utf8');
  assert.match(source, /EXIT_FAILED_GATE = 3/);
  assert.match(source, /BROWSER ERROR PAGE/);
  assert.match(source, /EMPTY PAGE/);
  assert.match(
    readFileSync(join(repo, 'CLAUDE.md'), 'utf8'),
    /Never report screenshots without opening each one/,
  );
});
