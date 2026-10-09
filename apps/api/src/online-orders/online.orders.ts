import type { OnlineOrderListResponse, OnlineOrderState } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import type { CustomerContext } from '../booking/customer-command.js';

const PAGE = 20;

/** The state a queue reading (the view `online_order_states`) stands for. */
export function stateToOrderState(state: string): OnlineOrderState {
  switch (state) {
    case 'TO_SHIP':
      return 'READY_TO_SHIP';
    case 'WAITING_GOODS':
      return 'WAITING_GOODS';
    case 'SHIPPED':
      return 'SHIPPED';
    case 'DELIVERY_FAILED':
      return 'DELIVERY_FAILED';
    case 'DONE':
      return 'COMPLETED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'AWAITING_PAYMENT';
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const summarySelect = {
  id: true,
  code: true,
  createdAt: true,
  invoice: { select: { status: true, totalVnd: true } },
  lines: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: {
      status: true,
      line: { select: { nameVi: true, nameEn: true } },
      productLine: { select: { fulfilmentMode: true } },
    },
  },
} satisfies Prisma.ProductOrderSelect;

/** The member's own online orders, newest first, 20 a page; `cursor` is the id of the last order of the previous page. */
export async function listOrders(
  context: CustomerContext,
  cursor: string | undefined,
): Promise<OnlineOrderListResponse> {
  const { tx, customerUserId } = context;
  const own: Prisma.ProductOrderWhereInput = { customerUserId, channel: 'ONLINE' };
  let after: Prisma.ProductOrderWhereInput = {};
  if (cursor !== undefined) {
    const anchor = UUID.test(cursor)
      ? await tx.productOrder.findFirst({
          where: { id: cursor.toLowerCase(), ...own },
          select: { id: true, createdAt: true },
        })
      : null;
    if (!anchor) throw new AuthError('VALIDATION_FAILED', 'cursor');
    after = {
      OR: [
        { createdAt: { lt: anchor.createdAt } },
        { createdAt: anchor.createdAt, id: { lt: anchor.id } },
      ],
    };
  }
  const rows = await tx.productOrder.findMany({
    where: { AND: [own, after] },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE + 1,
    select: summarySelect,
  });
  const page = rows.slice(0, PAGE);
  const readings = page.length
    ? await tx.$queryRaw<{ order_id: string; queue_state: string }[]>`
        SELECT order_id, queue_state FROM online_order_states WHERE order_id = ANY(${page.map((row) => row.id)}::uuid[])`
    : [];
  const stateOf = new Map(readings.map((entry) => [entry.order_id, entry.queue_state]));
  return {
    orders: page.map((row) => ({
      id: row.id,
      code: row.code,
      state:
        row.invoice.status === 'CANCELLED' && stateOf.get(row.id) === 'UNPAID'
          ? ('CANCELLED' as const)
          : stateToOrderState(stateOf.get(row.id) ?? 'UNPAID'),
      placedAt: row.createdAt.toISOString(),
      totalVnd: row.invoice.totalVnd.toString(),
      lineCount: row.lines.length,
      firstLineNameVi: row.lines[0]?.line.nameVi ?? '',
      firstLineNameEn: row.lines[0]?.line.nameEn ?? '',
    })),
    nextCursor: rows.length > page.length ? (page.at(-1)?.id ?? null) : null,
  };
}
