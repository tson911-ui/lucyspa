import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { WEBSITE_PAGE_LIMITS, type WebsitePageInput } from '@lucy-spa/contracts';
import {
  createDatabaseClient,
  syncPermissionCatalog,
  type PermissionCode,
  type Prisma,
} from '@lucy-spa/database';
import { LocalDiskMediaStorage, parseApiEnvironment } from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { appointForFixture, isAdministrative } from '../testing/organization-fixture.js';
import { validVnMobile } from '../testing/phone.js';
import { PageService } from './page.service.js';
import { PublicWebsiteService } from './popup.service.js';

const BODY =
  '## Dữ liệu\n\nChúng tôi giữ dữ liệu của bạn an toàn.\n\n## Quyền của bạn\n\n- Xem\n- Sửa';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'information pages: permission, markup rules, addresses, the one terms and privacy page, public reads; all fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (context) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit auth integration tests.');
    const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
    const environment = parseApiEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://localhost:6379',
      WEB_ORIGIN: 'http://localhost:3000',
      AUTH_ALLOW_INSECURE_LOCAL_COOKIE: 'true',
      AUTH_CSRF_ACTIVE_VERSION: '1',
      AUTH_CSRF_KEYS: ring(),
      AUTH_THROTTLE_ACTIVE_VERSION: '1',
      AUTH_THROTTLE_KEYS: ring(),
    });
    const database = createDatabaseClient(databaseUrl);
    const sessions = new SessionService({ client: database } as PrismaService, environment);
    const run = randomUUID().replaceAll('-', '').slice(0, 8).toLowerCase();
    const userIds: string[] = [];
    const root = await mkdtemp(path.join(tmpdir(), 'lucy-page-it-'));
    const rollback = new Error('Intentional page integration rollback');
    try {
      await database.$connect();
      const pageCount = await database.websitePage.count();
      const hash = await new PasswordService().hashForSetting('a calm lotus evening 2026');
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            let savepoints = 0;
            const isolated = async <T>(work: () => Promise<T>): Promise<T> => {
              const name = `command_${++savepoints}`;
              await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
              try {
                const result = await work();
                await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
                return result;
              } catch (error) {
                await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
                throw error;
              }
            };
            const runner = {
              withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(() => work(tx)),
              withExclusiveTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(() => work(tx)),
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
              resolve: (token: string | undefined) => sessions.resolve(token, tx),
            };
            const throttle = new AuthThrottleService(environment);
            const pages = new PageService(runner, throttle);
            const site = new PublicWebsiteService(
              runner,
              throttle,
              new LocalDiskMediaStorage(root),
            );
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            // The database may already hold published pages; none of them may influence these cases.
            await tx.websitePage.updateMany({ data: { isPublished: false } });
            let sequence = 0;
            const principal = async (kind: 'EMPLOYEE' | 'CUSTOMER') => {
              const id = randomUUID();
              userIds.push(id);
              sequence += 1;
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status: 'ACTIVE',
                  fullName: `Fixture ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: `page-${sequence}-${run}@example.com`,
                  emailDelivery: `page-${sequence}-${run}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical: validVnMobile(),
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `PG-${sequence}-${run}`.toUpperCase(),
                            dateOfBirth: new Date('1994-01-01'),
                            address: 'Fixture',
                          },
                        },
                      }
                    : {
                        customerProfile: {
                          create: { dateOfBirth: new Date('1994-01-01'), address: 'Fixture' },
                        },
                      }),
                },
                select: { id: true },
              });
              return id;
            };
            const grantRole = async (
              userId: string,
              codes: PermissionCode[],
              branchId?: string,
            ) => {
              sequence += 1;
              const role = await tx.role.create({
                data: {
                  code: `PG_${run}_${sequence}`.toUpperCase(),
                  displayNameVi: 'Vai trò',
                  displayNameEn: 'Role',
                  permissions: {
                    create: codes.map((code) => ({ permissionId: permissions.get(code)! })),
                  },
                },
                select: { id: true },
              });
              await tx.userRoleAssignment.create({
                data: {
                  userId,
                  roleId: role.id,
                  scopeKind: branchId ? 'BRANCH' : 'GLOBAL',
                  branchId: branchId ?? null,
                },
              });
              if (isAdministrative(codes)) await appointForFixture(tx, userId, branchId);
            };
            const login = async (userId: string) => {
              const user = await tx.user.findUniqueOrThrow({
                where: { id: userId },
                select: { credentialVersion: true, authzVersion: true },
              });
              const anonymous = await sessions.createAnonymous(tx);
              return (
                await sessions.rotateAuthenticated(
                  anonymous.token,
                  {
                    userId,
                    passwordHash: hash,
                    credentialVersion: user.credentialVersion,
                    authzVersion: user.authzVersion,
                  },
                  { reauthenticated: false },
                  tx,
                )
              ).token;
            };
            const actor = async (codes: PermissionCode[], branchScope?: string) => {
              const id = await principal('EMPLOYEE');
              if (codes.length > 0) await grantRole(id, codes, branchScope);
              return { id, session: await login(id) };
            };
            const fails = (work: Promise<unknown>, code: string, field?: string) =>
              assert.rejects(
                work,
                (error: unknown) =>
                  error instanceof AuthError &&
                  error.code === code &&
                  (field === undefined || error.field === field),
              );
            const audit = (entityId: string, action: string) =>
              tx.auditEvent.findMany({ where: { entityId, action } });
            const slug = (name: string) => `${name}-${run}`;
            const draft = (patch: Partial<WebsitePageInput> = {}): WebsitePageInput => ({
              slug: slug('chinh-sach'),
              role: 'POLICY',
              titleVi: 'Chính sách đổi trả',
              titleEn: null,
              bodyVi: BODY,
              bodyEn: null,
              seoTitleVi: null,
              seoTitleEn: null,
              seoDescriptionVi: null,
              seoDescriptionEn: null,
              isPublished: false,
              ...patch,
            });

            const branch = (
              await tx.branch.create({
                data: { code: `PG-${run}`.toUpperCase(), name: 'Page branch' },
                select: { id: true },
              })
            ).id;
            const editor = await actor(['MANAGE_WEBSITE_CONTENT']);
            const nobody = await actor(['VIEW_EMPLOYEES']);
            const branchOnly = await actor(['MANAGE_WEBSITE_CONTENT'], branch);
            const customer = await login(await principal('CUSTOMER'));

            await context.test(
              'MANAGE_WEBSITE_CONTENT is GLOBAL only: nobody else reaches any page command',
              async () => {
                const page = await pages.create(editor.session, draft({ slug: slug('quyen') }));
                for (const who of [nobody.session, branchOnly.session, customer]) {
                  await fails(pages.list(who), 'FORBIDDEN');
                  await fails(pages.get(who, page.id), 'FORBIDDEN');
                  await fails(pages.create(who, draft({ slug: slug('khac') })), 'FORBIDDEN');
                  await fails(
                    pages.update(who, page.id, { ...draft(), expectedVersion: page.version }),
                    'FORBIDDEN',
                  );
                  await fails(
                    pages.setPublished(who, page.id, {
                      expectedVersion: page.version,
                      isPublished: true,
                    }),
                    'FORBIDDEN',
                  );
                }
                await fails(pages.list(undefined), 'AUTHENTICATION_REQUIRED');
                await fails(pages.get(editor.session, 'not-an-id'), 'NOT_FOUND');
                await fails(pages.get(editor.session, randomUUID()), 'NOT_FOUND');
                const listed = (await pages.list(editor.session)).items.find(
                  (row) => row.id === page.id,
                );
                assert.equal(
                  listed?.version,
                  page.version,
                  'the list carries the version the row menu sends back',
                );
              },
            );

            await context.test(
              'a save is checked: address, role, title, text and markup',
              async () => {
                const created = await pages.create(
                  editor.session,
                  draft({ slug: ` ${slug('Gioi-Thieu')} `, titleVi: '  Giới   thiệu  ' }),
                );
                assert.equal(
                  created.slug,
                  slug('gioi-thieu'),
                  'the address is trimmed and lowercased',
                );
                assert.equal(created.titleVi, 'Giới thiệu');
                assert.equal(created.isPublished, false);
                assert.equal(created.version, 1);
                const bad: [Partial<WebsitePageInput>, string][] = [
                  [{ slug: 'Có-Dấu' }, 'slug'],
                  [{ slug: 'a b' }, 'slug'],
                  [{ slug: 'a--b' }, 'slug'],
                  [{ slug: '' }, 'slug'],
                  [{ slug: 'x'.repeat(81) }, 'slug'],
                  [{ slug: 'services' }, 'slug'],
                  [{ slug: 'contact' }, 'slug'],
                  [{ slug: 'workforce' }, 'slug'],
                  [{ role: 'ADMIN' as never }, 'role'],
                  [{ titleVi: '   ' }, 'titleVi'],
                  [{ titleVi: 'x'.repeat(121) }, 'titleVi'],
                  [{ titleEn: 'x'.repeat(121) }, 'titleEn'],
                  [{ bodyVi: '' }, 'bodyVi'],
                  [{ bodyVi: 'Có <b>HTML</b>' }, 'bodyVi'],
                  [{ bodyVi: '[nhấn](javascript:alert(1))' }, 'bodyVi'],
                  [{ bodyVi: '![ảnh](https://example.com/a.png)' }, 'bodyVi'],
                  [{ bodyVi: '# Tiêu đề cấp một' }, 'bodyVi'],
                  [{ bodyEn: '<script>x</script>' }, 'bodyEn'],
                  [{ bodyVi: 'x'.repeat(WEBSITE_PAGE_LIMITS.body + 1) }, 'bodyVi'],
                  [{ seoTitleVi: 'x'.repeat(71) }, 'seoTitleVi'],
                  [{ seoDescriptionEn: 'x'.repeat(201) }, 'seoDescriptionEn'],
                  [{ isPublished: 'yes' as never }, 'isPublished'],
                ];
                for (const [patch, field] of bad) {
                  await fails(
                    pages.create(editor.session, draft({ slug: slug('xau'), ...patch })),
                    'VALIDATION_FAILED',
                    field,
                  );
                }
                assert.equal(await tx.websitePage.count({ where: { slug: slug('xau') } }), 0);
                // Text is stored as written, in NFC, with plain line ends and no outer blank lines.
                const written = await pages.create(
                  editor.session,
                  draft({
                    slug: slug('viet'),
                    bodyVi: '\r\n\r\n## Một   \r\n\r\nChữ  \r\n\r\n',
                    bodyEn: '  ',
                  }),
                );
                assert.equal(written.bodyVi, '## Một\n\nChữ');
                assert.equal(written.bodyEn, null, 'blank English text is no English text');
                const [event] = await audit(written.id, 'PAGE_CREATED');
                assert.equal(event?.actorUserId, editor.id);
                assert.equal((event?.after as { slug: string }).slug, slug('viet'));
              },
            );

            await context.test(
              'the largest text of both languages saves and reads back whole',
              async () => {
                const largest = 'ế'.repeat(WEBSITE_PAGE_LIMITS.body);
                const page = await pages.create(
                  editor.session,
                  draft({ slug: slug('dai'), bodyVi: largest, bodyEn: largest }),
                );
                assert.equal(
                  [...(await pages.get(editor.session, page.id)).bodyVi].length,
                  WEBSITE_PAGE_LIMITS.body,
                );
              },
            );

            await context.test(
              'an address is taken once, whatever the case, and updates keep their own',
              async () => {
                const first = await pages.create(editor.session, draft({ slug: slug('mot') }));
                await fails(
                  pages.create(editor.session, draft({ slug: slug('MOT') })),
                  'CONFLICT',
                  'slug',
                );
                const second = await pages.create(editor.session, draft({ slug: slug('hai') }));
                await fails(
                  pages.update(editor.session, second.id, {
                    ...draft({ slug: slug('mot') }),
                    expectedVersion: second.version,
                  }),
                  'CONFLICT',
                  'slug',
                );
                const same = await pages.update(editor.session, first.id, {
                  ...draft({ slug: slug('mot'), titleVi: 'Một (sửa)' }),
                  expectedVersion: first.version,
                });
                assert.equal(same.titleVi, 'Một (sửa)');
                assert.equal(same.version, first.version + 1);
              },
            );

            await context.test(
              'versions: a stale save is a conflict; an update leaves the full old and new text in the audit',
              async () => {
                const page = await pages.create(editor.session, draft({ slug: slug('phien') }));
                const next = await pages.update(editor.session, page.id, {
                  ...draft({ slug: slug('phien'), bodyVi: 'Nội dung mới.', bodyEn: 'New text.' }),
                  expectedVersion: page.version,
                });
                await fails(
                  pages.update(editor.session, page.id, {
                    ...draft({ slug: slug('phien') }),
                    expectedVersion: page.version,
                  }),
                  'CONFLICT',
                );
                await fails(
                  pages.update(editor.session, page.id, {
                    ...draft({ slug: slug('phien') }),
                    expectedVersion: 0,
                  }),
                  'VALIDATION_FAILED',
                  'expectedVersion',
                );
                const [event] = await audit(page.id, 'PAGE_UPDATED');
                assert.equal((event?.before as { bodyVi: string }).bodyVi, BODY);
                assert.equal((event?.after as { bodyVi: string }).bodyVi, 'Nội dung mới.');
                assert.equal((event?.after as { bodyEn: string }).bodyEn, 'New text.');
                assert.equal(next.version, page.version + 1);
              },
            );

            await context.test(
              'only a published page is public; a draft and an unknown address are the same 404',
              async () => {
                const page = await pages.create(
                  editor.session,
                  draft({
                    slug: slug('cong-khai'),
                    bodyEn: 'English text.',
                    titleEn: 'Public page',
                    seoTitleEn: 'English SEO',
                    seoTitleVi: 'SEO Việt',
                  }),
                );
                await fails(site.page('vi', slug('cong-khai')), 'NOT_FOUND');
                await fails(site.page('vi', slug('khong-co')), 'NOT_FOUND');
                await fails(site.page('vi', 'Not A Slug!'), 'NOT_FOUND');
                await fails(site.page('vi', ''), 'NOT_FOUND');
                const live = await pages.setPublished(editor.session, page.id, {
                  expectedVersion: page.version,
                  isPublished: true,
                });
                assert.equal(live.isPublished, true);
                assert.equal(live.version, page.version + 1);
                const vi = await site.page('vi', slug('cong-khai'));
                assert.deepEqual(
                  [vi.title, vi.language, vi.seoTitle, vi.body],
                  ['Chính sách đổi trả', 'vi', 'SEO Việt', BODY],
                );
                const en = await site.page('en', slug('cong-khai'));
                assert.deepEqual(
                  [en.title, en.language, en.seoTitle, en.body],
                  ['Public page', 'en', 'English SEO', 'English text.'],
                );
                // Publishing again changes nothing: no new version, no second event.
                const again = await pages.setPublished(editor.session, page.id, {
                  expectedVersion: live.version,
                  isPublished: true,
                });
                assert.equal(again.version, live.version);
                assert.equal((await audit(page.id, 'PAGE_PUBLISHED')).length, 1);
                await fails(
                  pages.setPublished(editor.session, page.id, {
                    expectedVersion: page.version,
                    isPublished: false,
                  }),
                  'CONFLICT',
                );
                const hidden = await pages.setPublished(editor.session, page.id, {
                  expectedVersion: live.version,
                  isPublished: false,
                });
                assert.equal(hidden.isPublished, false);
                await fails(site.page('vi', slug('cong-khai')), 'NOT_FOUND');
                assert.equal((await audit(page.id, 'PAGE_UNPUBLISHED')).length, 1);
              },
            );

            await context.test(
              'without English text the English visitor reads the Vietnamese text, and the page says so',
              async () => {
                const page = await pages.create(
                  editor.session,
                  draft({ slug: slug('chi-viet'), titleEn: 'Only a title', isPublished: true }),
                );
                const en = await site.page('en', slug('chi-viet'));
                assert.deepEqual(
                  [en.language, en.title, en.body],
                  ['vi', 'Chính sách đổi trả', BODY],
                );
                const index = (await site.pageIndex()).items.find(
                  (row) => row.slug === slug('chi-viet'),
                );
                assert.equal(index?.englishAvailable, false);
                assert.ok(page.id);
              },
            );

            await context.test(
              'one published terms page and one published privacy page, however the saves are made',
              async () => {
                const first = await pages.create(
                  editor.session,
                  draft({ slug: slug('dieu-khoan'), role: 'TERMS', isPublished: true }),
                );
                // A second published terms page is refused, naming the page that holds the role.
                await fails(
                  pages.create(
                    editor.session,
                    draft({ slug: slug('dieu-khoan-2'), role: 'TERMS', isPublished: true }),
                  ),
                  'PAGE_ROLE_TAKEN',
                  first.id,
                );
                // As a draft it is fine; publishing it, or turning another page into terms, is not.
                const second = await pages.create(
                  editor.session,
                  draft({ slug: slug('dieu-khoan-2'), role: 'TERMS' }),
                );
                await fails(
                  pages.setPublished(editor.session, second.id, {
                    expectedVersion: second.version,
                    isPublished: true,
                  }),
                  'PAGE_ROLE_TAKEN',
                  first.id,
                );
                const other = await pages.create(
                  editor.session,
                  draft({ slug: slug('khac-nua'), role: 'INFO', isPublished: true }),
                );
                await fails(
                  pages.update(editor.session, other.id, {
                    ...draft({ slug: slug('khac-nua'), role: 'TERMS', isPublished: true }),
                    expectedVersion: other.version,
                  }),
                  'PAGE_ROLE_TAKEN',
                  first.id,
                );
                // The privacy role is separate, and the page that holds a role can be saved again.
                const privacy = await pages.create(
                  editor.session,
                  draft({ slug: slug('bao-mat'), role: 'PRIVACY', isPublished: true }),
                );
                const saved = await pages.update(editor.session, first.id, {
                  ...draft({
                    slug: slug('dieu-khoan'),
                    role: 'TERMS',
                    isPublished: true,
                    titleVi: 'Điều khoản sửa',
                  }),
                  expectedVersion: first.version,
                });
                assert.equal(saved.titleVi, 'Điều khoản sửa');
                // Unpublishing frees the role.
                await pages.setPublished(editor.session, first.id, {
                  expectedVersion: saved.version,
                  isPublished: false,
                });
                const taken = await pages.setPublished(editor.session, second.id, {
                  expectedVersion: second.version,
                  isPublished: true,
                });
                assert.equal(taken.isPublished, true);
                // INFO and POLICY pages may be many.
                await pages.create(
                  editor.session,
                  draft({ slug: slug('chinh-sach-a'), role: 'POLICY', isPublished: true }),
                );
                await pages.create(
                  editor.session,
                  draft({ slug: slug('chinh-sach-b'), role: 'POLICY', isPublished: true }),
                );
                // The database says the same on its own (the last line of defence).
                await assert.rejects(
                  isolated(() =>
                    tx.websitePage.create({
                      data: {
                        slug: slug('raw'),
                        role: 'PRIVACY',
                        titleVi: 'Raw',
                        bodyVi: 'Raw',
                        isPublished: true,
                        createdByUserId: editor.id,
                        updatedByUserId: editor.id,
                      },
                    }),
                  ),
                  /website_pages_published_legal_key|unique/i,
                );
                assert.ok(privacy.id);
              },
            );

            await context.test(
              'the footer lists published policy, terms and privacy pages only, in the visitor language',
              async () => {
                await tx.websitePage.updateMany({ data: { isPublished: false } });
                assert.deepEqual((await site.site('vi')).pages, [], 'no page, no footer links');
                const policy = await pages.create(
                  editor.session,
                  draft({
                    slug: slug('doi-tra'),
                    role: 'POLICY',
                    titleVi: 'Đổi trả',
                    titleEn: 'Returns',
                    isPublished: true,
                  }),
                );
                await pages.create(
                  editor.session,
                  draft({
                    slug: slug('bao-hanh'),
                    role: 'POLICY',
                    titleVi: 'Bảo hành',
                    isPublished: true,
                  }),
                );
                await pages.create(
                  editor.session,
                  draft({ slug: slug('nhap'), role: 'POLICY', titleVi: 'Bản nháp' }),
                );
                await pages.create(
                  editor.session,
                  draft({
                    slug: slug('gioi-thieu-2'),
                    role: 'INFO',
                    titleVi: 'Giới thiệu',
                    isPublished: true,
                  }),
                );
                await pages.create(
                  editor.session,
                  draft({
                    slug: slug('dk'),
                    role: 'TERMS',
                    titleVi: 'Điều khoản sử dụng',
                    isPublished: true,
                  }),
                );
                const vi = (await site.site('vi')).pages;
                assert.deepEqual(
                  vi.map((link) => [link.role, link.title]),
                  [
                    ['POLICY', 'Bảo hành'],
                    ['TERMS', 'Điều khoản sử dụng'],
                    ['POLICY', 'Đổi trả'],
                  ],
                  'published policy and terms pages by Vietnamese title; no draft, no INFO page',
                );
                const en = (await site.site('en')).pages;
                assert.equal(en.find((link) => link.slug === slug('doi-tra'))?.title, 'Returns');
                assert.equal(
                  en.find((link) => link.slug === slug('bao-hanh'))?.title,
                  'Bảo hành',
                  'no English title: the Vietnamese one',
                );
                assert.ok(policy.id);
                const index = (await site.pageIndex()).items.map((row) => row.slug);
                assert.ok(index.includes(slug('gioi-thieu-2')) && !index.includes(slug('nhap')));
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.websitePage.count(), pageCount);
      assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
    } finally {
      await database.$disconnect();
      await rm(root, { recursive: true, force: true });
    }
  },
);
