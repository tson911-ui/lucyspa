import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { readRows, readZipParts } from '@lucy-spa/server';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { onlineOrderKit } from '../testing/online-order-kit.js';
import { REPORT_DEFINITIONS } from '@lucy-spa/contracts';
import { addDays } from './report.dates.js';
import { ReportExportService } from './export.service.js';
import { ReportsService } from './reports.service.js';

/**
 * Phase 8 P8-4 against real PostgreSQL (design section 6, P8-T9, OQ-P8-6): a report as a file. The file holds the very numbers of the
 * screen; it needs EXPORT_REPORTS at the same branches as the report; a refused or oversized export writes nothing; a taken file
 * leaves exactly one audit row; text that a spreadsheet could read as a formula is neutralised; two files at a time at most. Fixtures
 * roll back.
 */
test(
  'Phase 8 P8-4 export: authority, content equals the screen, audit row, cap, formula safety, limits; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await onlineOrderKit(base);
      const { tx, fails } = base;
      const { A, B, people } = k;
      const reports = new ReportsService(base.adapter, base.throttle);
      const exports = new ReportExportService(base.adapter, base.throttle, base.environment);
      const clerk = await base.staff(['MANAGE_PRODUCT_RETURNS'], { branchId: A.id });
      const approver = await base.staff(['REFUND_PRODUCTS'], { branchId: A.id });
      const viewer = await base.staff(['VIEW_REVENUE'], { branchId: A.id });
      const exporter = await base.staff(['VIEW_REVENUE', 'EXPORT_REPORTS'], { branchId: A.id });
      const onlyExport = await base.staff(['EXPORT_REPORTS'], { branchId: A.id });
      // VIEW_REVENUE everywhere (global) but EXPORT_REPORTS at A only.
      const narrow = await base.staff(['EXPORT_REPORTS'], {
        branchId: A.id,
        globalCodes: ['VIEW_REVENUE'],
      });
      const today = await k.day();

      // ---- the data: a cash sale 3 x 100,000 and one unit refunded by cash, with a reason that looks like a formula.
      const product = await k.product('exp', [100_000]);
      const variant = product.variants[0]!;
      await k.receive(variant.id, 10);
      const invoice = await k.finalize(
        await k.addLine(await k.openSale(people.cashier, null), variant.id, 3),
      );
      await k.pay(invoice.id, 300_000);
      const view = await k.invoices.get(people.cashier.token, invoice.id);
      await k.runInventory(invoice.id);
      const opened = await k.ok(() =>
        k.returns.open(clerk.token, {
          branchId: A.id,
          invoiceLineId: view.productLines[0]!.id,
          reason: 'PERSONAL_PREFERENCE',
          requestedOutcome: 'REFUND',
          quantity: 1,
          sealIntact: true,
          notes: null,
          clientRequestId: randomUUID(),
        }),
      );
      const accepted = await k.ok(() =>
        k.returns.accept(approver.token, opened.id, {
          expectedRowVersion: opened.rowVersion,
          outcome: 'REFUND',
          note: null,
        }),
      );
      await k.reconfirm(approver.token);
      await k.ok(() =>
        k.refunds.refund(approver.token, accepted.id, {
          quantity: 1,
          method: 'CASH',
          bankReference: null,
          restock: 'SELLABLE',
          reason: 'Khách trả hàng',
          clientRequestId: randomUUID(),
        }),
      );
      await tx.$executeRawUnsafe('SAVEPOINT reason');
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRawUnsafe(
        `UPDATE product_refunds SET reason = '=HYPERLINK("http://evil.example","x")'`,
      );
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
      await tx.$executeRawUnsafe('RELEASE SAVEPOINT reason');

      const query = { from: today, to: today };
      const auditCount = () => tx.auditEvent.count({ where: { action: 'REPORT_EXPORTED' } });
      const decode = (bytes: Uint8Array) =>
        new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

      await suite.test(
        'authority: EXPORT_REPORTS and the report permission at the same branch',
        async () => {
          const before = await auditCount();
          for (const who of [viewer, onlyExport, k.people.nobody]) {
            await fails(
              () =>
                exports.export(who.token, { report: 'revenue-overview', format: 'csv', ...query }),
              'FORBIDDEN',
            );
          }
          await fails(
            () =>
              exports.export(undefined, { report: 'revenue-overview', format: 'csv', ...query }),
            'AUTHENTICATION_REQUIRED',
          );
          // The Owner may; another branch's filter is refused for a person who may export only at A.
          await fails(
            () =>
              exports.export(exporter.token, {
                report: 'revenue-overview',
                format: 'csv',
                ...query,
                branchId: B.id,
              }),
            'FORBIDDEN',
          );
          assert.equal(await auditCount(), before, 'a refused export writes nothing');
        },
      );

      await suite.test(
        'xlsx of the overview holds the screen numbers; one audit row names who, what, how many',
        async () => {
          const screen = await reports.revenue(exporter.token, { ...query, branchId: A.id });
          const before = await auditCount();
          const file = await exports.export(exporter.token, {
            report: 'revenue-overview',
            format: 'xlsx',
            ...query,
            branchId: A.id,
          });
          assert.equal(file.filename, `lucyspa_revenue-overview_${today}_${today}.xlsx`);
          assert.match(file.contentType, /spreadsheetml\.sheet/);
          assert.equal(file.rows, 1);
          const rows = readRows(file.bytes, file.filename);
          assert.deepEqual(rows[0]?.cells, [
            'Từ ngày',
            'Đã thu',
            'Hoàn tiền',
            'Hoàn khi đổi hàng',
            'Doanh thu',
          ]);
          assert.deepEqual(rows[1]?.cells, [
            today,
            screen.totals.collectedVnd,
            screen.totals.refundsVnd,
            screen.totals.exchangesVnd,
            screen.totals.netVnd,
          ]);
          assert.equal(screen.totals.netVnd, '200000');
          // The information sheet carries the period, the branch, the person and the definition of revenue.
          const sheets = readZipParts(file.bytes);
          const info = decode(sheets['xl/worksheets/sheet2.xml']!);
          assert.ok(info.includes(`${today} → ${today}`));
          assert.ok(info.includes('Doanh thu = tiền đã thu thực tế'));
          // One audit row.
          assert.equal(await auditCount(), before + 1);
          const audit = await tx.auditEvent.findFirstOrThrow({
            where: { action: 'REPORT_EXPORTED' },
            orderBy: { occurredAt: 'desc' },
          });
          assert.equal(audit.actorUserId, exporter.id);
          assert.equal(audit.entityType, 'ReportExport');
          assert.equal(audit.entityId, 'revenue-overview');
          assert.equal(audit.dataClassification, 'FINANCIAL');
          assert.equal(audit.branchId, A.id);
          const after = audit.after as Record<string, unknown>;
          assert.equal(after['rows'], 1);
          assert.equal(after['format'], 'xlsx');
          assert.equal(after['from'], today);
          assert.deepEqual(after['branchIds'], [A.id]);
        },
      );

      await suite.test(
        'csv: BOM, by-branch / by-kind / by-method equal the screen; English headers on request',
        async () => {
          const screen = await reports.revenue(exporter.token, { ...query, branchId: A.id });
          const csv = await exports.export(exporter.token, {
            report: 'revenue-by-branch',
            format: 'csv',
            ...query,
            branchId: A.id,
          });
          assert.deepEqual([...csv.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
          const lines = decode(csv.bytes)
            .replace(/^\uFEFF/, '')
            .split('\r\n');
          assert.equal(
            lines[0],
            'Mã chi nhánh,Chi nhánh,Đã thu,Hoàn tiền,Hoàn khi đổi hàng,Doanh thu,Số hóa đơn đã thanh toán,Số lượt đến',
          );
          const branchRow = screen.byBranch[0]!;
          assert.equal(
            lines[1],
            [
              branchRow.branch.code,
              branchRow.branch.name,
              branchRow.collectedVnd,
              branchRow.refundsVnd,
              branchRow.exchangesVnd,
              branchRow.netVnd,
              branchRow.paidInvoices,
              branchRow.visits,
            ].join(','),
          );
          const kind = await exports.export(exporter.token, {
            report: 'revenue-by-kind',
            format: 'csv',
            ...query,
            branchId: A.id,
          });
          assert.ok(decode(kind.bytes).includes('Mỹ phẩm,Sản phẩm,Tại quầy,200000'));
          const method = await exports.export(exporter.token, {
            report: 'revenue-by-method',
            format: 'csv',
            ...query,
            branchId: A.id,
            locale: 'en',
          });
          const text = decode(method.bytes).replace(/^\uFEFF/, '');
          assert.ok(text.startsWith('Payment method,Money in,Money out,Revenue'));
          assert.ok(text.includes('Cash,300000,100000,200000'));
          assert.ok(text.includes('Manual transfer,0,0,0'));
        },
      );

      await suite.test(
        'narrowed scope: VIEW_REVENUE everywhere but EXPORT_REPORTS at one branch covers only that branch',
        async () => {
          const screen = await reports.revenue(narrow.token, query);
          assert.ok(
            screen.branches.some((branch) => branch.id === B.id),
            'the screen shows the other branch',
          );
          const file = await exports.export(narrow.token, {
            report: 'revenue-by-branch',
            format: 'csv',
            ...query,
          });
          const lines = decode(file.bytes)
            .replace(/^\uFEFF/, '')
            .trim()
            .split('\r\n');
          assert.equal(lines.length, 2, 'header and one branch');
          assert.ok(lines[1]!.startsWith(A.code));
          await fails(
            () =>
              exports.export(narrow.token, {
                report: 'revenue-by-branch',
                format: 'csv',
                ...query,
                branchId: B.id,
              }),
            'FORBIDDEN',
          );
        },
      );

      await suite.test(
        'formula safety: a reason that looks like a formula is neutralised in csv and stays text in xlsx',
        async () => {
          const csv = await exports.export(exporter.token, {
            report: 'refunds',
            format: 'csv',
            ...query,
            branchId: A.id,
          });
          const text = decode(csv.bytes).replace(/^\uFEFF/, '');
          assert.ok(text.includes(`"'=HYPERLINK(""http://evil.example"",""x"")"`), text);
          assert.ok(!/(^|,)=HYPERLINK/.test(text));
          const xlsx = await exports.export(exporter.token, {
            report: 'refunds',
            format: 'xlsx',
            ...query,
            branchId: A.id,
          });
          const sheet = decode(readZipParts(xlsx.bytes)['xl/worksheets/sheet1.xml']!);
          assert.ok(sheet.includes('t="inlineStr"') && !sheet.includes('<f>'));
          assert.ok(sheet.includes('=HYPERLINK(&quot;http://evil.example&quot;,&quot;x&quot;)'));
          const rows = readRows(xlsx.bytes, xlsx.filename);
          assert.equal(rows[0]?.cells[2], 'Loại');
          assert.equal(rows[1]?.cells[2], 'Hoàn tiền sản phẩm');
          assert.equal(rows[1]?.cells[5], '100000');
          assert.equal(rows[1]?.cells[8], 'Không');
        },
      );

      await suite.test(
        'the row cap: more rows than allowed is refused and writes no audit row',
        async () => {
          const before = await auditCount();
          await fails(
            () =>
              exports.export(
                exporter.token,
                { report: 'refunds', format: 'csv', ...query },
                undefined,
                { maxRows: 0 },
              ),
            'REPORT_TOO_MANY_ROWS',
          );
          const ok = await exports.export(
            exporter.token,
            { report: 'refunds', format: 'csv', ...query },
            undefined,
            { maxRows: 1 },
          );
          assert.equal(ok.rows, 1);
          assert.equal(await auditCount(), before + 1);
        },
      );

      await suite.test(
        'pay and profit data: a fresh password for each file (the rule is on the definition; tried on the refunds report)',
        async () => {
          const definition = REPORT_DEFINITIONS.find((entry) => entry.id === 'refunds')! as {
            exportReauth: boolean;
          };
          definition.exportReauth = true;
          try {
            const before = await auditCount();
            const spent = () => tx.reauthUse.count({ where: { purpose: 'REPORT_EXPORT' } });
            // Signing in counts as a fresh confirmation: it covers the first file, once.
            const first = await exports.export(exporter.token, {
              report: 'refunds',
              format: 'csv',
              ...query,
            });
            assert.equal(first.rows, 1);
            assert.equal(await spent(), 1);
            assert.equal(await auditCount(), before + 1);
            await fails(
              () => exports.export(exporter.token, { report: 'refunds', format: 'csv', ...query }),
              'REAUTHENTICATION_REQUIRED',
            );
            assert.equal(await auditCount(), before + 1, 'no file, no audit row');
            assert.equal(await spent(), 1);
            // Entering the password again covers one more file.
            await k.reconfirm(exporter.token);
            await exports.export(exporter.token, { report: 'refunds', format: 'csv', ...query });
            assert.equal(await spent(), 2);
            assert.equal(await auditCount(), before + 2);
          } finally {
            definition.exportReauth = false;
          }
        },
      );

      await suite.test(
        'validation: unknown report, unbuilt report, format, locale, dates',
        async () => {
          const csv = (patch: Record<string, unknown>) =>
            exports.export(exporter.token, {
              report: 'revenue-overview',
              format: 'csv',
              ...query,
              ...patch,
            } as never);
          await fails(() => csv({ report: 'nope' }), 'VALIDATION_FAILED', 'report');
          await fails(() => csv({ report: 'stock-best-sellers' }), 'NOT_FOUND');
          await fails(() => csv({ format: 'pdf' }), 'VALIDATION_FAILED', 'format');
          await fails(() => csv({ locale: 'fr' }), 'VALIDATION_FAILED', 'locale');
          await fails(() => csv({ from: undefined }), 'VALIDATION_FAILED', 'from');
          await fails(() => csv({ from: addDays(today, 1), to: today }), 'REPORT_RANGE_INVALID');
          await fails(() => csv({ from: '2020-01-01', to: today }), 'REPORT_RANGE_TOO_LONG');
        },
      );

      await suite.test('at most two files at a time per person', async () => {
        const internals = exports as unknown as { inFlight: Map<string, number> };
        internals.inFlight.set(exporter.id, 2);
        await fails(
          () =>
            exports.export(exporter.token, { report: 'revenue-overview', format: 'csv', ...query }),
          'EXPORT_BUSY',
        );
        // Another person is not blocked, and the count is given back after a file.
        internals.inFlight.clear();
        await exports.export(exporter.token, {
          report: 'revenue-overview',
          format: 'csv',
          ...query,
        });
        assert.equal(internals.inFlight.size, 0);
        internals.inFlight.set(exporter.id, 1);
        await exports.export(exporter.token, {
          report: 'revenue-overview',
          format: 'csv',
          ...query,
        });
        assert.equal(internals.inFlight.get(exporter.id), 1);
      });
    });
  },
);
