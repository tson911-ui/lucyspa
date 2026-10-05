import {
  COMBO_SOLD_STATUSES,
  type ComboSoldCause,
  type ComboSoldItemResponse,
  type ComboSoldPageResponse,
  type ComboSoldStatus,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import type { AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { maskPhone } from '../operations/operations.state.js';

/**
 * Phase 5 P5-10b: the combos that were sold, every state, nothing hidden (Owner instruction of 2026-10-05). Read only.
 * The list for the Owner or a manager (`RESTORE_COMBO_SESSIONS` or `MANAGE_COMBOS`, global, the same rule as the usage history)
 * and one customer's combos on the staff profile (`VIEW_LOYALTY` at a branch) share this reading. No money value is shown.
 *
 * The state is decided in one SQL statement: revoked (withdrawn before any use) first, then frozen (the database's own usability
 * rule is false: its sale was reversed or cancelled after issue), used up, expired, and otherwise active.
 */
export const COMBO_SOLD_PAGE_SIZE = 20;
const GLOBAL = { kind: 'GLOBAL' } as const;

export function canSeeSold(context: AdminContext): boolean {
  return (
    decide(context.actor.graph, 'RESTORE_COMBO_SESSIONS', GLOBAL) ||
    decide(context.actor.graph, 'MANAGE_COMBOS', GLOBAL)
  );
}

export function soldPageOf(value: string | undefined): number {
  if (value === undefined) return 1;
  const page = /^[0-9]{1,6}$/.test(value) ? Number(value) : 0;
  if (page < 1) throw new AuthError('VALIDATION_FAILED', 'page');
  return page;
}

export function soldStatusOf(value: string | undefined): ComboSoldStatus | null {
  if (value === undefined || value === '') return null;
  if ((COMBO_SOLD_STATUSES as readonly string[]).includes(value)) return value as ComboSoldStatus;
  throw new AuthError('VALIDATION_FAILED', 'status');
}

interface Classified {
  id: string;
  status: ComboSoldStatus;
  paid_left: number;
  bonus_left: number;
}

/** The revoke text is written by the loyalty worker (`packages/server/src/loyalty.ts`); its two causes are told apart here. */
function revokedCause(voidReason: string | null): ComboSoldCause {
  return voidReason?.startsWith('Hóa đơn đã bị hủy') ? 'SALE_CANCELLED' : 'SALE_REVERSED';
}

const itemSelect = {
  id: true,
  nameVi: true,
  nameEn: true,
  paidSessions: true,
  bonusSessions: true,
  issuedAt: true,
  expiresAt: true,
  voidedAt: true,
  voidReason: true,
  owner: { select: { id: true, fullName: true, phoneCanonical: true } },
  service: { select: { nameVi: true, nameEn: true } },
  invoiceLine: {
    select: {
      invoice: {
        select: {
          code: true,
          status: true,
          cancelledAt: true,
          updatedAt: true,
          branch: { select: { name: true } },
          payments: {
            select: {
              correction: { select: { occurredAt: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ComboPurchaseSelect;
type ItemRow = Prisma.ComboPurchaseGetPayload<{ select: typeof itemSelect }>;

function presentItem(
  row: ItemRow,
  status: ComboSoldStatus,
  paidLeft: number,
  bonusLeft: number,
): ComboSoldItemResponse {
  const sale = row.invoiceLine.invoice;
  let event: ComboSoldItemResponse['event'] = null;
  if (status === 'REVOKED' && row.voidedAt) {
    event = {
      kind: 'REVOKED',
      at: row.voidedAt.toISOString(),
      cause: revokedCause(row.voidReason),
    };
  } else if (status === 'FROZEN') {
    if (sale.status === 'CANCELLED' && sale.cancelledAt) {
      event = {
        kind: 'FROZEN',
        at: sale.cancelledAt.toISOString(),
        cause: 'SALE_CANCELLED',
      };
    } else {
      // The sale waits for payment after a reversal: the latest reversal of one of its payments.
      const latest = sale.payments
        .flatMap((payment) => (payment.correction ? [payment.correction] : []))
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
      event = {
        kind: 'FROZEN',
        at: (latest?.occurredAt ?? sale.updatedAt).toISOString(),
        cause: 'SALE_REVERSED',
      };
    }
  }
  return {
    purchaseId: row.id,
    buyer: {
      id: row.owner.id,
      displayName: row.owner.fullName,
      phoneMasked: maskPhone(row.owner.phoneCanonical),
    },
    comboNameVi: row.nameVi,
    comboNameEn: row.nameEn,
    serviceNameVi: row.service.nameVi,
    serviceNameEn: row.service.nameEn,
    soldAt: row.issuedAt.toISOString(),
    branchName: sale.branch.name,
    saleInvoiceCode: sale.code,
    paidSessions: row.paidSessions,
    bonusSessions: row.bonusSessions,
    paidLeft,
    bonusLeft,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    status,
    event,
  };
}

/**
 * One page of sold combos, newest first. `ownerUserId` narrows it to one customer's combos; `status` filters; the totals are the
 * sessions usable now (ACTIVE combos) over the same scope: the owner filter, never the status filter or the page. The state of
 * every combo in scope is decided in ONE statement (a spa sells hundreds of combos, not millions), so the filter, the page, the
 * count and the totals can never disagree.
 */
export async function listSold(
  tx: Prisma.TransactionClient,
  now: Date,
  query: { ownerUserId: string | null; status: ComboSoldStatus | null; page: number },
): Promise<ComboSoldPageResponse> {
  const all = await tx.$queryRaw<Classified[]>`
    SELECT p.id,
      f.paid_left, f.bonus_left,
      CASE
        WHEN p.voided_at IS NOT NULL THEN 'REVOKED'
        WHEN NOT lucy_combo_purchase_usable(p.id) THEN 'FROZEN'
        WHEN f.paid_left + f.bonus_left = 0 THEN 'USED_UP'
        WHEN p.expires_at IS NOT NULL AND p.expires_at <= ${now}::timestamptz THEN 'EXPIRED'
        ELSE 'ACTIVE'
      END AS status
    FROM combo_purchases p
    CROSS JOIN LATERAL (
      SELECT (count(*) FILTER (WHERE s.kind = 'PAID'))::int AS paid_left,
             (count(*) FILTER (WHERE s.kind = 'BONUS'))::int AS bonus_left
      FROM combo_sessions s
      WHERE s.purchase_id = p.id
        AND NOT EXISTS (
          SELECT 1 FROM combo_session_consumptions u
          WHERE u.session_id = s.id
            AND NOT EXISTS (SELECT 1 FROM combo_session_releases r WHERE r.consumption_id = u.id)
            AND NOT EXISTS (SELECT 1 FROM combo_session_restorations x WHERE x.consumption_id = u.id))
    ) f
    WHERE (${query.ownerUserId}::uuid IS NULL OR p.owner_user_id = ${query.ownerUserId}::uuid)
    ORDER BY p.issued_at DESC, p.id ASC`;
  const matching = query.status ? all.filter((row) => row.status === query.status) : all;
  const slice = matching.slice(
    (query.page - 1) * COMBO_SOLD_PAGE_SIZE,
    query.page * COMBO_SOLD_PAGE_SIZE,
  );
  const rows = await tx.comboPurchase.findMany({
    where: { id: { in: slice.map((row) => row.id) } },
    select: itemSelect,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const active = all.filter((row) => row.status === 'ACTIVE');
  return {
    items: slice.flatMap((entry) => {
      const row = byId.get(entry.id);
      return row ? [presentItem(row, entry.status, entry.paid_left, entry.bonus_left)] : [];
    }),
    page: query.page,
    pageSize: COMBO_SOLD_PAGE_SIZE,
    total: matching.length,
    totals: {
      paidLeft: active.reduce((sum, row) => sum + row.paid_left, 0),
      bonusLeft: active.reduce((sum, row) => sum + row.bonus_left, 0),
    },
  };
}
