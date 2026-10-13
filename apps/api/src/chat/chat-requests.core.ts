import {
  CHAT_LIMITS,
  CHAT_REQUEST_STATUSES,
  type ChatFallbackReason,
  type ChatRequestList,
  type ChatRequestRow,
  type ChatRequestStatus,
  type ChatRequestStatusRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';

/**
 * Claude integration Wave B (CI-B2): the callback inbox of the website chat. Authority: `MANAGE_CHAT_REQUESTS`, GLOBAL, for reading and
 * for every change. A request moves forward only (NEW to CALLED, NEW or CALLED to CLOSED); each move needs the row version the screen
 * read and is audited with before and after (never the phone or the note: the audit names the request and the status). Nothing here sends
 * anything to the visitor. The phone, name and note are cleared by the worker 90 days after the request is closed.
 */
const GLOBAL = { kind: 'GLOBAL' } as const;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireInbox(context: AdminContext): void {
  if (!decide(context.actor.graph, 'MANAGE_CHAT_REQUESTS', GLOBAL))
    throw new AuthError('FORBIDDEN');
}

type Row = Prisma.ChatCallbackRequestGetPayload<Record<string, never>>;

export async function listRequests(
  context: AdminContext,
  query: { status?: string | undefined; page?: number | undefined },
): Promise<ChatRequestList> {
  requireInbox(context);
  const { tx } = context;
  const status = query.status;
  if (status !== undefined && !(CHAT_REQUEST_STATUSES as readonly string[]).includes(status)) {
    throw new AuthError('VALIDATION_FAILED', 'status');
  }
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const where: Prisma.ChatCallbackRequestWhereInput = status ? { status } : {};
  const [total, rows, groups] = await Promise.all([
    tx.chatCallbackRequest.count({ where }),
    tx.chatCallbackRequest.findMany({
      where,
      // Open requests first (newest first within each), so the work to do is at the top.
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * CHAT_LIMITS.pageSize,
      take: CHAT_LIMITS.pageSize,
    }),
    tx.chatCallbackRequest.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  const branches = await tx.branch.findMany({
    where: {
      id: {
        in: rows.flatMap((row) => (row.preferredBranchId ? [row.preferredBranchId] : [])),
      },
    },
    select: { id: true, name: true },
  });
  const users = await tx.user.findMany({
    where: {
      id: { in: rows.flatMap((row) => (row.handledByUserId ? [row.handledByUserId] : [])) },
    },
    select: { id: true, fullName: true },
  });
  const branchName = new Map(branches.map((branch) => [branch.id, branch.name]));
  const userName = new Map(users.map((user) => [user.id, user.fullName]));
  const counts = Object.fromEntries(CHAT_REQUEST_STATUSES.map((entry) => [entry, 0])) as Record<
    ChatRequestStatus,
    number
  >;
  for (const group of groups) counts[group.status as ChatRequestStatus] = group._count._all;
  return {
    items: rows.map((row) => present(row, branchName, userName)),
    total,
    page,
    pageSize: CHAT_LIMITS.pageSize,
    counts,
  };
}

function present(
  row: Row,
  branchName: Map<string, string>,
  userName: Map<string, string>,
): ChatRequestRow {
  return {
    id: row.id,
    status: row.status as ChatRequestStatus,
    reason: row.reason as ChatFallbackReason | 'VISITOR',
    phone: row.phone,
    name: row.name,
    note: row.note,
    preferredBranchName: row.preferredBranchId
      ? (branchName.get(row.preferredBranchId) ?? null)
      : null,
    createdAt: row.createdAt.toISOString(),
    handledAt: row.handledAt?.toISOString() ?? null,
    handledByName: row.handledByUserId ? (userName.get(row.handledByUserId) ?? null) : null,
    closedAt: row.closedAt?.toISOString() ?? null,
    rowVersion: row.rowVersion,
  };
}

/** Moves a request forward. The result is the request as the list shows it. */
export async function setRequestStatus(
  context: AdminContext,
  id: string,
  request: ChatRequestStatusRequest,
): Promise<ChatRequestRow> {
  requireInbox(context);
  if (!ID.test(id)) throw new AuthError('NOT_FOUND');
  const { tx } = context;
  if (!Number.isInteger(request.expectedRowVersion) || request.expectedRowVersion < 1) {
    throw new AuthError('VALIDATION_FAILED', 'expectedRowVersion');
  }
  if (request.status !== 'CALLED' && request.status !== 'CLOSED') {
    throw new AuthError('VALIDATION_FAILED', 'status');
  }
  await tx.$queryRaw`SELECT id FROM chat_callback_requests WHERE id = ${id}::uuid FOR UPDATE`;
  const current = await tx.chatCallbackRequest.findUnique({ where: { id } });
  if (current === null) throw new AuthError('NOT_FOUND');
  if (current.rowVersion !== request.expectedRowVersion) throw new AuthError('CONFLICT');
  // Forward only: a closed request is history, and a called one cannot be marked "called" again.
  const allowed =
    (current.status === 'NEW' && (request.status === 'CALLED' || request.status === 'CLOSED')) ||
    (current.status === 'CALLED' && request.status === 'CLOSED');
  if (!allowed) throw new AuthError('CONFLICT');
  const closing = request.status === 'CLOSED';
  const updated = await tx.chatCallbackRequest.update({
    where: { id },
    data: {
      status: request.status,
      handledAt: current.handledAt ?? context.now,
      handledByUserId: current.handledByUserId ?? context.actor.userId,
      ...(closing ? { closedAt: context.now } : {}),
      rowVersion: current.rowVersion + 1,
    },
  });
  await appendAdminAudit(context, {
    action: 'CHAT_REQUEST_UPDATED',
    entityType: 'ChatCallbackRequest',
    entityId: id,
    before: { status: current.status },
    after: { status: updated.status },
  });
  const [branch, user] = await Promise.all([
    updated.preferredBranchId
      ? tx.branch.findUnique({ where: { id: updated.preferredBranchId }, select: { name: true } })
      : null,
    updated.handledByUserId
      ? tx.user.findUnique({ where: { id: updated.handledByUserId }, select: { fullName: true } })
      : null,
  ]);
  return present(
    updated,
    new Map(branch && updated.preferredBranchId ? [[updated.preferredBranchId, branch.name]] : []),
    new Map(user && updated.handledByUserId ? [[updated.handledByUserId, user.fullName]] : []),
  );
}
