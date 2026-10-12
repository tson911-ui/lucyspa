import {
  REVIEW_MAX_COMMENT,
  type CustomerReviewPrompt,
  type CustomerReviewRequest,
  type CustomerReviewView,
  type ReviewStaffMember,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { sqlStateOf } from '../booking/customer-command.js';

/**
 * Phase 8 P8-16 (docs/PHASE8_REPORTS.md 4.9, Owner OQ-P8-7): the customer's own review of a paid invoice. The session's customer is the only
 * identity (no customer id is accepted); only an invoice whose payer is that customer is visible, so a foreign, guest-payer, draft or missing
 * invoice is the same NOT_FOUND. One review per invoice, written once and never changed; the people who can be rated are those who performed a
 * service on it. The database enforces the same rules (migration 20261211000000), so no other path can break them.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalid(field: string): never {
  throw new AuthError('VALIDATION_FAILED', field);
}

interface OwnInvoice {
  id: string;
  status: string;
  branchId: string;
}

async function ownInvoice(
  tx: Prisma.TransactionClient,
  customerUserId: string,
  invoiceId: string,
): Promise<OwnInvoice> {
  if (!UUID.test(invoiceId)) throw new AuthError('NOT_FOUND');
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId.toLowerCase(), payerUserId: customerUserId, finalizedAt: { not: null } },
    select: { id: true, status: true, branchId: true },
  });
  if (!invoice) throw new AuthError('NOT_FOUND');
  return invoice;
}

/** The people who performed a service on the invoice, by name. */
async function servedBy(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<ReviewStaffMember[]> {
  const rows = await tx.$queryRaw<{ id: string; name: string }[]>`
    SELECT DISTINCT s.employee_user_id::text AS id, u.full_name AS name
    FROM invoice_lines l
    JOIN invoice_line_services s ON s.invoice_line_id = l.id
    JOIN users u ON u.id = s.employee_user_id
    WHERE l.invoice_id = ${invoiceId}::uuid
    ORDER BY u.full_name, s.employee_user_id::text`;
  return rows.map((row) => ({ employeeUserId: row.id, name: row.name }));
}

async function existingReview(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<CustomerReviewView | null> {
  const review = await tx.customerReview.findUnique({ where: { invoiceId } });
  if (!review) return null;
  const staff = await tx.$queryRaw<{ name: string; rating: number }[]>`
    SELECT u.full_name AS name, r.rating::int AS rating
    FROM customer_review_staff_ratings r JOIN users u ON u.id = r.employee_user_id
    WHERE r.review_id = ${review.id}::uuid
    ORDER BY u.full_name, r.employee_user_id::text`;
  return {
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt.toISOString(),
    staff,
  };
}

export async function reviewPrompt(
  tx: Prisma.TransactionClient,
  customerUserId: string,
  invoiceId: string,
): Promise<CustomerReviewPrompt> {
  const invoice = await ownInvoice(tx, customerUserId, invoiceId);
  const review = await existingReview(tx, invoice.id);
  return {
    invoiceId: invoice.id,
    canReview: invoice.status === 'PAID' && review === null,
    review,
    staff: invoice.status === 'PAID' && review === null ? await servedBy(tx, invoice.id) : [],
  };
}

function rating(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
    return invalid(field);
  }
  return value;
}

export async function submitReview(
  tx: Prisma.TransactionClient,
  customerUserId: string,
  request: CustomerReviewRequest,
): Promise<CustomerReviewView> {
  if (typeof request.invoiceId !== 'string') return invalid('invoiceId');
  const stars = rating(request.rating, 'rating');
  let comment: string | null = null;
  if (request.comment !== null && request.comment !== undefined) {
    if (typeof request.comment !== 'string') return invalid('comment');
    const trimmed = request.comment.trim();
    if (trimmed.length > REVIEW_MAX_COMMENT) return invalid('comment');
    comment = trimmed === '' ? null : trimmed;
  }
  if (!Array.isArray(request.staff) || request.staff.length > 20) return invalid('staff');
  const invoice = await ownInvoice(tx, customerUserId, request.invoiceId);
  if (invoice.status !== 'PAID') throw new AuthError('REVIEW_NOT_AVAILABLE');
  if ((await tx.customerReview.findUnique({ where: { invoiceId: invoice.id } })) !== null) {
    throw new AuthError('REVIEW_ALREADY_SUBMITTED');
  }
  const served = new Set((await servedBy(tx, invoice.id)).map((member) => member.employeeUserId));
  const rated = new Map<string, number>();
  for (const entry of request.staff) {
    const id = typeof entry?.employeeUserId === 'string' ? entry.employeeUserId.toLowerCase() : '';
    if (!served.has(id) || rated.has(id)) return invalid('staff');
    rated.set(id, rating(entry.rating, 'staff'));
  }
  try {
    const created = await tx.customerReview.create({
      data: {
        invoiceId: invoice.id,
        customerUserId,
        branchId: invoice.branchId,
        rating: stars,
        comment,
      },
      select: { id: true },
    });
    for (const [employeeUserId, value] of rated) {
      await tx.customerReviewStaffRating.create({
        data: { reviewId: created.id, employeeUserId, rating: value },
      });
    }
  } catch (error) {
    // Two submissions at once: the unique index lets one win; the other is told the review exists.
    if (sqlStateOf(error) === '23505' || Reflect.get(Object(error), 'code') === 'P2002') {
      throw new AuthError('REVIEW_ALREADY_SUBMITTED');
    }
    throw error;
  }
  const view = await existingReview(tx, invoice.id);
  if (!view) throw new Error('The review was just written.');
  return view;
}
