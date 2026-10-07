import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { customerInvoiceDetail, customerInvoiceList } from './customer-invoice.core.js';

/**
 * Phase 6 P6-10 against real PostgreSQL (design 5.2-5.6; T26): what the counter reads to add a product line (search by name, brand,
 * variant label or SKU without diacritics; the price now and the availability at THIS branch; the staff who may be the seller;
 * nothing about cost or lots) and what the member sees of a product invoice (name, quantity, price; never the seller, SKU, cost or
 * stock; a product-only invoice is a sale, not a visit). Every fixture rolls back.
 */
test(
  'Phase 6 P6-10 counter product search, sellers and the customer view of product lines; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await productSaleKit(base);
      const { tx, fails } = base;
      const { invoices, people, A, B } = k;
      const options = (actor: { token: string }, branchId: string, q?: string) =>
        k.ok(() => invoices.productOptions(actor.token, branchId, q === undefined ? {} : { q }));
      const rename = (productId: string, nameVi: string, nameEn: string) =>
        tx.product.update({
          where: { id: productId },
          data: { nameVi, nameEn, rowVersion: { increment: 1 } },
        });

      const cream = await k.product('cream', [200_000, 350_000]);
      await rename(cream.id, 'Kem dưỡng da', 'Skin cream');
      const [v50, v100] = cream.variants as [
        (typeof cream.variants)[number],
        (typeof cream.variants)[number],
      ];
      const serum = await k.product('serum', [120_000]);
      await rename(serum.id, 'Tinh chất Đặng', 'Dang serum');
      const sv = serum.variants[0]!;
      const draft = await k.product('draft', [90_000], { publish: false });
      await k.receive(v50.id, 5);
      await k.receive(sv.id, 2);
      const names = (response: { products: { variantId: string }[] }) =>
        response.products.map((product) => product.variantId);

      await suite.test(
        'authority: SELL_PRODUCTS at this branch only; a bad branch or an over-long search is refused',
        async () => {
          await fails(() => invoices.productOptions(people.nobody.token, A.id, {}), 'FORBIDDEN');
          await fails(
            () => invoices.productOptions(people.otherBranch.token, A.id, {}),
            'FORBIDDEN',
          );
          await fails(
            () => invoices.productOptions(people.plainCashier.token, A.id, {}),
            'FORBIDDEN',
          );
          await fails(
            () => invoices.productOptions(people.ktv.token, randomUUID(), {}),
            'NOT_FOUND',
          );
          await fails(
            () => invoices.productOptions(people.ktv.token, A.id, { q: 'x'.repeat(81) }),
            'VALIDATION_FAILED',
            'q',
          );
          assert.ok((await options(people.ktv, A.id)).products.length > 0);
          // The other branch's seller reads their own branch.
          assert.deepEqual(
            (await options(people.otherBranch, B.id)).defaultSellerId,
            people.otherBranch.id,
          );
        },
      );

      await suite.test(
        'the search folds case and diacritics and matches the name, the variant label and the SKU; unsellable variants never appear',
        async () => {
          assert.deepEqual(
            new Set(names(await options(people.cashier, A.id, 'kem duong'))),
            new Set([v50.id, v100.id]),
          );
          assert.deepEqual(names(await options(people.cashier, A.id, 'DANG')), [sv.id]);
          assert.deepEqual(names(await options(people.cashier, A.id, 'tinh chat dang')), [sv.id]);
          // A variant label, a SKU, two words in any order.
          await tx.productVariant.update({
            where: { id: v100.id },
            data: { labelVi: 'Cỡ lớn', labelEn: 'Large', rowVersion: { increment: 1 } },
          });
          assert.deepEqual(names(await options(people.cashier, A.id, 'co lon')), [v100.id]);
          const bySku = await options(people.cashier, A.id, v50.sku.toLowerCase());
          assert.deepEqual(names(bySku), [v50.id]);
          assert.deepEqual(
            names(await options(people.cashier, A.id, 'da kem')).sort(),
            [v50.id, v100.id].sort(),
          );
          assert.deepEqual(names(await options(people.cashier, A.id, 'khong co that')), []);
          // A % or _ typed by the cashier is a letter, not a wildcard.
          assert.deepEqual(names(await options(people.cashier, A.id, '%')), []);
          // A draft product is not for sale.
          const all = names(await options(people.cashier, A.id));
          assert.ok(!all.includes(draft.variants[0]!.id));
        },
      );

      await suite.test(
        'the price is the effective price now and the availability is the one of this branch, reservations and promotions included',
        async () => {
          await k.promote(sv.id, 100_000);
          const response = await options(people.cashier, A.id, 'dang');
          const serumOption = response.products[0]!;
          assert.deepEqual(
            [serumOption.unitPriceVnd, serumOption.listPriceVnd, serumOption.onPromotion],
            ['100000', '120000', true],
          );
          assert.equal(serumOption.available, 2);
          assert.equal(serumOption.sku, sv.sku);
          // A held unit is not available to the next cashier; a variant never received reads 0 ("Hết hàng") and comes last.
          const sale = await k.finalize(
            await k.addLine(await k.openSale(people.cashier), sv.id, 1),
          );
          assert.equal((await options(people.cashier, A.id, 'dang')).products[0]!.available, 1);
          const all = await options(people.cashier, A.id);
          const empty = all.products.find((product) => product.variantId === v100.id)!;
          assert.equal(empty.available, 0);
          const order = all.products.map((product) => product.available > 0);
          assert.deepEqual(
            order,
            [...order].sort((a, b) => Number(b) - Number(a)),
            'in stock first',
          );
          // Another branch has none of it.
          assert.equal((await options(people.otherBranch, B.id, 'dang')).products[0]!.available, 0);
          // Cancel the sale: the unit is back.
          await k.ok(() =>
            invoices.cancel(people.boss.token, sale.id, {
              expectedVersion: sale.version,
              reason: 'Khách đổi ý',
            }),
          );
          assert.equal((await options(people.cashier, A.id, 'dang')).products[0]!.available, 2);
          // The response never carries the cost, a lot, a supplier or another branch's stock.
          const text = JSON.stringify(await options(people.cashier, A.id));
          for (const word of ['cost', 'lot', 'supplier', 'onHand', 'reserved']) {
            assert.ok(!text.toLowerCase().includes(word.toLowerCase()), word);
          }
          await k.reconcile();
        },
      );

      await suite.test(
        'sellers: the active staff assigned to this branch by name; the default is the caller, or nobody for an Owner without an assignment',
        async () => {
          const response = await options(people.cashier, A.id);
          const ids = response.sellers.map((seller) => seller.id);
          assert.ok(ids.includes(people.cashier.id));
          assert.ok(ids.includes(people.ktv.id));
          assert.ok(!ids.includes(people.otherBranch.id), 'assigned to the other branch');
          assert.equal(response.defaultSellerId, people.cashier.id);
          assert.deepEqual(
            response.sellers.map((seller) => seller.displayName),
            [...response.sellers.map((seller) => seller.displayName)].sort((a, b) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
            'by name',
          );
          // An inactive employee is not offered.
          await tx.user.update({ where: { id: people.ktv.id }, data: { status: 'INACTIVE' } });
          const after = await options(people.cashier, A.id);
          assert.ok(!after.sellers.some((seller) => seller.id === people.ktv.id));
          await tx.user.update({ where: { id: people.ktv.id }, data: { status: 'ACTIVE' } });
          // The Owner has no branch assignment: they must choose.
          const owner = await k.ok(() => invoices.productOptions(people.owner.token, A.id, {}));
          assert.equal(owner.defaultSellerId, null);
          assert.ok(owner.sellers.length > 0);
        },
      );

      await suite.test(
        'the member sees name, quantity and price of a product line and never the seller, SKU, cost, lots or stock; a product-only invoice is not a visit',
        async () => {
          await k.receive(v50.id, 20);
          const buyer = await k.customer('buyer');
          let draftSale = await k.addLine(
            await k.openSale(people.cashier, buyer.id),
            v50.id,
            2,
            people.ktv.id,
          );
          draftSale = await k.addLine(draftSale, sv.id, 1, people.boss.id);
          const sale = await k.finalize(draftSale);
          await k.pay(sale.id, Number(sale.totalVnd));
          const view = await customerInvoiceDetail(tx, buyer.id, sale.id);
          assert.equal(view.kind, 'PRODUCT_SALE');
          assert.equal(view.lines.length, 2);
          for (const line of view.lines) {
            assert.deepEqual(Object.keys(line).sort(), [
              'forSelf',
              'grossVnd',
              'nameEn',
              'nameVi',
              'pricingUnit',
              'quantity',
              'recipientName',
              'sequence',
              'unitPriceVnd',
            ]);
          }
          assert.deepEqual(
            view.lines.map((line) => [
              line.nameVi,
              line.quantity,
              line.unitPriceVnd,
              line.grossVnd,
            ]),
            sale.productLines.map((line) => [
              line.nameVi,
              line.quantity,
              line.unitPriceVnd,
              line.grossVnd,
            ]),
          );
          // The serialized view, not just the screen: no seller (id or name), SKU, cost, lot or stock figure appears in it.
          const text = JSON.stringify(view);
          for (const secret of [
            people.ktv.id,
            people.boss.id,
            people.cashier.id,
            v50.sku,
            sv.sku,
            'seller',
            'sku',
            'cost',
            'lot',
            'stock',
            'onHand',
            'reserved',
            'supplier',
          ]) {
            assert.ok(!text.includes(secret), secret);
          }
          // It is a sale, not a visit: the date is the business date, and it is listed with its kind.
          assert.equal(view.visitDate, view.businessDate);
          const list = await customerInvoiceList(tx, buyer.id, undefined);
          assert.deepEqual(
            list.invoices.map((invoice) => [invoice.id, invoice.kind]),
            [[sale.id, 'PRODUCT_SALE']],
          );
          // A mixed visit invoice keeps the exact shape of its service lines and marks only the product line.
          const payer = await k.customer('mixed');
          let visitDraft = await k.serviceDraft([k.exact], payer.id);
          visitDraft = await k.addLine(visitDraft, v50.id, 1, people.ktv.id);
          const mixed = await k.finalize(visitDraft);
          const mixedView = await customerInvoiceDetail(tx, payer.id, mixed.id);
          assert.equal(mixedView.kind, 'VISIT');
          const serviceLine = mixedView.lines.find(
            (line) => !mixedView.productSequences?.includes(line.sequence),
          )!;
          assert.deepEqual(Object.keys(serviceLine).sort(), [
            'forSelf',
            'grossVnd',
            'nameEn',
            'nameVi',
            'pricingUnit',
            'quantity',
            'recipientName',
            'sequence',
            'unitPriceVnd',
          ]);
          assert.equal(mixedView.productSequences?.length, 1);
          assert.deepEqual(view.productSequences, [1, 2]);
          assert.ok(!JSON.stringify(mixedView).includes(people.ktv.id));
          // Another member, a guest payer and a stranger see nothing of it.
          const stranger = await k.customer('stranger');
          await fails(() => customerInvoiceDetail(tx, stranger.id, sale.id), 'NOT_FOUND');
          await k.reconcile();
        },
      );

      await suite.test(
        'the board lists a product invoice with its units and sellers; every other invoice keeps its exact shape',
        async () => {
          await k.receive(v50.id, 10);
          const sale = await k.finalize(
            await k.addLine(
              await k.addLine(await k.openSale(people.cashier), v50.id, 2, people.ktv.id),
              sv.id,
              1,
              people.boss.id,
            ),
          );
          const service = await k.serviceDraft([k.exact]);
          const board = await invoices.board(people.cashier.token, A.id, undefined);
          const entry = board.invoices.find((invoice) => invoice.id === sale.id)!;
          assert.equal(entry.kind, 'PRODUCT_SALE');
          assert.equal(entry.visitId, null);
          assert.equal(entry.comboName, null);
          const names = (
            await tx.user.findMany({
              where: { id: { in: [people.ktv.id, people.boss.id] } },
              select: { fullName: true },
            })
          )
            .map((user) => user.fullName)
            .sort((a, b) => a.localeCompare(b, 'vi'));
          assert.deepEqual(entry.products, { lines: 2, quantity: 3, sellers: names });
          const plain = board.invoices.find((invoice) => invoice.id === service.id)!;
          assert.equal('products' in plain, false, 'a service invoice has no product figures');
          assert.equal(board.canSellProducts, true);
          assert.equal(
            (await invoices.board(people.plainCashier.token, A.id, undefined)).canSellProducts,
            false,
          );
          await k.reconcile();
        },
      );

      await suite.test(
        'more matches than the page: the first twenty, in stock first, and the response says there are more',
        async () => {
          for (let index = 0; index < 22; index += 1) {
            const extra = await k.product(`bulk${index}`, [10_000 + index]);
            await rename(extra.id, `Hàng loạt ${String(index).padStart(2, '0')}`, `Bulk ${index}`);
          }
          const response = await options(people.cashier, A.id, 'hang loat');
          assert.equal(response.products.length, 20);
          assert.equal(response.truncated, true);
          const narrow = await options(people.cashier, A.id, 'hang loat 07');
          assert.equal(narrow.products.length, 1);
          assert.equal(narrow.truncated, false);
        },
      );
    });
  },
);
