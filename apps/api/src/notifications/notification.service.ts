import type { NotificationItem, NotificationPage, NotificationType } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { SessionService } from '../auth/session.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const include = { branch: { select: { id: true, name: true, timezone: true } } } as const;
function item(row: Prisma.NotificationGetPayload<{ include: typeof include }>): NotificationItem {
  return {
    id: row.id,
    type: row.type as NotificationType,
    branch: row.branch,
    source: {
      type: row.entityType as 'Booking' | 'Visit',
      id: row.entityId,
      code: row.contextCode,
    },
    actionAt: row.actionAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
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

export async function listOwnNotifications(
  tx: Prisma.TransactionClient,
  userId: string,
  cursor?: string,
): Promise<NotificationPage> {
  const after = parseNotificationCursor(cursor);
  const rows = await tx.notification.findMany({
    where: {
      recipientUserId: userId,
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
    unreadCount: await tx.notification.count({ where: { recipientUserId: userId, readAt: null } }),
  };
}

export async function readOwnNotification(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
): Promise<NotificationItem> {
  if (!UUID.test(id)) throw new AuthError('NOT_FOUND');
  const [clock] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT date_trunc('milliseconds', clock_timestamp()) AS now`;
  await tx.notification.updateMany({
    where: { id, recipientUserId: userId, readAt: null },
    data: { readAt: clock!.now },
  });
  const row = await tx.notification.findFirst({ where: { id, recipientUserId: userId }, include });
  if (!row) throw new AuthError('NOT_FOUND');
  return item(row);
}

@Injectable()
export class NotificationService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<SessionService, 'withTransaction' | 'resolveForMutation'>,
  ) {}
  list(token: string | undefined, cursor?: string) {
    return this.own(token, (tx, id) => listOwnNotifications(tx, id, cursor));
  }
  count(token: string | undefined) {
    return this.own(token, async (tx, id) => ({
      unreadCount: await tx.notification.count({ where: { recipientUserId: id, readAt: null } }),
    }));
  }
  read(token: string | undefined, id: string) {
    return this.own(token, (tx, userId) => readOwnNotification(tx, userId, id));
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
