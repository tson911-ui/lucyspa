import {
  PRODUCT_RETURN_MAX_PHOTOS,
  PRODUCT_RETURN_PAGE_SIZE,
  parseNotificationParams,
  type ProductReturnCaseResponse,
  type ProductReturnContextResponse,
  type ProductReturnListResponse,
  type ProductReturnLookupResponse,
  type ProductReturnOutcomeName,
  type ProductReturnReasonName,
  type ProductReturnStatusName,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import * as input from '../inventory/inventory.input.js';
import * as parse from './return.input.js';
import {
  canDecideAt,
  canManageAt,
  canViewAt,
  holdsGraphAt,
  requireDecide,
  requireManage,
  requireView,
} from './return.access.js';
import { RETURN_REASONS, hasQualifyingPhoto, windowEndsAt, windowStatus } from './return.rules.js';

/**
 * Phase 6 P6-12: product return cases (design 8.1, T23, T35, OQ-22, OQ-79). A case records one claim about ONE product line of a PAID
 * counter invoice; it moves no money and no stock. Every command decides its authority inside its transaction, at the invoice's
 * branch. Lock order (design 10.2): the invoice row, then the case row (the line row is locked by the database guard when a case is
 * inserted). Nothing is deleted or edited: notes, photos and decisions are appended as events, and the facts of a case never change
 * (the database refuses it). The window clock is the invoice's paid time, compared with the database clock.
 */
type Tx = Prisma.TransactionClient;

export const RETURN_LIMITS = Object.freeze({ noteMax: 1000, requestNoteMax: 1000, searchMax: 100 });
const OPEN_KEYS = [
  'branchId',
  'invoiceLineId',
  'reason',
  'requestedOutcome',
  'quantity',
  'sealIntact',
  'notes',
  'clientRequestId',
] as const;
const STATUSES = ['OPEN', 'ACCEPTED', 'DECLINED', 'CANCELLED'] as const;
const OUTCOMES = ['EXCHANGE', 'REFUND'] as const;

const pick = <T extends string>(value: unknown, allowed: readonly T[], field: string): T => {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value as T;
};

const requiredNote = (value: unknown, field: string): string =>
  parse.requiredNote(value, field, RETURN_LIMITS.noteMax);

async function branchOf(tx: Tx, branchId: string) {
  const branch = await tx.branch.findFirst({
    where: { id: branchId, isActive: true },
    select: { id: true, code: true, name: true },
  });
  if (!branch) throw new AuthError('NOT_FOUND');
  return branch;
}

async function lockInvoice(tx: Tx, invoiceId: string, exclusive: boolean): Promise<void> {
  if (exclusive)
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId}::uuid FOR SHARE`;
}

async function lockCase(tx: Tx, caseId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM product_return_cases WHERE id = ${caseId}::uuid FOR UPDATE`;
}

// ------------------------------------------------------------------------------------------------- reads

export async function returnContext(context: AdminContext): Promise<ProductReturnContextResponse> {
  const branches = await context.tx.branch.findMany({
    where: { isActive: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, name: true },
  });
  const graph = context.actor.graph;
  return {
    branches: branches
      .map((branch) => ({
        ...branch,
        manage: canManageAt(graph, branch.id),
        decide: holdsGraphAt(graph, 'REFUND_PRODUCTS', branch.id),
      }))
      .filter((branch) => branch.manage || branch.decide),
    owner: context.actor.owner,
  };
}

/** The product lines of a paid counter invoice found by its exact code, with what can still be returned. */
export async function lookupInvoice(
  context: AdminContext,
  branchId: string,
  invoiceCode: unknown,
): Promise<ProductReturnLookupResponse> {
  requireManage(context, branchId);
  await branchOf(context.tx, branchId);
  const code = input.line(invoiceCode, 'invoiceCode', 40);
  const invoice = await context.tx.invoice.findFirst({
    where: { branchId, code: { equals: code, mode: 'insensitive' } },
    select: {
      id: true,
      code: true,
      status: true,
      channel: true,
      paidAt: true,
      payer: { select: { fullName: true } },
      lines: {
        where: { kind: 'PRODUCT' },
        orderBy: { sequence: 'asc' },
        select: {
          id: true,
          sequence: true,
          quantity: true,
          productDetails: {
            select: {
              sku: true,
              productNameVi: true,
              productNameEn: true,
              variantLabelVi: true,
              variantLabelEn: true,
            },
          },
        },
      },
    },
  });
  if (!invoice) throw new AuthError('NOT_FOUND');
  if (invoice.status !== 'PAID' || invoice.paidAt === null || invoice.channel !== 'COUNTER') {
    throw new AuthError('RETURN_NOT_ELIGIBLE');
  }
  const paidAt = invoice.paidAt;
  const claimed = await context.tx.productReturnCase.groupBy({
    by: ['invoiceLineId'],
    where: { invoiceId: invoice.id, status: { in: ['OPEN', 'ACCEPTED'] } },
    _sum: { quantity: true },
  });
  const claimedBy = new Map(claimed.map((row) => [row.invoiceLineId, row._sum.quantity ?? 0]));
  return {
    invoice: {
      id: invoice.id,
      code: invoice.code,
      paidAt: paidAt.toISOString(),
      customerName: invoice.payer?.fullName ?? null,
    },
    lines: invoice.lines.flatMap((line) => {
      const detail = line.productDetails[0];
      if (!detail || line.quantity === null) return [];
      const claimedQuantity = claimedBy.get(line.id) ?? 0;
      return [
        {
          lineId: line.id,
          sequence: line.sequence,
          sku: detail.sku,
          productNameVi: detail.productNameVi,
          productNameEn: detail.productNameEn,
          variantLabelVi: detail.variantLabelVi,
          variantLabelEn: detail.variantLabelEn,
          quantity: line.quantity,
          claimedQuantity,
          availableQuantity: Math.max(0, line.quantity - claimedQuantity),
          reasons: Object.fromEntries(
            RETURN_REASONS.map((reason) => [reason, windowStatus(reason, paidAt, context.now)]),
          ) as ProductReturnLookupResponse['lines'][number]['reasons'],
        },
      ];
    }),
  };
}

export async function listCases(
  context: AdminContext,
  query: {
    branchId: string;
    status?: unknown;
    reason?: unknown;
    q?: unknown;
    page?: number | undefined;
  },
): Promise<ProductReturnListResponse> {
  requireView(context, query.branchId);
  await branchOf(context.tx, query.branchId);
  const status =
    query.status === undefined || query.status === ''
      ? undefined
      : pick<ProductReturnStatusName>(query.status, STATUSES, 'status');
  const reason =
    query.reason === undefined || query.reason === ''
      ? undefined
      : pick<ProductReturnReasonName>(query.reason, RETURN_REASONS, 'reason');
  const search = input.optionalLine(query.q, 'q', RETURN_LIMITS.searchMax);
  const page = Math.max(1, query.page ?? 1);
  const where: Prisma.ProductReturnCaseWhereInput = {
    branchId: query.branchId,
    ...(status ? { status } : {}),
    ...(reason ? { reason } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: 'insensitive' } },
            { invoice: { code: { contains: search, mode: 'insensitive' } } },
            { productLine: { sku: { contains: search, mode: 'insensitive' } } },
            { productLine: { productNameVi: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    context.tx.productReturnCase.count({ where }),
    context.tx.productReturnCase.findMany({
      where,
      orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PRODUCT_RETURN_PAGE_SIZE,
      take: PRODUCT_RETURN_PAGE_SIZE,
      select: {
        id: true,
        code: true,
        quantity: true,
        reason: true,
        requestedOutcome: true,
        status: true,
        openedAt: true,
        invoice: { select: { code: true } },
        productLine: {
          select: {
            sku: true,
            productNameVi: true,
            productNameEn: true,
            variantLabelVi: true,
            variantLabelEn: true,
          },
        },
        openedBy: { select: { fullName: true } },
        _count: { select: { photos: { where: { removedAt: null } } } },
      },
    }),
  ]);
  return {
    branchId: query.branchId,
    page,
    pageSize: PRODUCT_RETURN_PAGE_SIZE,
    total,
    items: rows.map((row) => ({
      id: row.id,
      code: row.code,
      invoiceCode: row.invoice.code,
      sku: row.productLine.sku,
      productNameVi: row.productLine.productNameVi,
      productNameEn: row.productLine.productNameEn,
      variantLabelVi: row.productLine.variantLabelVi,
      variantLabelEn: row.productLine.variantLabelEn,
      quantity: row.quantity,
      reason: row.reason,
      requestedOutcome: row.requestedOutcome,
      status: row.status,
      openedAt: row.openedAt.toISOString(),
      openedByName: row.openedBy.fullName,
      photoCount: row._count.photos,
    })),
  };
}

const caseSelect = {
  id: true,
  code: true,
  branchId: true,
  invoiceId: true,
  invoiceLineId: true,
  reason: true,
  requestedOutcome: true,
  quantity: true,
  sealIntact: true,
  notes: true,
  handoverAt: true,
  windowEndsAt: true,
  status: true,
  decidedOutcome: true,
  closedAt: true,
  closingNote: true,
  openedAt: true,
  rowVersion: true,
  branch: { select: { name: true } },
  invoice: { select: { code: true, paidAt: true, payer: { select: { fullName: true } } } },
  line: { select: { sequence: true, quantity: true } },
  productLine: {
    select: {
      sku: true,
      productNameVi: true,
      productNameEn: true,
      variantLabelVi: true,
      variantLabelEn: true,
    },
  },
  openedBy: { select: { fullName: true } },
  closedBy: { select: { fullName: true } },
  photos: {
    orderBy: [{ uploadedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      width: true,
      height: true,
      uploadedAt: true,
      removedAt: true,
      removalNote: true,
      uploadedBy: { select: { fullName: true } },
      removedBy: { select: { fullName: true } },
    },
  },
  events: {
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      kind: true,
      note: true,
      photoId: true,
      occurredAt: true,
      actor: { select: { fullName: true } },
    },
  },
} satisfies Prisma.ProductReturnCaseSelect;

async function present(context: AdminContext, id: string): Promise<ProductReturnCaseResponse> {
  const row = await context.tx.productReturnCase.findUnique({ where: { id }, select: caseSelect });
  if (!row) throw new AuthError('NOT_FOUND');
  const graph = context.actor.graph;
  const presentPhotos = row.photos.filter((photo) => photo.removedAt === null).length;
  const manage = canManageAt(graph, row.branchId);
  const open = row.status === 'OPEN';
  return {
    id: row.id,
    code: row.code,
    branchId: row.branchId,
    branchName: row.branch.name,
    invoice: {
      id: row.invoiceId,
      code: row.invoice.code,
      paidAt: (row.invoice.paidAt ?? row.handoverAt).toISOString(),
      customerName: row.invoice.payer?.fullName ?? null,
    },
    line: {
      id: row.invoiceLineId,
      sequence: row.line.sequence,
      sku: row.productLine.sku,
      productNameVi: row.productLine.productNameVi,
      productNameEn: row.productLine.productNameEn,
      variantLabelVi: row.productLine.variantLabelVi,
      variantLabelEn: row.productLine.variantLabelEn,
      soldQuantity: row.line.quantity ?? row.quantity,
    },
    reason: row.reason,
    requestedOutcome: row.requestedOutcome,
    quantity: row.quantity,
    sealIntact: row.sealIntact,
    notes: row.notes,
    handoverAt: row.handoverAt.toISOString(),
    windowEndsAt: row.windowEndsAt?.toISOString() ?? null,
    status: row.status,
    decidedOutcome: row.decidedOutcome,
    closedByName: row.closedBy?.fullName ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    closingNote: row.closingNote,
    openedByName: row.openedBy.fullName,
    openedAt: row.openedAt.toISOString(),
    rowVersion: row.rowVersion,
    photos: row.photos.map((photo) => ({
      id: photo.id,
      width: photo.width,
      height: photo.height,
      uploadedAt: photo.uploadedAt.toISOString(),
      uploadedByName: photo.uploadedBy.fullName,
      removedAt: photo.removedAt?.toISOString() ?? null,
      removedByName: photo.removedBy?.fullName ?? null,
      removalNote: photo.removalNote,
    })),
    events: row.events.map((event) => ({
      id: event.id,
      kind: event.kind,
      actorName: event.actor.fullName,
      note: event.note,
      photoId: event.photoId,
      occurredAt: event.occurredAt.toISOString(),
    })),
    can: {
      note: manage && (open || row.status === 'ACCEPTED'),
      addPhoto: manage && open && presentPhotos < PRODUCT_RETURN_MAX_PHOTOS,
      decide: open && canDecideAt(graph, row.branchId, row.reason),
      cancel: open && manage,
      removePhoto: context.actor.owner && presentPhotos > 0,
    },
  };
}

export async function getCase(
  context: AdminContext,
  id: string,
): Promise<ProductReturnCaseResponse> {
  const row = await context.tx.productReturnCase.findUnique({
    where: { id },
    select: { branchId: true },
  });
  if (!row) throw new AuthError('NOT_FOUND');
  requireView(context, row.branchId);
  return present(context, id);
}

// ------------------------------------------------------------------------------------------- commands

/**
 * Opens a case. `recipients` are the holders of REFUND_PRODUCTS at the branch, resolved and locked by the caller BEFORE this
 * transaction took the invoice row (they are told in the same transaction; the actor is never told about their own case).
 */
export async function openCase(
  context: AdminContext,
  request: Record<string, unknown>,
  recipients: readonly string[],
): Promise<ProductReturnCaseResponse> {
  const body = input.record(request, 'body', OPEN_KEYS);
  const branchId = input.uuid(body['branchId'], 'branchId');
  const invoiceLineId = input.uuid(body['invoiceLineId'], 'invoiceLineId');
  const clientRequestId = input.uuid(body['clientRequestId'], 'clientRequestId');
  const reason = pick<ProductReturnReasonName>(body['reason'], RETURN_REASONS, 'reason');
  const requestedOutcome = pick<ProductReturnOutcomeName>(
    body['requestedOutcome'],
    OUTCOMES,
    'requestedOutcome',
  );
  const quantity = input.quantity(body['quantity'], 'quantity');
  const sealRaw = body['sealIntact'];
  if (sealRaw !== undefined && sealRaw !== null && typeof sealRaw !== 'boolean') {
    throw new AuthError('VALIDATION_FAILED', 'sealIntact');
  }
  const sealIntact = typeof sealRaw === 'boolean' ? sealRaw : null;
  const notes = parse.optionalNote(body['notes'], 'notes', RETURN_LIMITS.noteMax);
  requireManage(context, branchId);
  const { tx } = context;
  await branchOf(tx, branchId);
  // A repeat of the same request returns the case it already opened.
  const replay = await tx.productReturnCase.findUnique({
    where: {
      openedByUserId_clientRequestId: { openedByUserId: context.actor.userId, clientRequestId },
    },
    select: { id: true, branchId: true },
  });
  if (replay) {
    requireView(context, replay.branchId);
    return present(context, replay.id);
  }
  const line = await tx.invoiceLine.findUnique({
    where: { id: invoiceLineId },
    select: { invoiceId: true, invoice: { select: { branchId: true } } },
  });
  if (!line || line.invoice.branchId !== branchId) throw new AuthError('NOT_FOUND');
  await lockInvoice(tx, line.invoiceId, true);
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: line.invoiceId },
    select: {
      status: true,
      channel: true,
      paidAt: true,
      paidSeq: true,
      lines: {
        where: { id: invoiceLineId },
        select: { kind: true, quantity: true, productDetails: { select: { invoiceLineId: true } } },
      },
    },
  });
  const sold = invoice.lines[0];
  if (
    !sold ||
    sold.kind !== 'PRODUCT' ||
    sold.productDetails.length === 0 ||
    sold.quantity === null ||
    invoice.status !== 'PAID' ||
    invoice.paidAt === null ||
    invoice.channel !== 'COUNTER'
  ) {
    throw new AuthError('RETURN_NOT_ELIGIBLE');
  }
  const claimed = await tx.productReturnCase.aggregate({
    where: { invoiceLineId, status: { in: ['OPEN', 'ACCEPTED'] } },
    _sum: { quantity: true },
  });
  if (quantity + (claimed._sum.quantity ?? 0) > sold.quantity) {
    throw new AuthError('RETURN_QUANTITY_EXCEEDED', 'quantity');
  }
  if (reason === 'PERSONAL_PREFERENCE' && sealIntact !== true) {
    throw new AuthError('RETURN_SEAL_REQUIRED', 'sealIntact');
  }
  const handoverAt = invoice.paidAt;
  if (!windowStatus(reason, handoverAt, context.now).open) {
    throw new AuthError('RETURN_WINDOW_EXPIRED', 'reason');
  }
  const [sequence] = await tx.$queryRaw<
    { n: string }[]
  >`SELECT nextval('product_return_code_seq')::text AS n`;
  const code = `TH${sequence!.n.padStart(6, '0')}`;
  const created = await tx.productReturnCase.create({
    data: {
      code,
      branchId,
      invoiceId: line.invoiceId,
      invoiceLineId,
      reason,
      requestedOutcome,
      quantity,
      sealIntact,
      notes,
      handoverAt,
      paidSeq: invoice.paidSeq,
      windowEndsAt: windowEndsAt(reason, handoverAt),
      openedByUserId: context.actor.userId,
      clientRequestId,
    },
    select: { id: true },
  });
  await tx.productReturnEvent.create({
    data: { caseId: created.id, kind: 'OPENED', actorUserId: context.actor.userId, note: notes },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_RETURN_OPENED',
    entityType: 'ProductReturnCase',
    entityId: created.id,
    branchId,
    after: { code, reason, requestedOutcome, quantity },
  });
  await tellRefundHolders(tx, {
    branchId,
    caseId: created.id,
    code,
    reason,
    recipients: recipients.filter((id) => id !== context.actor.userId),
  });
  return present(context, created.id);
}

async function tellRefundHolders(
  tx: Tx,
  event: {
    branchId: string;
    caseId: string;
    code: string;
    reason: ProductReturnReasonName;
    recipients: readonly string[];
  },
): Promise<void> {
  if (event.recipients.length === 0) return;
  const outbox = await appendOutboxEvent(tx, {
    branchId: event.branchId,
    aggregateType: 'ProductReturnCase',
    aggregateId: event.caseId,
    eventType: 'PRODUCT_RETURN_OPENED',
    schemaVersion: 1,
    payload: { entityId: event.caseId },
  });
  // The notice is written in this same transaction: no relay has anything left to do with the event.
  await tx.outboxEvent.update({
    where: { id: outbox.id },
    data: { publishedAt: outbox.occurredAt },
  });
  const params = parseNotificationParams('PRODUCT_RETURN_OPENED', { reason: event.reason });
  await tx.notification.createMany({
    skipDuplicates: true,
    data: event.recipients.map((recipientUserId) => ({
      recipientUserId,
      sourceEventId: outbox.id,
      branchId: event.branchId,
      type: 'PRODUCT_RETURN_OPENED',
      entityType: 'ProductReturnCase',
      entityId: event.caseId,
      contextCode: event.code,
      actionAt: outbox.occurredAt,
      ...(params === null ? {} : { params: params as unknown as Prisma.InputJsonObject }),
    })),
  });
}

interface LockedCase {
  id: string;
  branchId: string;
  invoiceId: string;
  reason: ProductReturnReasonName;
  status: ProductReturnStatusName;
  rowVersion: number;
  windowEndsAt: Date | null;
  code: string;
}

/**
 * Takes the locks of a command on an existing case in the design order (the invoice, then the case) and returns the case as it is
 * under the lock. `expected` is the row version the caller saw (a decision or cancellation); an annotation passes `null`.
 */
async function lockedCase(
  context: AdminContext,
  id: string,
  authorize: (branchId: string, reason: ProductReturnReasonName) => void,
  invoiceExclusive: boolean,
): Promise<LockedCase> {
  const { tx } = context;
  const hint = await tx.productReturnCase.findUnique({
    where: { id },
    select: { branchId: true, invoiceId: true, reason: true },
  });
  if (!hint) throw new AuthError('NOT_FOUND');
  requireView(context, hint.branchId);
  authorize(hint.branchId, hint.reason);
  await lockInvoice(tx, hint.invoiceId, invoiceExclusive);
  await lockCase(tx, id);
  return tx.productReturnCase.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      branchId: true,
      invoiceId: true,
      reason: true,
      status: true,
      rowVersion: true,
      windowEndsAt: true,
      code: true,
    },
  });
}

export async function addNote(
  context: AdminContext,
  id: string,
  request: { note?: unknown },
): Promise<ProductReturnCaseResponse> {
  const note = requiredNote(request.note, 'note');
  const locked = await lockedCase(
    context,
    id,
    (branchId) => requireManage(context, branchId),
    false,
  );
  if (locked.status !== 'OPEN' && locked.status !== 'ACCEPTED')
    throw new AuthError('RETURN_CLOSED');
  await context.tx.productReturnEvent.create({
    data: { caseId: id, kind: 'NOTE_ADDED', actorUserId: context.actor.userId, note },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_RETURN_NOTE_ADDED',
    entityType: 'ProductReturnCase',
    entityId: id,
    branchId: locked.branchId,
    after: { code: locked.code },
  });
  return present(context, id);
}

type Closing = 'ACCEPTED' | 'DECLINED' | 'CANCELLED';

async function close(
  context: AdminContext,
  id: string,
  closing: Closing,
  request: { expectedRowVersion?: unknown; note?: unknown; outcome?: unknown },
): Promise<ProductReturnCaseResponse> {
  const expected = input.rowVersion(request.expectedRowVersion);
  const note =
    closing === 'ACCEPTED'
      ? parse.optionalNote(request.note, 'note', RETURN_LIMITS.noteMax)
      : requiredNote(request.note, 'note');
  const outcome =
    closing === 'ACCEPTED'
      ? pick<ProductReturnOutcomeName>(request.outcome, OUTCOMES, 'outcome')
      : null;
  const locked = await lockedCase(
    context,
    id,
    (branchId, reason) =>
      closing === 'CANCELLED'
        ? requireManage(context, branchId)
        : requireDecide(context, branchId, reason),
    false,
  );
  if (locked.status !== 'OPEN') throw new AuthError('RETURN_CLOSED');
  if (locked.rowVersion !== expected) throw new AuthError('CONFLICT');
  const { tx } = context;
  if (closing === 'ACCEPTED') {
    // The invoice must still be paid (a payment reversal can happen between opening and deciding), and a wrong or damaged product
    // needs a photo that is still present and was taken inside the 48 hours.
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: locked.invoiceId },
      select: { status: true },
    });
    if (invoice.status !== 'PAID') throw new AuthError('RETURN_NOT_ELIGIBLE');
    const photos = await tx.productReturnPhoto.findMany({
      where: { caseId: id },
      select: { uploadedAt: true, removedAt: true },
    });
    if (!hasQualifyingPhoto(locked.reason, locked.windowEndsAt, photos)) {
      throw new AuthError('RETURN_PHOTO_REQUIRED');
    }
  }
  await tx.productReturnCase.update({
    where: { id },
    data: {
      status: closing,
      closedByUserId: context.actor.userId,
      closingNote: note,
      decidedOutcome: outcome,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await tx.productReturnEvent.create({
    data: { caseId: id, kind: closing, actorUserId: context.actor.userId, note },
  });
  await appendAdminAudit(context, {
    action: `PRODUCT_RETURN_${closing}`,
    entityType: 'ProductReturnCase',
    entityId: id,
    branchId: locked.branchId,
    after: { code: locked.code, status: closing, ...(outcome ? { outcome } : {}) },
  });
  return present(context, id);
}

export const acceptCase = (
  context: AdminContext,
  id: string,
  request: { expectedRowVersion?: unknown; note?: unknown; outcome?: unknown },
) => close(context, id, 'ACCEPTED', request);
export const declineCase = (
  context: AdminContext,
  id: string,
  request: { expectedRowVersion?: unknown; note?: unknown },
) => close(context, id, 'DECLINED', request);
export const cancelCase = (
  context: AdminContext,
  id: string,
  request: { expectedRowVersion?: unknown; note?: unknown },
) => close(context, id, 'CANCELLED', request);

// --------------------------------------------------------------------------------------------- photos

/** The image columns of a stored photo (see `product_return_photos`). */
export interface StoredPhoto {
  originalKey: string;
  thumbKey: string;
  mdKey: string;
  lgKey: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
}

/**
 * Before any image work: the caller may add a photo to this case now (manage at the branch, the case is open, room is left).
 * Returns the response of an identical picture already present (a repeat upload changes nothing) or null.
 */
export async function checkPhotoUpload(
  context: AdminContext,
  id: string,
  sha256: string,
): Promise<ProductReturnCaseResponse | null> {
  const row = await context.tx.productReturnCase.findUnique({
    where: { id },
    select: {
      branchId: true,
      status: true,
      photos: { where: { removedAt: null }, select: { sha256: true } },
    },
  });
  if (!row) throw new AuthError('NOT_FOUND');
  requireManage(context, row.branchId);
  if (row.status !== 'OPEN') throw new AuthError('RETURN_CLOSED');
  if (row.photos.some((photo) => photo.sha256 === sha256)) return present(context, id);
  if (row.photos.length >= PRODUCT_RETURN_MAX_PHOTOS) throw new AuthError('RETURN_PHOTO_LIMIT');
  return null;
}

/** Records an uploaded photo; `duplicate` tells the caller to delete the objects it just wrote. */
export async function recordPhoto(
  context: AdminContext,
  id: string,
  stored: StoredPhoto,
): Promise<{ response: ProductReturnCaseResponse; duplicate: boolean }> {
  const locked = await lockedCase(
    context,
    id,
    (branchId) => requireManage(context, branchId),
    false,
  );
  if (locked.status !== 'OPEN') throw new AuthError('RETURN_CLOSED');
  const { tx } = context;
  const present_ = await tx.productReturnPhoto.findMany({
    where: { caseId: id, removedAt: null },
    select: { sha256: true },
  });
  if (present_.some((photo) => photo.sha256 === stored.sha256)) {
    return { response: await present(context, id), duplicate: true };
  }
  if (present_.length >= PRODUCT_RETURN_MAX_PHOTOS) throw new AuthError('RETURN_PHOTO_LIMIT');
  const photo = await tx.productReturnPhoto.create({
    data: { caseId: id, ...stored, uploadedByUserId: context.actor.userId },
    select: { id: true },
  });
  await tx.productReturnEvent.create({
    data: { caseId: id, kind: 'PHOTO_ADDED', actorUserId: context.actor.userId, photoId: photo.id },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_RETURN_PHOTO_ADDED',
    entityType: 'ProductReturnCase',
    entityId: id,
    branchId: locked.branchId,
    after: { code: locked.code, photoId: photo.id },
  });
  return { response: await present(context, id), duplicate: false };
}

/**
 * OQ-79: the Owner removes a photo only on the customer's request. The row stays as a tombstone (who, when, what the customer asked);
 * the caller deletes the stored objects after the commit, whose keys are returned.
 */
export async function removePhoto(
  context: AdminContext,
  id: string,
  photoId: string,
  request: { note?: unknown },
): Promise<{ response: ProductReturnCaseResponse; keys: string[] }> {
  const note = requiredNote(request.note, 'note');
  if (!context.actor.owner) throw new AuthError('FORBIDDEN');
  const locked = await lockedCase(context, id, () => undefined, false);
  const { tx } = context;
  const photo = await tx.productReturnPhoto.findFirst({
    where: { id: photoId, caseId: id },
    select: {
      id: true,
      removedAt: true,
      originalKey: true,
      thumbKey: true,
      mdKey: true,
      lgKey: true,
    },
  });
  if (!photo) throw new AuthError('NOT_FOUND');
  if (photo.removedAt !== null) throw new AuthError('RETURN_PHOTO_GONE');
  await tx.productReturnPhoto.update({
    where: { id: photoId },
    data: { removedByUserId: context.actor.userId, removalNote: note },
    select: { id: true },
  });
  await tx.productReturnEvent.create({
    data: { caseId: id, kind: 'PHOTO_REMOVED', actorUserId: context.actor.userId, note, photoId },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_RETURN_PHOTO_REMOVED',
    entityType: 'ProductReturnCase',
    entityId: id,
    branchId: locked.branchId,
    reason: note,
    after: { code: locked.code, photoId },
  });
  return {
    response: await present(context, id),
    keys: [photo.originalKey, photo.thumbKey, photo.mdKey, photo.lgKey],
  };
}

/** The storage key of one rendition a viewer may see: they must hold a view permission at the case's branch; a removed photo is gone. */
export async function photoRendition(
  tx: Tx,
  graph: AdminContext['actor']['graph'],
  caseId: string,
  photoId: string,
  kind: 'THUMB' | 'MD' | 'LG',
): Promise<{ storageKey: string; sha256: string }> {
  const photo = await tx.productReturnPhoto.findFirst({
    where: { id: photoId, caseId },
    select: {
      removedAt: true,
      thumbKey: true,
      mdKey: true,
      lgKey: true,
      sha256: true,
      returnCase: { select: { branchId: true } },
    },
  });
  if (!photo || !canViewAt(graph, photo.returnCase.branchId)) throw new AuthError('NOT_FOUND');
  if (photo.removedAt !== null) throw new AuthError('NOT_FOUND');
  const storageKey = kind === 'THUMB' ? photo.thumbKey : kind === 'MD' ? photo.mdKey : photo.lgKey;
  return { storageKey, sha256: photo.sha256 };
}
