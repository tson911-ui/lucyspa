import {
  isNotificationType,
  NOTIFICATION_CATEGORIES,
  notificationTypesInCategory,
  parseNotificationParams,
} from '@lucy-spa/contracts';
import type {
  NotificationCategory,
  NotificationCategoryCounts,
  NotificationCountResponse,
  NotificationEntityType,
  NotificationItem,
  NotificationPage,
  NotificationParams,
  NotificationQuery,
  NotificationReadAllResponse,
  NotificationType,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { SessionService } from '../auth/session.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const include = { branch: { select: { id: true, name: true, timezone: true } } } as const;

type InboxFilters = Pick<NotificationQuery, 'category' | 'unread' | 'archived'>;

/** Only registry-validated structured params are ever returned; anything else becomes null. */
function safeParams(type: string, value: Prisma.JsonValue | null): NotificationParams | null {
  if (value === null || !isNotificationType(type)) return null;
  try {
    return parseNotificationParams(type, value);
  } catch {
    return null;
  }
}

function item(row: Prisma.NotificationGetPayload<{ include: typeof include }>): NotificationItem {
  return {
    id: row.id,
    type: row.type as NotificationType,
    branch: row.branch,
    source: {
      type: row.entityType as NotificationEntityType,
      id: row.entityId,
      code: row.contextCode,
    },
    actionAt: row.actionAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    params: safeParams(row.type, row.params),
  };
}

export function parseNotificationCursor(cursor?: string): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id, extra] = cursor.split('~');
  if (
    !iso ||
    !id ||
    extra !== undefined ||
    !UUID.test(id) ||
    !Number.isFinite(Date.parse(iso)) ||
    new Date(iso).toISOString() !== iso
  )
    throw new AuthError('VALIDATION_FAILED');
  return { createdAt: new Date(iso), id: id.toLowerCase() };
}

/**
 * Unread, non-archived notifications of one recipient, in total and per registry category
 * (category is derived from the type, never stored). Archived rows are never counted.
 */
export async function countOwnUnread(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<NotificationCountResponse> {
  const rows = await tx.notification.groupBy({
    by: ['type'],
    where: { recipientUserId: userId, readAt: null, archivedAt: null },
    _count: { _all: true },
  });
  const unreadByCategory = Object.fromEntries(
    NOTIFICATION_CATEGORIES.map((category) => [category, 0]),
  ) as NotificationCategoryCounts;
  let unreadCount = 0;
  for (const row of rows) {
    unreadCount += row._count._all;
    if (!isNotificationType(row.type)) continue;
    for (const category of NOTIFICATION_CATEGORIES) {
      if (notificationTypesInCategory(category).includes(row.type)) {
        unreadByCategory[category] += row._count._all;
      }
    }
  }
  return { unreadCount, unreadByCategory };
}

/** The recipient is always the caller: there is no way to name another user's inbox. */
function inboxWhere(userId: string, filters: InboxFilters): Prisma.NotificationWhereInput {
  return {
    recipientUserId: userId,
    archivedAt: filters.archived === true ? { not: null } : null,
    ...(filters.unread === true ? { readAt: null } : {}),
    ...(filters.category
      ? { type: { in: [...notificationTypesInCategory(filters.category)] } }
      : {}),
  };
}

export async function listOwnNotifications(
  tx: Prisma.TransactionClient,
  userId: string,
  cursor?: string,
  filters: InboxFilters = {},
): Promise<NotificationPage> {
  const after = parseNotificationCursor(cursor);
  const rows = await tx.notification.findMany({
    where: {
      ...inboxWhere(userId, filters),
      ...(after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {}),
    },
    include,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 31,
  });
  const page = rows.slice(0, 30);
  const last = page.at(-1);
  return {
    items: page.map(item),
    nextCursor: rows.length > 30 && last ? `${last.createdAt.toISOString()}~${last.id}` : null,
    ...(await countOwnUnread(tx, userId)),
  };
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const [clock] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT date_trunc('milliseconds', clock_timestamp()) AS now`;
  return clock!.now;
}

export async function readOwnNotification(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
): Promise<NotificationItem> {
  if (!UUID.test(id)) throw new AuthError('NOT_FOUND');
  await tx.notification.updateMany({
    where: { id, recipientUserId: userId, readAt: null },
    data: { readAt: await databaseNow(tx) },
  });
  const row = await tx.notification.findFirst({ where: { id, recipientUserId: userId }, include });
  if (!row) throw new AuthError('NOT_FOUND');
  return item(row);
}

/** Archive is a soft state (never a delete); a repeat keeps the first timestamp. */
export async function archiveOwnNotification(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
): Promise<NotificationItem> {
  if (!UUID.test(id)) throw new AuthError('NOT_FOUND');
  await tx.notification.updateMany({
    where: { id, recipientUserId: userId, archivedAt: null },
    data: { archivedAt: await databaseNow(tx) },
  });
  const row = await tx.notification.findFirst({ where: { id, recipientUserId: userId }, include });
  if (!row) throw new AuthError('NOT_FOUND');
  return item(row);
}

/** Marks the caller's own unread, non-archived notifications read (optionally one category). */
export async function readAllOwnNotifications(
  tx: Prisma.TransactionClient,
  userId: string,
  category?: NotificationCategory,
): Promise<NotificationReadAllResponse> {
  const changed = await tx.notification.updateMany({
    where: {
      recipientUserId: userId,
      readAt: null,
      archivedAt: null,
      ...(category ? { type: { in: [...notificationTypesInCategory(category)] } } : {}),
    },
    data: { readAt: await databaseNow(tx) },
  });
  return { updated: changed.count, ...(await countOwnUnread(tx, userId)) };
}

@Injectable()
export class NotificationService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<SessionService, 'withTransaction' | 'resolveForMutation'>,
  ) {}
  list(token: string | undefined, cursor?: string, filters: InboxFilters = {}) {
    return this.own(token, (tx, id) => listOwnNotifications(tx, id, cursor, filters));
  }
  count(token: string | undefined) {
    return this.own(token, (tx, id) => countOwnUnread(tx, id));
  }
  read(token: string | undefined, id: string) {
    return this.own(token, (tx, userId) => readOwnNotification(tx, userId, id));
  }
  archive(token: string | undefined, id: string) {
    return this.own(token, (tx, userId) => archiveOwnNotification(tx, userId, id));
  }
  readAll(token: string | undefined, category?: NotificationCategory) {
    return this.own(token, (tx, userId) => readAllOwnNotifications(tx, userId, category));
  }
  private async own<T>(
    token: string | undefined,
    work: (tx: Prisma.TransactionClient, userId: string) => Promise<T>,
  ): Promise<T> {
    if (!token) throw new AuthError('AUTHENTICATION_REQUIRED');
    try {
      return await this.sessions.withTransaction(async (tx) => {
        const principal = await this.sessions.resolveForMutation(token, tx);
        if (principal?.kind !== 'AUTHENTICATED' || !principal.userId)
          throw new AuthError('AUTHENTICATION_REQUIRED');
        return work(tx, principal.userId);
      });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
  }
}
