import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog } from '@lucy-spa/database';
import { PasswordService } from '../auth/password.service.js';
import { appointForFixture } from '../testing/organization-fixture.js';
import { validVnMobile } from '../testing/phone.js';
import { parsePolicyFile, POLICY_PAGES, runPolicyImport } from './policy-pages.js';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'policy pages import: dry run writes nothing, apply creates the eight pages, a second run skips them, a taken legal role is reported; all fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async () => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit auth integration tests.');
    const pages = parsePolicyFile(
      readFileSync(fileURLToPath(new URL('../../../../docs/policies.md', import.meta.url)), 'utf8'),
    );
    const database = createDatabaseClient(databaseUrl);
    const run = randomUUID().replaceAll('-', '').slice(0, 8).toLowerCase();
    const rollback = new Error('Intentional policy import rollback');
    const slugs = POLICY_PAGES.map((page) => page.slug);
    try {
      await database.$connect();
      const hash = await new PasswordService().hashForSetting('a calm lotus evening 2026');
      const pageCount = await database.websitePage.count();
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            await syncPermissionCatalog(tx);
            const permission = await tx.permission.findFirstOrThrow({
              where: { code: 'MANAGE_WEBSITE_CONTENT' },
              select: { id: true },
            });
            let sequence = 0;
            const employee = async (withPermission: boolean) => {
              sequence += 1;
              const id = randomUUID();
              const email = `policy-${sequence}-${run}@example.com`;
              await tx.user.create({
                data: {
                  id,
                  kind: 'EMPLOYEE',
                  status: 'ACTIVE',
                  fullName: `Fixture ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: email,
                  emailDelivery: email,
                  phoneCanonical: validVnMobile(),
                  normalizationVersion: 1,
                  passwordHash: hash,
                  employeeProfile: {
                    create: {
                      employeeCodeCanonical: `PI-${sequence}-${run}`.toUpperCase(),
                      dateOfBirth: new Date('1994-01-01'),
                      address: 'Fixture',
                    },
                  },
                },
                select: { id: true },
              });
              if (withPermission) {
                const role = await tx.role.create({
                  data: {
                    code: `PI_${run}_${sequence}`.toUpperCase(),
                    displayNameVi: 'Vai trò',
                    displayNameEn: 'Role',
                    permissions: { create: [{ permissionId: permission.id }] },
                  },
                  select: { id: true },
                });
                await tx.userRoleAssignment.create({
                  data: { userId: id, roleId: role.id, scopeKind: 'GLOBAL', branchId: null },
                });
                await appointForFixture(tx, id);
              }
              return { id, email };
            };
            const editor = await employee(true);
            const bystander = await employee(false);

            // A clean slate inside this transaction: the eight addresses free, no other published terms or privacy page.
            await tx.websitePage.deleteMany({ where: { slug: { in: slugs } } });
            await tx.websitePage.updateMany({
              where: { role: { in: ['TERMS', 'PRIVACY'] } },
              data: { isPublished: false },
            });
            const countPages = () => tx.websitePage.count({ where: { slug: { in: slugs } } });

            // Not allowed: no permission, or no such user. Nothing is written.
            for (const actorEmail of [bystander.email, `nobody-${run}@example.com`]) {
              const refused = await runPolicyImport(tx, { apply: true, pages, actorEmail });
              assert.equal(refused.status, 'NO_ACTOR', actorEmail);
            }
            assert.equal(await countPages(), 0);

            // Dry run: reports, writes nothing.
            const dry = await runPolicyImport(tx, {
              apply: false,
              pages,
              actorEmail: editor.email,
            });
            assert.ok(dry.status === 'OK');
            assert.deepEqual(
              dry.outcomes.map((o) => o.status),
              Array(8).fill('would-create'),
            );
            assert.equal(await countPages(), 0);

            // Apply: eight published pages, in the file's order, the Owner's wording, the right roles, one audit record each.
            const first = await runPolicyImport(tx, {
              apply: true,
              pages,
              actorEmail: editor.email,
            });
            assert.ok(first.status === 'OK');
            assert.deepEqual(
              first.outcomes.map((o) => [o.slug, o.status]),
              slugs.map((slug) => [slug, 'created']),
            );
            const rows = await tx.websitePage.findMany({
              where: { slug: { in: slugs } },
              select: {
                slug: true,
                role: true,
                titleVi: true,
                bodyVi: true,
                titleEn: true,
                bodyEn: true,
                isPublished: true,
                createdByUserId: true,
              },
            });
            assert.equal(rows.length, 8);
            for (const page of pages) {
              const row = rows.find((candidate) => candidate.slug === page.slug)!;
              assert.equal(row.role, page.role);
              assert.equal(row.titleVi, page.heading);
              assert.equal(row.bodyVi, page.body);
              assert.equal(row.titleEn, null);
              assert.equal(row.bodyEn, null);
              assert.equal(row.isPublished, true);
              assert.equal(row.createdByUserId, editor.id);
            }
            assert.equal(rows.filter((row) => row.role === 'TERMS').length, 1);
            assert.equal(rows.filter((row) => row.role === 'PRIVACY').length, 1);
            assert.equal(
              await tx.auditEvent.count({
                where: { action: 'PAGE_CREATED_PUBLISHED', actorUserId: editor.id },
              }),
              8,
            );

            // A second run: all eight skipped, nothing changes.
            const second = await runPolicyImport(tx, {
              apply: true,
              pages,
              actorEmail: editor.email,
            });
            assert.ok(second.status === 'OK');
            assert.deepEqual(
              second.outcomes.map((o) => o.status),
              Array(8).fill('exists'),
            );
            assert.equal(await countPages(), 8);

            // A page edited since the first run is left exactly as it is.
            await tx.websitePage.update({
              where: { slug: 'chinh-sach-giao-hang' },
              data: { bodyVi: 'Bản đã sửa tay.' },
            });
            const third = await runPolicyImport(tx, {
              apply: true,
              pages,
              actorEmail: editor.email,
            });
            assert.ok(third.status === 'OK');
            assert.equal(
              (await tx.websitePage.findUniqueOrThrow({ where: { slug: 'chinh-sach-giao-hang' } }))
                .bodyVi,
              'Bản đã sửa tay.',
            );

            // The terms address is free but another published page already holds the TERMS role: reported as blocked, no crash,
            // and the other pages still import.
            await tx.websitePage.deleteMany({ where: { slug: { in: slugs } } });
            await tx.websitePage.create({
              data: {
                slug: `dieu-khoan-cu-${run}`,
                role: 'TERMS',
                titleVi: 'Điều khoản cũ',
                bodyVi: 'Nội dung cũ.',
                isPublished: true,
                createdByUserId: editor.id,
                updatedByUserId: editor.id,
              },
            });
            const blocked = await runPolicyImport(tx, {
              apply: true,
              pages,
              actorEmail: editor.email,
            });
            assert.ok(blocked.status === 'OK');
            assert.deepEqual(
              blocked.outcomes.map((o) => o.status),
              ['blocked', ...Array(7).fill('created')],
            );
            assert.equal(await countPages(), 7);

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.websitePage.count(), pageCount);
    } finally {
      await database.$disconnect();
    }
  },
);
