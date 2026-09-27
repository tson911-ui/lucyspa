import {
  appendOutboxEvent,
  isValidBookingSetting,
  type DatabaseClient,
  type Prisma,
} from '@lucy-spa/database';
import { takeSharedAuthGraphLock } from '@lucy-spa/server';
import { deliverInbox, operationalRecipients } from './notification-delivery.js';

export type WarningKind = 'START_OVERDUE' | 'PRE_END' | 'END_OVERDUE';
export const WARNING_SETTINGS = {
  START_OVERDUE: 'service.startOverdueMinutes',
  PRE_END: 'service.warningLeadMinutes',
  END_OVERDUE: 'service.endOverdueMinutes',
} as const;
const include = { visit: true, execution: true } as const;
export type WarningLine = Prisma.VisitServiceLineGetPayload<{ include: typeof include }>;
export interface WarningTimer {
  id: string;
  lineId: string;
  kind: string;
  targetAt: Date;
  dueAt: Date;
}

export function warningTarget(line: WarningLine, kind: WarningKind): Date | null {
  if (!['OPEN', 'IN_SERVICE'].includes(line.visit.status) || !line.employeeUserId) return null;
  if (kind === 'START_OVERDUE') {
    return line.status === 'PLANNED' && !line.execution && !line.startOverdueWarnedAt
      ? line.plannedStartAt
      : null;
  }
  const execution = line.execution;
  if (
    line.status !== 'IN_PROGRESS' ||
    !execution ||
    execution.status !== 'IN_PROGRESS' ||
    execution.endedAt ||
    execution.employeeUserId !== line.employeeUserId
  )
    return null;
  if (kind === 'PRE_END' ? execution.preEndWarnedAt : execution.endOverdueWarnedAt) return null;
  // Step 7 persisted this from server START + duration snapshot. Do not use planned end.
  return execution.expectedEndAt;
}

export function warningDueAt(target: Date, kind: WarningKind, minutes: number) {
  return new Date(target.getTime() + (kind === 'PRE_END' ? -1 : 1) * minutes * 60_000);
}

/** Durable first-scheduling snapshot, preserved across Redis loss and setting changes. */
export async function ensureWarningSchedules(
  tx: Prisma.TransactionClient,
  lineId: string,
): Promise<WarningTimer[]> {
  const line = await tx.visitServiceLine.findUnique({ where: { id: lineId }, include });
  if (!line) return [];
  const result: WarningTimer[] = [];
  for (const kind of Object.keys(WARNING_SETTINGS) as WarningKind[]) {
    const targetAt = warningTarget(line, kind);
    if (!targetAt) continue;
    const key = { lineId, kind, targetAt };
    let schedule = await tx.serviceWarningSchedule.findUnique({
      where: { lineId_kind_targetAt: key },
    });
    if (!schedule) {
      const setting = await tx.appSetting.findUnique({ where: { key: WARNING_SETTINGS[kind] } });
      if (!setting || !isValidBookingSetting(setting.key, setting.value))
        throw new Error('Missing warning setting');
      // Concurrent recovery/outbox handlers may both insert. The winner defines the snapshot.
      await tx.serviceWarningSchedule.createMany({
        skipDuplicates: true,
        data: [
          {
            ...key,
            dueAt: warningDueAt(targetAt, kind, setting.value as number),
          },
        ],
      });
      schedule = await tx.serviceWarningSchedule.findUniqueOrThrow({
        where: { lineId_kind_targetAt: key },
      });
    }
    result.push(schedule);
  }
  return result;
}

/** Shared by delayed jobs and recovery. Warning facts, outbox and inbox commit together. */
export async function processServiceWarning(
  database: DatabaseClient,
  scheduleId: string,
): Promise<'emitted' | 'stale' | 'early'> {
  return database.$transaction(async (tx) => {
    await takeSharedAuthGraphLock(tx);
    const timer = await tx.serviceWarningSchedule.findUnique({ where: { id: scheduleId } });
    if (!timer) return 'stale';
    const hint = await tx.visitServiceLine.findUnique({
      where: { id: timer.lineId },
      select: { visitId: true },
    });
    if (!hint) return 'stale';
    // Source START/END/cancellation/reassignment all serialize on this parent, then line.
    await tx.$queryRaw`SELECT id FROM visits WHERE id = ${hint.visitId}::uuid FOR UPDATE NOWAIT`;
    await tx.$queryRaw`SELECT id FROM visit_service_lines WHERE id = ${timer.lineId}::uuid FOR UPDATE NOWAIT`;
    await tx.$queryRaw`SELECT id FROM service_executions WHERE visit_service_line_id = ${timer.lineId}::uuid FOR UPDATE NOWAIT`;
    const line = await tx.visitServiceLine.findUniqueOrThrow({
      where: { id: timer.lineId },
      include,
    });
    const kind = timer.kind as WarningKind;
    const target = warningTarget(line, kind);
    if (!target || target.getTime() !== timer.targetAt.getTime()) return 'stale';
    const [clock] = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT date_trunc('milliseconds', clock_timestamp()) AS now`;
    const now = clock!.now;
    if (now < timer.dueAt) return 'early';
    const recipients = await operationalRecipients(
      tx,
      line.visit.branchId,
      [line.employeeUserId!],
      true,
    );
    if (kind === 'START_OVERDUE') {
      await tx.visitServiceLine.update({
        where: { id: line.id },
        data: { startOverdueWarnedAt: now, rowVersion: { increment: 1 } },
      });
    } else {
      await tx.serviceExecution.update({
        where: { id: line.execution!.id },
        data: {
          ...(kind === 'PRE_END' ? { preEndWarnedAt: now } : { endOverdueWarnedAt: now }),
          rowVersion: { increment: 1 },
        },
      });
    }
    const event = await appendOutboxEvent(tx, {
      branchId: line.visit.branchId,
      aggregateType: 'Visit',
      aggregateId: line.visitId,
      eventType: 'SERVICE_WARNING_DUE',
      schemaVersion: 1,
      occurredAt: now,
      payload: {
        kind,
        scheduleId: timer.id,
        lineId: line.id,
        executionId: line.execution?.id ?? null,
        employeeUserId: line.employeeUserId,
        targetAt: target.toISOString(),
        dueAt: timer.dueAt.toISOString(),
      },
    });
    await deliverInbox(
      tx,
      event,
      { type: 'Visit', id: line.visitId, code: line.visit.code },
      recipients.map((id) => ({ id, type: kind })),
    );
    // This worker consumed the warning in the same locked transaction, avoiding delivery lag
    // that could otherwise notify an old assignee after a subsequent reassignment.
    await tx.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: now } });
    return 'emitted';
  });
}
