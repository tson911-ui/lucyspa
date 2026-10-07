// Real-app DOM audit capture (docs/UXUI_REDESIGN_DESIGN.md 21.5). Signs in to the running API as the audit Owner, renders the pages
// of scripts/uxui-audit-pages.json at 1440, 768 and 360 px (light) with scripts/uxui-screens.mjs, evaluates scripts/uxui-page-audit.js in
// each render and writes one results file per page for scripts/uxui-audit-summary.mjs.
//
//   node scripts/uxui-audit-capture.mjs --baseline                 the 26 pages of docs/uxui-audit-baseline.json
//   node scripts/uxui-audit-capture.mjs products inventory         named pages of the manifest
//   node scripts/uxui-audit-capture.mjs --all                      every page of the manifest
//   node scripts/uxui-audit-capture.mjs name=path/with/{employee}  a one-off page
//   options: --out <dir>   results directory (default .local/uxui-audit/results; cleared of the pages it writes)
//            --web <url>   web origin (default http://localhost:3100)   --api <url>   API origin (default http://127.0.0.1:3101)
//
// Credentials are NOT in the repository: `.local/uxui-audit/creds.json` ({ "email", "password" }) or AUDIT_EMAIL / AUDIT_PASSWORD. Run
// it only against a scratch database (`lucy_spa_uxaudit_20261001`, never the dev database; migrate it and sync the permissions
// first, build and start the API on 3101 and the web on 3100 against it). Compare with:
//   node scripts/uxui-audit-summary.mjs --compare docs/uxui-audit-baseline.json
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args.splice(index, 2)[1] : fallback;
};
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
};
const web = option('web', 'http://localhost:3100').replace(/\/$/, '');
const api = option('api', 'http://127.0.0.1:3101').replace(/\/$/, '');
const outDir = resolve(option('out', '.local/uxui-audit/results'));
const everything = flag('all');
const baselineOnly = flag('baseline');
const locale = 'vi';

const manifest = JSON.parse(readFileSync(resolve('scripts/uxui-audit-pages.json'), 'utf8')).pages;
const auditSource = readFileSync(resolve('scripts/uxui-page-audit.js'), 'utf8');

const selected = [];
if (everything) selected.push(...Object.keys(manifest));
else if (baselineOnly)
  selected.push(...Object.keys(manifest).filter((name) => manifest[name].baseline));
for (const entry of args) {
  if (entry.includes('=')) {
    const [name, ...rest] = entry.split('=');
    manifest[name] = { path: rest.join('=') };
    selected.push(name);
  } else if (manifest[entry]) selected.push(entry);
  else {
    console.error(`unknown page ${entry}; see scripts/uxui-audit-pages.json`);
    process.exit(2);
  }
}
if (selected.length === 0) {
  console.error('no pages: name some, or use --baseline or --all');
  process.exit(2);
}

function credentials() {
  if (process.env.AUDIT_EMAIL && process.env.AUDIT_PASSWORD) {
    return { email: process.env.AUDIT_EMAIL, password: process.env.AUDIT_PASSWORD };
  }
  const file = resolve('.local/uxui-audit/creds.json');
  if (!existsSync(file)) {
    console.error(
      'no credentials: create .local/uxui-audit/creds.json or set AUDIT_EMAIL and AUDIT_PASSWORD',
    );
    process.exit(2);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** A tiny API client: cookie jar, CSRF token, JSON. */
async function signIn() {
  const { email, password } = credentials();
  const jar = {};
  let csrf = '';
  const call = async (method, path, body) => {
    const response = await fetch(`${api}${path}`, {
      method,
      headers: {
        Origin: web,
        Cookie: Object.entries(jar)
          .map(([k, v]) => `${k}=${v}`)
          .join('; '),
        'X-CSRF-Token': csrf,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      jar[pair.slice(0, at)] = pair.slice(at + 1);
    }
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: response.status, body: json };
  };
  const refresh = async () => {
    csrf = (await call('GET', '/api/v1/auth/context')).body.csrfToken;
  };
  await refresh();
  const result = await call('POST', '/api/v1/auth/login', {
    realm: 'WORKFORCE',
    identifierType: 'EMAIL',
    identifier: email,
    password,
  });
  if (result.status !== 200) {
    console.error(`sign-in failed (${result.status}): is the stack up on the audit database?`);
    process.exit(2);
  }
  await refresh();
  return { call, cookies: () => ({ ...jar }) };
}

const LISTS = {
  employee: '/api/v1/employees',
  branch: '/api/v1/branches',
  service: '/api/v1/services',
  team: '/api/v1/teams',
  discount: '/api/v1/discounts',
  product: '/api/v1/products',
  import: '/api/v1/product-imports',
};
const firstId = (body) => {
  const list = Array.isArray(body)
    ? body
    : Object.values(body ?? {}).find((value) => Array.isArray(value));
  return list?.[0]?.id ?? null;
};

const session = await signIn();
const resolved = {};
async function fill(path) {
  let out = path;
  for (const match of path.matchAll(/\{(\w+)\}/g)) {
    const key = match[1];
    if (!(key in LISTS)) throw new Error(`unknown placeholder {${key}}`);
    if (!(key in resolved)) {
      const { status, body } = await session.call('GET', LISTS[key]);
      resolved[key] = status === 200 ? firstId(body) : null;
    }
    if (!resolved[key]) throw new Error(`no ${key} to open for ${path}`);
    out = out.replace(match[0], resolved[key]);
  }
  return out;
}

mkdirSync(outDir, { recursive: true });
const cookieArgs = Object.entries(session.cookies()).flatMap(([k, v]) => ['--cookie', `${k}=${v}`]);
let failed = 0;
for (const name of selected) {
  const page = manifest[name];
  let path;
  try {
    path = await fill(page.path);
  } catch (error) {
    console.log(`SKIP  ${name}: ${error.message}`);
    failed += 1;
    continue;
  }
  const url = `${web}/${locale}/workforce${path ? `/${path}` : ''}`;
  const result = spawnSync(
    process.execPath,
    [
      'scripts/uxui-screens.mjs',
      `audit-${name}`,
      url,
      '--theme-cookie',
      ...(page.public ? [] : cookieArgs),
      '--eval',
      auditSource,
    ],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  );
  const runs = {};
  for (const line of result.stdout.split('\n')) {
    const found = /^eval audit-\S+ (\d+) (light|dark): (.*)$/.exec(line);
    if (found && found[2] === 'light') runs[`${found[1]}-light`] = JSON.parse(found[3]);
  }
  if (Object.keys(runs).length === 0) {
    console.log(
      `FAIL  ${name}: no render (${(result.stdout + result.stderr).split('\n').find((l) => /FAIL|UNREACH|ERROR/i.test(l)) ?? 'unknown'})`,
    );
    failed += 1;
    continue;
  }
  writeFileSync(resolve(outDir, `${name}.json`), `${JSON.stringify({ name, url, runs })}\n`);
  const total = Object.values(runs).reduce((sum, audit) => sum + (audit?.findings?.length ?? 0), 0);
  console.log(`ok    ${name.padEnd(24)} ${Object.keys(runs).join(' ')}  findings ${total}`);
}
console.log(failed ? `${failed} page(s) not captured` : 'all pages captured');
process.exit(failed ? 1 : 0);
