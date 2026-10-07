import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { InvoiceResponse } from '@lucy-spa/contracts';
import {
  INVENTORY_CONSUMER,
  INVENTORY_EVENT_TYPES,
  processInventoryEvent,
  relayInventoryEvents,
} from '@lucy-spa/server';
import { InventoryService } from '../inventory/inventory.service.js';
import { InvoiceService } from '../pos/invoice.service.js';
import { validVnMobile } from './phone.js';
import type { Phase6Kit } from './phase6-fixture.js';

/** The stock facts of one invoice line (see `saleOf`). */
export interface SaleFacts {
  status: 'RESERVED' | 'CONSUMED' | 'RELEASED';
  consumedPaidSeq: number | null;
  movements: {
    kind: string;
    delta: number;
    paidSeq: number | null;
    lot: string;
    actor: string;
    key: string;
  }[];
  net: number;
}

export interface Service {
  id: string;
  code: string;
  nameVi: string;
  nameEn: string;
  priceVnd: bigint;
  priceMaxVnd: bigint;
  pricingUnit: 'PER_SERVICE' | 'PER_NAIL';
  maxQuantity: number;
}

/**
 * Fixtures for the Phase 6 P6-8 suites on top of the Phase 6 kit (one rolled-back transaction): published products with priced
 * variants, received stock, completed visits with performed services, members, and the reconciliation every test ends with. Test
 * fixture only.
 */
export async function productSaleKit(kit: Phase6Kit) {
  const { tx, run } = kit;
  const invoices = new InvoiceService(kit.adapter, kit.throttle, kit.environment);
  const inventory = new InventoryService(kit.adapter, kit.throttle, kit.environment);
  const A = await kit.branch('A');
  const B = await kit.branch('B');
  const settle = async () => {
    await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
    await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
  };
  /** Runs a command and forces the deferred database checks, as a commit would. */
  const ok = async <T>(work: () => Promise<T>): Promise<T> => {
    const result = await work();
    await settle();
    return result;
  };

  // ------------------------------------------------------------------------------------------------ people
  const POS = ['VIEW_INVOICES', 'MANAGE_INVOICES', 'COLLECT_PAYMENTS', 'APPLY_DISCOUNTS'] as const;
  const people = {
    /** May sell and nothing else (a KTV). */
    ktv: await kit.staff(['SELL_PRODUCTS'], { branchId: A.id }),
    cashier: await kit.staff(['SELL_PRODUCTS', ...POS], { branchId: A.id }),
    boss: await kit.staff(['SELL_PRODUCTS', ...POS, 'CANCEL_INVOICES', 'CORRECT_PAYMENTS'], {
      branchId: A.id,
    }),
    /** Cashier of a service-only counter: no SELL_PRODUCTS at all. */
    plainCashier: await kit.staff([...POS, 'CANCEL_INVOICES'], { branchId: A.id }),
    receiver: await kit.staff(['MANAGE_STOCK_RECEIPTS', 'ADJUST_STOCK', 'VIEW_INVENTORY'], {
      branchId: A.id,
    }),
    otherBranch: await kit.staff(['SELL_PRODUCTS', 'VIEW_INVOICES', 'MANAGE_INVOICES'], {
      branchId: B.id,
    }),
    nobody: await kit.staff([]),
    owner: { id: '', token: kit.ownerToken },
  };
  people.owner.id = (await tx.user.findFirstOrThrow({ where: { kind: 'OWNER' } })).id;

  let customerNo = 0;
  const customer = async (label = 'khach'): Promise<{ id: string; fullName: string }> => {
    customerNo += 1;
    const user = await tx.user.create({
      data: {
        kind: 'CUSTOMER',
        status: 'ACTIVE',
        fullName: `Khách ${label} ${customerNo}`,
        preferredLocale: 'vi',
        emailCanonical: `p68-${label}-${customerNo}-${run.toLowerCase()}@example.com`,
        emailDelivery: `p68-${label}-${customerNo}-${run.toLowerCase()}@example.com`,
        emailVerifiedAt: new Date(),
        phoneCanonical: validVnMobile(),
        normalizationVersion: 1,
        passwordHash: '$argon2id$fixture',
        customerProfile: { create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' } },
      },
    });
    return { id: user.id, fullName: user.fullName };
  };

  // ----------------------------------------------------------------------------------------------- catalog
  let productNo = 0;
  /** A published product with one priced variant per entry (list price in VND). */
  const product = async (
    label: string,
    prices: number[],
    options: { publish?: boolean } = {},
  ): Promise<{ id: string; variants: { id: string; sku: string }[] }> => {
    productNo += 1;
    const created = await tx.product.create({
      data: {
        code: `p68-${label}-${productNo}-${run.toLowerCase()}`,
        nameVi: `Sản phẩm ${label}`,
        nameEn: `Product ${label}`,
        createdByUserId: people.cashier.id,
        variants: {
          create: prices.map((_, index) => ({
            sku: `P68-${run}-${label}-${index}`.toUpperCase(),
            labelVi: prices.length > 1 ? `Loại ${index + 1}` : null,
            labelEn: prices.length > 1 ? `Type ${index + 1}` : null,
            sortOrder: index,
          })),
        },
      },
      include: { variants: true },
    });
    const variants = [...created.variants].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const [index, variant] of variants.entries()) {
      await tx.productPriceVersion.create({
        data: {
          variantId: variant.id,
          versionNo: 1,
          listPriceVnd: BigInt(prices[index]!),
          createdByUserId: people.cashier.id,
        },
      });
    }
    if (options.publish !== false) {
      await tx.product.update({
        where: { id: created.id },
        data: { status: 'PUBLISHED', rowVersion: { increment: 1 } },
      });
    }
    return { id: created.id, variants: variants.map(({ id, sku }) => ({ id, sku })) };
  };
  /** A new list price version for a variant. */
  const reprice = async (variantId: string, listPriceVnd: number) => {
    const latest = await tx.productPriceVersion.findFirstOrThrow({
      where: { variantId },
      orderBy: { versionNo: 'desc' },
    });
    await tx.productPriceVersion.create({
      data: {
        variantId,
        versionNo: latest.versionNo + 1,
        listPriceVnd: BigInt(listPriceVnd),
        createdByUserId: people.cashier.id,
      },
    });
  };
  const promote = async (variantId: string, promoPriceVnd: number): Promise<{ id: string }> =>
    tx.productPromotion.create({
      select: { id: true },
      data: {
        variantId,
        promoPriceVnd: BigInt(promoPriceVnd),
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 3_600_000),
        createdByUserId: people.cashier.id,
      },
    });
  const day = async () =>
    (
      await tx.$queryRawUnsafe<{ d: string }[]>(
        `SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS d`,
      )
    )[0]!.d;
  /** Receives stock at a branch through the receipt workflow (a movement, a lot and the level). */
  const receive = async (variantId: string, quantity: number, branchId = A.id) => {
    const draft = await inventory.createReceipt(people.receiver.token, {
      branchId,
      supplierId: null,
      receiptDate: await day(),
      notes: null,
      lines: [{ variantId, quantity, lotCode: null, expiryDate: null }],
    });
    return inventory.confirmReceipt(people.receiver.token, draft.id, {
      expectedRowVersion: draft.rowVersion,
    });
  };
  const levelOf = async (
    variantId: string,
    branchId = A.id,
  ): Promise<{ onHand: number; reserved: number } | null> =>
    tx.stockLevel.findUnique({
      where: { branchId_variantId: { branchId, variantId } },
      select: { onHand: true, reserved: true },
    });
  const availableOf = async (variantId: string, branchId = A.id) =>
    (
      await tx.$queryRaw<
        { available: number }[]
      >`SELECT lucy_available_stock(${branchId}::uuid, ${variantId}::uuid) AS available`
    )[0]!.available;

  // ------------------------------------------------------------------------------------ visits and services
  const category = await tx.serviceCategory.create({
    data: { code: `P68_${run}`, nameVi: 'Nhóm', nameEn: 'Group' },
  });
  const makeService = (key: string, min: bigint, max: bigint): Promise<Service> =>
    tx.service.create({
      data: {
        code: `P68_${key}_${run}`,
        categoryId: category.id,
        nameVi: `Dịch vụ ${key}`,
        nameEn: `Service ${key}`,
        priceVnd: min,
        priceMaxVnd: max,
        pricingUnit: 'PER_SERVICE',
        maxQuantity: 1,
        durationMinutes: 10,
        estimatedMinMinutes: 10,
        estimatedMaxMinutes: 10,
      },
    });
  const exact = await makeService('EXACT', 200_000n, 200_000n);
  const ranged = await makeService('RANGED', 100_000n, 150_000n);
  let visitNo = 0;
  let slot = 0;
  /** A COMPLETED visit whose services were performed (DONE), ready to be invoiced. */
  const completedVisit = async (
    services: Service[],
    ownerUserId: string | null = null,
  ): Promise<{ id: string; code: string }> => {
    visitNo += 1;
    const visit = await tx.visit.create({
      data: {
        code: `VS-P68-${run}-${visitNo}`,
        branchId: A.id,
        origin: 'WALK_IN',
        ownerUserId,
        serviceDate: new Date('2027-03-01T00:00:00.000Z'),
        arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
        createdByUserId: people.cashier.id,
        idempotencyKey: randomUUID(),
      },
    });
    const participant = await tx.visitParticipant.create({
      data: { visitId: visit.id, kind: 'GUEST', displayName: 'Khách lẻ' },
    });
    const lines: string[] = [];
    for (const [index, service] of services.entries()) {
      slot += 1;
      const start = new Date(
        new Date('2027-03-01T00:00:00+07:00').getTime() + (6 * 60 + 10 * slot) * 60_000,
      );
      const line = await tx.visitServiceLine.create({
        data: {
          visitId: visit.id,
          participantId: participant.id,
          sequence: index + 1,
          serviceId: service.id,
          employeeUserId: people.ktv.id,
          assignmentMode: 'ANY',
          plannedStartAt: start,
          plannedEndAt: new Date(start.getTime() + 10 * 60_000),
          durationMinutes: 10,
          bufferMinutes: 0,
          serviceCode: service.code,
          serviceNameVi: service.nameVi,
          serviceNameEn: service.nameEn,
          catalogPriceMinVnd: service.priceVnd,
          catalogPriceMaxVnd: service.priceMaxVnd,
          catalogPricingUnit: service.pricingUnit,
          maxQuantitySnapshot: service.maxQuantity,
        },
      });
      lines.push(line.id);
    }
    for (const [index, id] of lines.entries()) {
      const started = new Date('2027-03-01T06:00:00+07:00');
      await tx.visitServiceLine.update({
        where: { id },
        data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
      });
      if (index === 0) {
        await tx.visit.update({
          where: { id: visit.id },
          data: { status: 'IN_SERVICE', rowVersion: { increment: 1 } },
        });
      }
      const execution = await tx.serviceExecution.create({
        data: {
          visitServiceLineId: id,
          employeeUserId: people.ktv.id,
          startedAt: started,
          expectedEndAt: new Date(started.getTime() + 10 * 60_000),
        },
      });
      await tx.serviceExecution.update({
        where: { id: execution.id },
        data: {
          status: 'ENDED',
          endedAt: new Date(started.getTime() + 10 * 60_000),
          endKind: 'NORMAL',
          endedByUserId: people.ktv.id,
          rowVersion: { increment: 1 },
        },
      });
      await tx.visitServiceLine.update({
        where: { id },
        data: { status: 'DONE', rowVersion: { increment: 1 } },
      });
    }
    await tx.visit.update({
      where: { id: visit.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date('2027-03-01T07:00:00+07:00'),
        rowVersion: { increment: 1 },
      },
    });
    return { id: visit.id, code: visit.code };
  };
  /** A service-only draft with every line priced at its minimum. */
  const serviceDraft = async (services: Service[] = [exact], ownerUserId: string | null = null) => {
    const visit = await completedVisit(services, ownerUserId);
    let current = (await ok(() => invoices.open(people.cashier.token, visit.id))).invoice;
    for (const line of current.lines) {
      if (line.unitPriceVnd !== null && line.quantity !== null) continue;
      current = await ok(() =>
        invoices.setPrice(people.cashier.token, current.id, line.id, {
          expectedVersion: current.version,
          unitPriceVnd: line.priceMinVnd,
        }),
      );
    }
    return current;
  };

  // ------------------------------------------------------------------------------------------ product sales
  const openSale = async (
    actor: { token: string } = people.cashier,
    payerUserId: string | null = null,
  ): Promise<InvoiceResponse> =>
    (await ok(() => invoices.openProductSale(actor.token, A.id, { payerUserId }))).invoice;
  const addLine = (
    invoice: InvoiceResponse,
    variantId: string,
    quantity: number,
    sellerUserId?: string,
    actor: { token: string } = people.cashier,
  ): Promise<InvoiceResponse> =>
    ok(() =>
      invoices.addProductLine(actor.token, invoice.id, {
        expectedVersion: invoice.version,
        variantId,
        quantity,
        ...(sellerUserId === undefined ? {} : { sellerUserId }),
      }),
    );
  const finalize = (invoice: InvoiceResponse, actor: { token: string } = people.cashier) =>
    ok(() => invoices.finalize(actor.token, invoice.id, { expectedVersion: invoice.version }));
  const pay = (
    invoiceId: string,
    amount: number | string,
    actor: { token: string } = people.cashier,
  ) =>
    ok(() =>
      invoices.recordPayment(actor.token, invoiceId, {
        method: 'CASH',
        amountVnd: String(amount),
        tenderedVnd: String(amount),
        idempotencyKey: randomUUID(),
      }),
    );

  // ------------------------------------------------------------------------------- stock sales (P6-10)
  /**
   * Handles the pending `inventory` events of one invoice (or of all), oldest first, one at a time, forcing the deferred database
   * checks after each as a commit would. Returns the outcome of each event.
   */
  const runInventory = async (invoiceId?: string): Promise<string[]> => {
    const events = await tx.outboxEvent.findMany({
      where: {
        aggregateType: 'Invoice',
        eventType: { in: INVENTORY_EVENT_TYPES },
        ...(invoiceId ? { aggregateId: invoiceId } : {}),
        consumptions: { none: { consumer: INVENTORY_CONSUMER } },
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const outcomes: string[] = [];
    for (const event of events) {
      outcomes.push(await processInventoryEvent(tx, event.id));
      await settle();
    }
    return outcomes;
  };
  /** The production relay (its own selection of events) over the fixture transaction. */
  const relayInventory = async (): Promise<string[]> => {
    const outcomes: string[] = [];
    const database = {
      $queryRaw: tx.$queryRaw.bind(tx),
      $transaction: async <T>(work: (client: typeof tx) => Promise<T>) => {
        const result = await work(tx);
        await settle();
        return result;
      },
    };
    await relayInventoryEvents(
      database as never,
      new Map(),
      (outcome) => outcomes.push(outcome),
      (error) => {
        throw error;
      },
    );
    return outcomes;
  };
  /** The stock facts of one invoice line: its reservation and the net of its sale movements. */
  const saleOf = async (invoiceLineId: string): Promise<SaleFacts> => {
    const reservation = await tx.stockReservation.findUniqueOrThrow({
      where: { invoiceLineId },
      select: { status: true, consumedPaidSeq: true, quantity: true },
    });
    const movements = await tx.stockMovement.findMany({
      where: { invoiceLineId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        kind: true,
        quantityDelta: true,
        paidSeq: true,
        lot: { select: { lotCode: true } },
        actorUserId: true,
        idempotencyKey: true,
      },
    });
    return {
      status: reservation.status as SaleFacts['status'],
      consumedPaidSeq: reservation.consumedPaidSeq,
      movements: movements.map((movement) => ({
        kind: String(movement.kind),
        delta: movement.quantityDelta,
        paidSeq: movement.paidSeq,
        lot: movement.lot.lotCode,
        actor: movement.actorUserId,
        key: movement.idempotencyKey,
      })),
      net: movements.reduce((sum, movement) => sum + movement.quantityDelta, 0),
    };
  };

  // ------------------------------------------------------------------------------------- reconciliation
  /**
   * The Owner's reconciliation rules over the whole fixture: every invoice's lines add up to its subtotal, the total is
   * subtotal - discount + shipping fee, a level's on-hand is the sum of its movements and of its lots, its reserved quantity is the
   * sum of its open reservations and never exceeds the on-hand, and a finalized invoice holds one reservation per product line.
   */
  const reconcile = async () => {
    const invoiceRows = await tx.$queryRaw<
      {
        id: string;
        status: string;
        dropped: string | null;
        subtotal: bigint;
        discount: bigint;
        fee: bigint;
        total: bigint;
        lines: bigint;
        product_lines: bigint;
        reservations: bigint;
        open: bigint;
      }[]
    >`
      SELECT i.id, i.status::text AS status, i.cancelled_from_status::text AS dropped, i.subtotal_vnd AS subtotal, i.discount_total_vnd AS discount,
             i.shipping_fee_vnd AS fee, i.total_vnd AS total,
             COALESCE((SELECT sum(l.gross_vnd) FROM invoice_lines l WHERE l.invoice_id = i.id), 0)::bigint AS lines,
             (SELECT count(*) FROM invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'PRODUCT') AS product_lines,
             (SELECT count(*) FROM stock_reservations r WHERE r.invoice_id = i.id) AS reservations,
             (SELECT count(*) FROM stock_reservations r WHERE r.invoice_id = i.id AND r.status = 'RESERVED') AS open
      FROM invoices i WHERE i.branch_id IN (${A.id}::uuid, ${B.id}::uuid)`;
    for (const row of invoiceRows) {
      assert.equal(row.total, row.subtotal - row.discount + row.fee, `total of ${row.id}`);
      if (row.status !== 'DRAFT') assert.equal(row.lines, row.subtotal, `lines of ${row.id}`);
      if (row.status === 'DRAFT' || row.dropped === 'DRAFT') {
        assert.equal(row.reservations, 0n, `draft ${row.id} holds stock`);
      } else {
        assert.equal(row.reservations, row.product_lines, `reservations of ${row.id}`);
        if (row.status === 'CANCELLED')
          assert.equal(row.open, 0n, `cancelled ${row.id} holds stock`);
      }
    }
    const levels = await tx.$queryRaw<
      {
        variant: string;
        branch: string;
        on_hand: number;
        reserved: number;
        moved: bigint;
        lots: bigint;
        held: bigint;
      }[]
    >`
      SELECT s.variant_id AS variant, s.branch_id AS branch, s.on_hand, s.reserved,
             COALESCE((SELECT sum(m.quantity_delta) FROM stock_movements m
                       WHERE m.branch_id = s.branch_id AND m.variant_id = s.variant_id), 0)::bigint AS moved,
             COALESCE((SELECT sum(l.quantity_on_hand) FROM inventory_lots l
                       WHERE l.branch_id = s.branch_id AND l.variant_id = s.variant_id), 0)::bigint AS lots,
             COALESCE((SELECT sum(r.quantity) FROM stock_reservations r
                       WHERE r.branch_id = s.branch_id AND r.variant_id = s.variant_id AND r.status = 'RESERVED'), 0)::bigint AS held
      FROM stock_levels s WHERE s.branch_id IN (${A.id}::uuid, ${B.id}::uuid)`;
    for (const level of levels) {
      assert.equal(BigInt(level.on_hand), level.moved, `on hand = movements of ${level.variant}`);
      assert.equal(BigInt(level.on_hand), level.lots, `on hand = lots of ${level.variant}`);
      assert.equal(
        BigInt(level.reserved),
        level.held,
        `reserved = open reservations of ${level.variant}`,
      );
      assert.ok(level.reserved <= level.on_hand, `reserved <= on hand of ${level.variant}`);
    }
    // P6-10: a consumed reservation has sold exactly its quantity (and belongs to a paid episode that has begun), every other
    // reservation has sold nothing; a reservation of a cancelled invoice is released.
    const sales = await tx.$queryRaw<
      {
        line: string;
        status: string;
        quantity: number;
        consumed_paid_seq: number | null;
        net: bigint;
        invoice_status: string;
        paid_seq: number;
      }[]
    >`
      SELECT r.invoice_line_id AS line, r.status::text AS status, r.quantity, r.consumed_paid_seq,
             COALESCE((SELECT sum(m.quantity_delta) FROM stock_movements m
                       WHERE m.invoice_line_id = r.invoice_line_id AND m.kind IN ('SALE', 'SALE_REVERSAL')), 0)::bigint AS net,
             i.status::text AS invoice_status, i.paid_seq
      FROM stock_reservations r JOIN invoices i ON i.id = r.invoice_id
      WHERE r.branch_id IN (${A.id}::uuid, ${B.id}::uuid)`;
    for (const sale of sales) {
      assert.equal(
        sale.net,
        sale.status === 'CONSUMED' ? -BigInt(sale.quantity) : 0n,
        `sale movements of line ${sale.line}`,
      );
      if (sale.status === 'CONSUMED') {
        assert.ok(
          sale.consumed_paid_seq !== null && sale.consumed_paid_seq <= sale.paid_seq,
          `consumed episode of ${sale.line}`,
        );
        assert.notEqual(sale.invoice_status, 'CANCELLED', `cancelled invoice sold ${sale.line}`);
      } else {
        assert.equal(sale.consumed_paid_seq, null);
      }
    }
  };

  return {
    A,
    B,
    invoices,
    inventory,
    people,
    customer,
    product,
    reprice,
    promote,
    receive,
    levelOf,
    availableOf,
    exact,
    ranged,
    completedVisit,
    serviceDraft,
    openSale,
    addLine,
    finalize,
    pay,
    settle,
    ok,
    day,
    runInventory,
    relayInventory,
    saleOf,
    reconcile,
  };
}

export type ProductSaleKit = Awaited<ReturnType<typeof productSaleKit>>;
