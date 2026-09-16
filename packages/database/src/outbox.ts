import type { OutboxEvent, Prisma } from './generated/prisma/client.js';

export interface AppendOutboxEventInput {
  readonly id?: string;
  readonly branchId?: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly payload: Prisma.InputJsonObject;
  readonly occurredAt?: Date;
}

/**
 * Call inside the transaction that changes the source record. The caller owns
 * commit/rollback; this helper cannot publish or open a separate transaction.
 */
export async function appendOutboxEvent(
  transaction: Prisma.TransactionClient,
  input: AppendOutboxEventInput,
): Promise<OutboxEvent> {
  // PrismaClient is structurally assignable to TransactionClient; reject it at
  // runtime so an event cannot accidentally commit outside its source write.
  // $connect is unavailable inside an interactive transaction. $transaction is
  // not a discriminator: Prisma 7.10 supports nested transactions.
  if (typeof Reflect.get(transaction, '$connect') === 'function') {
    throw new Error('Appending an outbox event requires an active Prisma transaction.');
  }
  if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 1) {
    throw new Error('Outbox schemaVersion must be a positive integer.');
  }
  return transaction.outboxEvent.create({ data: { ...input } });
}
