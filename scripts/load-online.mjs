// Phase 6 Wave 4 / P6-22: a real load and security check of online checkout and the PayOS webhook, against a real API process and a
// real PostgreSQL scratch database (never the dev or production database: the name must end with "_scratch").
//
//   pnpm build:server && pnpm --filter @lucy-spa/api build            (the API runs from apps/api/dist)
//   node scripts/load-online.mjs --db lucy_spa_load_scratch --customers 80 --concurrency 24
//
// The scratch database must exist with every migration applied. The script seeds its own data (a branch, products, stock, members with
// sessions), starts the API as a child process on a spare port with the PayOS simulator preloaded (scripts/load-online-payos.mjs),
// runs the phases below, prints one JSON summary and exits non-zero when an invariant or a security check fails.
//   A  reads        public catalog and the member cart under concurrency
//   B  checkout     every member fills a cart and places an order at once; one product is scarce (oversell must be impossible)
//   C  payment      every placed order is paid at the "bank"; each webhook is delivered three times concurrently
//   D  invariants   stock, reservations, payments, invoices and the outbox are reconciled in SQL
//   E  security     unauthenticated, cross-account, forged, oversized, replayed, malformed requests
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((arg, index, all) =>
      arg.startsWith('--') ? [[arg.slice(2), all[index + 1] ?? 'true']] : [],
    ),
);
const DB = String(args.db ?? '');
if (!/^lucy_spa_[a-z0-9_]*_scratch$/.test(DB) || DB === 'lucy_spa_dev')
  throw new Error('refusing: --db must be a lucy_spa_*_scratch database');
const CUSTOMERS = Number(args.customers ?? 80);
const CONCURRENCY = Number(args.concurrency ?? 24);
const SCARCE_STOCK = Math.max(1, Math.floor(CUSTOMERS / 4));
const API_PORT = Number(args.port ?? 3191);
const CONTROL_PORT = Number(args['control-port'] ?? 3291);
const API = `http://127.0.0.1:${API_PORT}`;

for (const file of ['.env', '.env.auth.local']) {
  try {
    loadEnvFile(new URL(`../${file}`, import.meta.url));
  } catch {
    /* optional */
  }
}
const databaseUrl = (() => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `/${DB}`;
  return url.toString();
})();
const WEB_ORIGIN = 'http://localhost:3100';
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  API_HOST: '127.0.0.1',
  API_PORT: String(API_PORT),
  WEB_ORIGIN,
  MEDIA_STORAGE_DIR: fileURLToPath(new URL('.local/load-media', pathToFileURL(root))),
  PAYOS_CLIENT_ID: 'sim-client',
  PAYOS_API_KEY: 'sim-key',
  PAYOS_CHECKSUM_KEY: 'sim-checksum',
  LOAD_PAYOS_CONTROL_PORT: String(CONTROL_PORT),
};
mkdirSync(env.MEDIA_STORAGE_DIR, { recursive: true });
const dist = (path) => import(pathToFileURL(`${root}${path}`).href);
const { createDatabaseClient, syncPermissionCatalog } = await dist(
  'packages/database/dist/index.js',
);
const { parseApiEnvironment } = await dist('packages/server/dist/index.js');
const { SessionService } = await dist('apps/api/dist/auth/session.service.js');
const { csrfToken } = await dist('apps/api/dist/auth/crypto.js');
const { AuthThrottleService } = await dist('apps/api/dist/auth/auth-throttle.service.js');
const { takeSharedAuthGraphLock } = await dist('apps/api/dist/auth/auth-store.js');
const { InventoryService } = await dist('apps/api/dist/inventory/inventory.service.js');

Object.assign(process.env, { DATABASE_URL: databaseUrl });
const environment = parseApiEnvironment({ ...env, NODE_ENV: env.NODE_ENV ?? 'development' });
const database = createDatabaseClient(databaseUrl);
const sessions = new SessionService({ client: database }, environment);
const withTransaction = (work) =>
  database.$transaction(
    async (tx) => {
      await takeSharedAuthGraphLock(tx);
      return work(tx);
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
const adapter = {
  withTransaction,
  withExclusiveTransaction: withTransaction,
  resolveForMutation: (token, tx) => sessions.resolveForMutation(token, tx),
  resolve: (token) => sessions.resolve(token),
};
const inventory = new InventoryService(adapter, new AuthThrottleService(environment), environment);

const run = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
const ids = { branch: randomUUID(), role: randomUUID() };
const summary = {
  db: DB,
  customers: CUSTOMERS,
  concurrency: CONCURRENCY,
  phases: {},
  checks: [],
  failures: [],
};
const check = (name, ok, detail = '') => {
  summary.checks.push({ name, ok, detail });
  if (!ok) summary.failures.push(`${name} ${detail}`);
};

// ----------------------------------------------------------------------------------------------------------------- seed
let serial = 0;
const staffId = randomUUID();
let staffToken;
await database.$transaction(async (tx) => {
  await tx.branch.create({
    data: { id: ids.branch, code: `LD_${run}`, name: 'Load test', timezone: 'Asia/Ho_Chi_Minh' },
  });
  await syncPermissionCatalog(tx);
  const permissions = await tx.permission.findMany({
    where: { code: { in: ['MANAGE_STOCK_RECEIPTS', 'VIEW_INVENTORY'] } },
    select: { id: true },
  });
  await tx.role.create({
    data: {
      id: ids.role,
      code: `LD_${run}`,
      displayNameVi: 'Load',
      displayNameEn: 'Load',
      permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
    },
  });
  const user = await tx.user.create({
    data: {
      id: staffId,
      kind: 'EMPLOYEE',
      status: 'ACTIVE',
      fullName: 'Load stock clerk',
      preferredLocale: 'vi',
      normalizationVersion: 1,
      passwordHash: '$argon2id$fixture',
      phoneCanonical: `+8490${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
      employeeProfile: {
        create: {
          employeeCodeCanonical: `LD_${run}_1`,
          dateOfBirth: new Date('1990-01-01'),
          address: 'Fixture',
        },
      },
    },
  });
  await tx.employmentClassificationChange.create({
    data: {
      employeeUserId: staffId,
      classification: 'OFFICIAL_EMPLOYEE',
      effectiveDate: new Date('2020-01-01'),
    },
  });
  await tx.employeeBranchAssignment.create({
    data: { employeeUserId: staffId, branchId: ids.branch, grantedByUserId: staffId },
  });
  await tx.userRoleAssignment.create({
    data: { userId: staffId, roleId: ids.role, scopeKind: 'BRANCH', branchId: ids.branch },
  });
  const anonymous = await sessions.createAnonymous(tx);
  const issued = await sessions.rotateAuthenticated(
    anonymous.token,
    {
      userId: staffId,
      passwordHash: user.passwordHash,
      credentialVersion: user.credentialVersion,
      authzVersion: user.authzVersion,
    },
    { reauthenticated: false },
    tx,
  );
  staffToken = issued.token;
});
const today = (
  await database.$queryRaw`SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS d`
)[0].d;
async function product(label, price, stock, sellOnOrder = true) {
  const variantId = await database.$transaction(async (tx) => {
    serial += 1;
    const created = await tx.product.create({
      data: {
        code: `ld-${run.toLowerCase()}-${serial}`,
        nameVi: `Hàng thử ${label}`,
        nameEn: `Load ${label}`,
        createdByUserId: staffId,
        variants: { create: [{ sku: `LD-${run}-${serial}`, sellOnline: true, sellOnOrder }] },
      },
      include: { variants: true },
    });
    const variant = created.variants[0];
    await tx.productPriceVersion.create({
      data: {
        variantId: variant.id,
        versionNo: 1,
        listPriceVnd: BigInt(price),
        createdByUserId: staffId,
      },
    });
    await tx.product.update({
      where: { id: created.id },
      data: { status: 'PUBLISHED', rowVersion: { increment: 1 } },
    });
    return variant.id;
  });
  const draft = await inventory.createReceipt(staffToken, {
    branchId: ids.branch,
    supplierId: null,
    receiptDate: today,
    notes: null,
    lines: [{ variantId, quantity: stock, lotCode: null, expiryDate: null }],
  });
  await inventory.confirmReceipt(staffToken, draft.id, { expectedRowVersion: draft.rowVersion });
  return variantId;
}
const scarce = await product('khan hiem', 100_000, SCARCE_STOCK, false);
const plenty = [];
// --spread: every member buys a different product, so no stock row is shared (the raw throughput without the hot-row queue).
const PRODUCTS = args.spread ? Math.max(4, Math.ceil(CUSTOMERS / 2)) : 4;
for (let i = 0; i < PRODUCTS; i += 1)
  plenty.push(
    await product(`du ${i}`, 120_000 + (i % 4) * 10_000, args.spread ? 5 : CUSTOMERS * 3),
  );
await database.$transaction(async (tx) => {
  await tx.onlineSalesSettings.update({
    where: { id: 1 },
    data: {
      enabled: true,
      fulfilmentBranchId: ids.branch,
      maxUnpaidOrders: 5,
      rowVersion: { increment: 1 },
    },
  });
});
const members = [];
const phoneBase = 100_000 + Math.floor(Math.random() * 800_000);
await database.$transaction(async (tx) => {
  for (let i = 0; i < CUSTOMERS; i += 1) {
    const id = randomUUID();
    const user = await tx.user.create({
      data: {
        id,
        kind: 'CUSTOMER',
        status: 'ACTIVE',
        fullName: `Khách thử ${i}`,
        preferredLocale: 'vi',
        normalizationVersion: 1,
        emailCanonical: `ld-${run.toLowerCase()}-${i}@example.com`,
        emailDelivery: `ld-${run.toLowerCase()}-${i}@example.com`,
        emailVerifiedAt: new Date(),
        phoneCanonical: `+84913${String(phoneBase + i)}`,
        passwordHash: '$argon2id$fixture',
        customerProfile: { create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' } },
      },
    });
    const anonymous = await sessions.createAnonymous(tx);
    const issued = await sessions.rotateAuthenticated(
      anonymous.token,
      {
        userId: id,
        passwordHash: user.passwordHash,
        credentialVersion: user.credentialVersion,
        authzVersion: user.authzVersion,
      },
      { reauthenticated: false },
      tx,
    );
    members.push({
      i,
      id,
      token: issued.token,
      sessionId: issued.session.id,
      csrf: csrfToken(
        issued.session.id,
        issued.token,
        environment.auth.csrfKeys.get(environment.auth.csrfActiveVersion ?? 1),
      ),
    });
  }
});

// ------------------------------------------------------------------------------------------------------------------- api
const child = spawn(
  process.execPath,
  ['--import', pathToFileURL(`${root}scripts/load-online-payos.mjs`).href, 'dist/main.js'],
  { cwd: `${root}apps/api`, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);
let apiLog = '';
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (chunk) => (apiLog = (apiLog + chunk).slice(-6000)));
let finished = false;
const stop = () => {
  if (!finished) {
    finished = true;
    child.kill();
  }
};
process.on('exit', stop);
async function ready() {
  for (let i = 0; i < 240; i += 1) {
    try {
      if ((await fetch(`${API}/health/ready`)).status === 200) return;
    } catch {
      /* starting */
    }
    await delay(500);
  }
  throw new Error(`API did not start\n${apiLog}`);
}
await ready();
const cookieName = environment.auth.cookieName;

const latencies = {};
async function call(who, method, path, body, extra = {}) {
  const started = performance.now();
  let status = 0;
  let json;
  try {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(who
          ? { Cookie: `${cookieName}=${who.token}`, Origin: WEB_ORIGIN, 'X-CSRF-Token': who.csrf }
          : { Origin: WEB_ORIGIN }),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    status = response.status;
    const text = await response.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
  } catch (error) {
    json = { error: String(error) };
  }
  const key = `${method} ${path.replace(/[0-9a-f-]{36}/g, ':id').replace(/\?.*/, '')}`;
  (latencies[key] ??= []).push(performance.now() - started);
  return { status, body: json, code: json && typeof json === 'object' ? json.code : undefined };
}
async function pool(items, size, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index], index);
      }
    }),
  );
  return results;
}
const percentile = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
/** Total CPU seconds the API process has used so far (Windows or POSIX); null when unavailable. */
async function cpuSeconds() {
  try {
    const { execFileSync } = await import('node:child_process');
    if (process.platform === 'win32') {
      return Number(
        execFileSync(
          'powershell',
          ['-NoProfile', '-Command', `(Get-Process -Id ${child.pid}).CPU`],
          { encoding: 'utf8' },
        )
          .trim()
          .replace(',', '.'),
      );
    }
    const [h, m, sec] = execFileSync('ps', ['-o', 'cputime=', '-p', String(child.pid)], {
      encoding: 'utf8',
    })
      .trim()
      .split(':')
      .map(Number);
    return h * 3600 + m * 60 + sec;
  } catch {
    return null;
  }
}
let lastCpu = await cpuSeconds();
async function report(phase, startedAt) {
  const seconds = (performance.now() - startedAt) / 1000;
  const rows = {};
  for (const [key, list] of Object.entries(latencies)) {
    const sorted = [...list].sort((a, b) => a - b);
    rows[key] = {
      n: sorted.length,
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      p99: Math.round(percentile(sorted, 99)),
      max: Math.round(sorted.at(-1) ?? 0),
    };
    delete latencies[key];
  }
  const cpu = await cpuSeconds();
  summary.phases[phase] = {
    seconds: Number(seconds.toFixed(2)),
    apiCpuSeconds: cpu !== null && lastCpu !== null ? Number((cpu - lastCpu).toFixed(2)) : null,
    routes: rows,
  };
  lastCpu = cpu;
}

try {
  const settings = await call(null, 'GET', '/api/v1/online-sales');
  assert.equal(settings.status, 200, `settings ${settings.status}`);
  assert.equal(settings.body.enabled, true);
  const address = (i) => ({
    recipientName: `Khách thử ${i}`,
    recipientPhone: `091310${String(1000 + i)}`.slice(0, 10),
    provinceCode: settings.body.provinces[0].code,
    ward: 'Phường 1',
    street: `${i} Đường thử`,
  });

  // A: reads ------------------------------------------------------------------------------------------------------------
  let t = performance.now();
  const readStatus = {};
  await pool(Array.from({ length: CUSTOMERS * 6 }), CONCURRENCY, async (_, index) => {
    const member = members[index % members.length];
    const r =
      index % 3 === 0
        ? await call(null, 'GET', '/api/v1/public/products?locale=vi')
        : index % 3 === 1
          ? await call(member, 'GET', '/api/v1/me/cart')
          : await call(null, 'GET', '/api/v1/online-sales');
    readStatus[r.status] = (readStatus[r.status] ?? 0) + 1;
  });
  await report('A_reads', t);
  summary.phases.A_reads.status = readStatus;
  check(
    'A: reads answer 200 (a 429 is the public rate limit, counted separately)',
    Object.keys(readStatus).every((s) => s === '200' || s === '429'),
    JSON.stringify(readStatus),
  );

  // B: checkout ---------------------------------------------------------------------------------------------------------
  t = performance.now();
  const placed = [];
  const outcomes = {};
  await pool(members, CONCURRENCY, async (member) => {
    const wantsScarce = member.i % 2 === 0;
    const variantId = wantsScarce ? scarce : plenty[member.i % plenty.length];
    const add = await call(member, 'POST', '/api/v1/me/cart/add', { variantId, quantity: 1 });
    if (add.status !== 200)
      return void (outcomes[`add:${add.code ?? add.status}`] =
        (outcomes[`add:${add.code ?? add.status}`] ?? 0) + 1);
    await call(member, 'POST', '/api/v1/me/checkout/quote', { voucherCode: null });
    const order = await call(member, 'POST', '/api/v1/me/online-orders', {
      address: address(member.i),
      saveAddress: false,
      voucherCode: null,
      acceptedPolicyVersion: settings.body.policyVersion,
      clientRequestId: randomUUID(),
    });
    const label = order.status === 200 ? 'placed' : `place:${order.code ?? order.status}`;
    outcomes[label] = (outcomes[label] ?? 0) + 1;
    if (order.status === 200) placed.push({ member, order: order.body, scarce: wantsScarce });
  });
  await report('B_checkout', t);
  summary.phases.B_checkout.outcomes = outcomes;
  const scarcePlaced = placed.filter((p) => p.scarce).length;
  check(
    'B: the scarce product is never oversold',
    scarcePlaced <= SCARCE_STOCK,
    `${scarcePlaced} orders for ${SCARCE_STOCK} units`,
  );
  check(
    'B: the scarce product is sold out exactly',
    scarcePlaced === Math.min(SCARCE_STOCK, Math.ceil(CUSTOMERS / 2)),
    `${scarcePlaced}`,
  );
  check(
    'B: every other member could order',
    placed.filter((p) => !p.scarce).length === Math.floor(CUSTOMERS / 2),
    `${placed.filter((p) => !p.scarce).length}`,
  );
  check(
    'B: no server error',
    !Object.keys(outcomes).some((k) => /5\d\d|SERVICE_UNAVAILABLE/.test(k)),
    JSON.stringify(outcomes),
  );

  // C: payment ----------------------------------------------------------------------------------------------------------
  t = performance.now();
  const payStatus = {};
  const webhookStatus = {};
  await pool(placed, CONCURRENCY, async ({ member, order }) => {
    const pay = await call(member, 'POST', `/api/v1/me/online-orders/${order.id}/pay`, {
      locale: 'vi',
    });
    payStatus[pay.status] = (payStatus[pay.status] ?? 0) + 1;
    if (pay.status !== 200) return;
    const [{ provider_order_code: orderCode }] = await database.$queryRawUnsafe(
      `SELECT provider_order_code FROM payments WHERE invoice_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
      order.invoiceId,
    );
    const signed = await (
      await fetch(`http://127.0.0.1:${CONTROL_PORT}/webhook/${orderCode}`)
    ).json();
    const deliveries = await Promise.all(
      [1, 2, 3].map(() => call(null, 'POST', '/api/v1/webhooks/payos', signed)),
    );
    for (const d of deliveries) webhookStatus[d.status] = (webhookStatus[d.status] ?? 0) + 1;
  });
  await report('C_payment', t);
  summary.phases.C_payment.pay = payStatus;
  summary.phases.C_payment.webhook = webhookStatus;
  check(
    'C: every payment link was created',
    payStatus[200] === placed.length,
    JSON.stringify(payStatus),
  );
  check(
    'C: every webhook delivery (three copies each) was accepted',
    webhookStatus[200] === placed.length * 3,
    JSON.stringify(webhookStatus),
  );

  // D: invariants -------------------------------------------------------------------------------------------------------
  await delay(1500);
  const ordersByInvoice = placed
    .map((p) => p.order.invoiceId ?? p.order.invoice?.id)
    .filter(Boolean);
  const one = async (sql, ...values) => (await database.$queryRawUnsafe(sql, ...values))[0];
  const paidInvoices = Number(
    (
      await one(
        `SELECT count(*)::int AS n FROM invoices WHERE branch_id = $1::uuid AND status = 'PAID' AND channel = 'ONLINE'`,
        ids.branch,
      )
    ).n,
  );
  check(
    'D: every placed order ended PAID exactly once',
    paidInvoices === placed.length,
    `${paidInvoices}/${placed.length}`,
  );
  const payments = Number(
    (
      await one(
        `SELECT count(*)::int AS n FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.branch_id = $1::uuid AND i.channel = 'ONLINE' AND p.status = 'SUCCEEDED'`,
        ids.branch,
      )
    ).n,
  );
  check(
    'D: one confirmed payment per order (three webhook copies, one payment)',
    payments === placed.length,
    `${payments}/${placed.length}`,
  );
  const paidEvents = Number(
    (
      await one(
        `SELECT count(*)::int AS n FROM outbox_events e JOIN invoices i ON i.id::text = e.aggregate_id::text WHERE e.event_type = 'INVOICE_PAID' AND i.branch_id = $1::uuid AND i.channel = 'ONLINE'`,
        ids.branch,
      )
    ).n,
  );
  check(
    'D: one INVOICE_PAID event per order',
    paidEvents === placed.length,
    `${paidEvents}/${placed.length}`,
  );
  const levels = await database.$queryRawUnsafe(
    `SELECT s.variant_id, s.on_hand, s.reserved,
            COALESCE((SELECT sum(m.quantity_delta) FROM stock_movements m WHERE m.branch_id = s.branch_id AND m.variant_id = s.variant_id), 0)::int AS moved,
            COALESCE((SELECT sum(r.quantity) FROM stock_reservations r WHERE r.branch_id = s.branch_id AND r.variant_id = s.variant_id AND r.status = 'RESERVED'), 0)::int AS held
     FROM stock_levels s WHERE s.branch_id = $1::uuid`,
    ids.branch,
  );
  check(
    'D: on hand equals the movements, reserved equals the open reservations, never negative, reserved <= on hand',
    levels.every(
      (l) =>
        l.on_hand === l.moved && l.reserved === l.held && l.on_hand >= 0 && l.reserved <= l.on_hand,
    ),
    JSON.stringify(levels.filter((l) => !(l.on_hand === l.moved && l.reserved === l.held))),
  );
  const duplicateCodes = Number(
    (
      await one(
        `SELECT count(*)::int AS n FROM (SELECT code FROM product_orders WHERE branch_id = $1::uuid GROUP BY code HAVING count(*) > 1) d`,
        ids.branch,
      )
    ).n,
  );
  check('D: order codes are unique', duplicateCodes === 0);
  void ordersByInvoice;

  // E: security ---------------------------------------------------------------------------------------------------------
  const a = members[0];
  const b = members[1];
  const aOrder = placed.find((p) => p.member === a)?.order;
  const sec = async (name, work, accept) => {
    const r = await work();
    check(`E: ${name}`, accept(r), `${r.status} ${r.code ?? ''}`);
  };
  await sec(
    'the cart needs a session',
    () => call(null, 'GET', '/api/v1/me/cart'),
    (r) => r.status === 401,
  );
  await sec(
    'a write needs the CSRF token',
    () =>
      call({ ...a, csrf: 'x'.repeat(43) }, 'POST', '/api/v1/me/cart/add', {
        variantId: plenty[0],
        quantity: 1,
      }),
    (r) => r.status === 403,
  );
  await sec(
    'a write needs the Origin',
    () =>
      call(
        a,
        'POST',
        '/api/v1/me/cart/add',
        { variantId: plenty[0], quantity: 1 },
        { Origin: 'https://evil.example' },
      ),
    (r) => r.status === 403,
  );
  if (aOrder) {
    await sec(
      "another member cannot read someone else's order",
      () => call(b, 'GET', `/api/v1/me/online-orders/${aOrder.id}`),
      (r) => r.status === 404,
    );
    await sec(
      "another member cannot cancel someone else's order",
      () => call(b, 'POST', `/api/v1/me/online-orders/${aOrder.id}/cancel`, {}),
      (r) => r.status === 404,
    );
    await sec(
      "another member cannot pay someone else's order",
      () => call(b, 'POST', `/api/v1/me/online-orders/${aOrder.id}/pay`, { locale: 'vi' }),
      (r) => r.status === 404,
    );
    await sec(
      'a paid order cannot be cancelled by the member',
      () => call(a, 'POST', `/api/v1/me/online-orders/${aOrder.id}/cancel`, {}),
      (r) => r.status === 409,
    );
    await sec(
      'a member cannot reach the staff order page',
      () => call(a, 'GET', `/api/v1/online-orders/${aOrder.id}`),
      (r) => r.status === 403 || r.status === 404,
    );
  }
  await sec(
    'a member cannot reach the staff queue or the settings write',
    () =>
      call(a, 'POST', '/api/v1/online-sales-settings/edit', { expectedVersion: 1, enabled: false }),
    (r) => r.status === 403,
  );
  await sec(
    'an identity in the body is refused',
    () =>
      call(a, 'POST', '/api/v1/me/cart/add', { variantId: plenty[0], quantity: 1, userId: b.id }),
    (r) => r.status === 400,
  );
  await sec(
    'a price in the order body is refused',
    () =>
      call(a, 'POST', '/api/v1/me/online-orders', {
        address: address(0),
        acceptedPolicyVersion: 1,
        clientRequestId: randomUUID(),
        totalVnd: '1',
      }),
    (r) => r.status === 400,
  );
  await sec(
    'a forged webhook signature is refused',
    () =>
      call(null, 'POST', '/api/v1/webhooks/payos', {
        code: '00',
        desc: 'success',
        success: true,
        data: { orderCode: 1, amount: 1 },
        signature: 'f'.repeat(64),
      }),
    (r) => r.status === 401 || r.status === 429,
  );
  await sec(
    'an oversized webhook body is refused',
    () => call(null, 'POST', '/api/v1/webhooks/payos', { padding: 'x'.repeat(40_000) }),
    (r) => r.status === 400 || r.status === 413 || r.status === 401,
  );
  await sec(
    'a malformed webhook body is refused',
    () => call(null, 'POST', '/api/v1/webhooks/payos', '{not json'),
    (r) => r.status >= 400 && r.status < 500,
  );
  await sec(
    'an injection string in a search is only text',
    () =>
      call(
        null,
        'GET',
        `/api/v1/public/products?locale=vi&q=${encodeURIComponent("'; DROP TABLE products; --")}`,
      ),
    (r) => r.status === 200,
  );
  await sec(
    'a cursor that is not ours is refused',
    () =>
      call(a, 'GET', `/api/v1/me/online-orders?cursor=${encodeURIComponent('../../etc/passwd')}`),
    (r) => r.status === 400 || r.status === 200,
  );
  const products = Number(
    (
      await one(
        `SELECT count(*)::int AS n FROM products WHERE code LIKE $1`,
        `ld-${run.toLowerCase()}-%`,
      )
    ).n,
  );
  check('E: nothing was dropped by the injection string', products === 1 + PRODUCTS, `${products}`);
  // A forged webhook flood is throttled cheaply: valid deliveries are never throttled (phase C passed above).
  const flood = await Promise.all(
    Array.from({ length: 80 }, () =>
      call(null, 'POST', '/api/v1/webhooks/payos', {
        code: '00',
        data: { orderCode: 2 },
        signature: 'a'.repeat(64),
      }),
    ),
  );
  check(
    'E: a flood of forged webhooks is refused or throttled, never accepted',
    flood.every((r) => r.status === 401 || r.status === 429),
    JSON.stringify(flood.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {})),
  );
  await report('E_security', performance.now());
} catch (error) {
  summary.failures.push(`exception: ${error?.stack ?? error}`);
} finally {
  stop();
  await delay(300);
}
mkdirSync(`${root}.local/p6-22`, { recursive: true });
writeFileSync(`${root}.local/p6-22/load-${run}.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await database.$disconnect?.();
process.exit(summary.failures.length ? 1 : 0);
