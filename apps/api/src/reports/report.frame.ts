import { REPORT_LIMITS, type PermissionCodeName, type ReportBranchRef } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Logger } from '@nestjs/common';
import type { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { capabilityDigest } from '../auth/crypto.js';
import type { SessionService } from '../auth/session.service.js';
import type { AdminActor } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { loadAuthorityGraph } from '../authorization/authorization.store.js';
import { isUuid } from '../employees/employee.input.js';

/**
 * Phase 8 (P8-T1, P8-T8): the one frame every report runs in.
 *
 * - **Read-only is enforced by the database**, not promised: the transaction is READ ONLY (and one REPEATABLE READ snapshot, so the
 *   parts of a report always add up to its total while payments arrive) with a statement timeout. A write inside it fails.
 * - Authority is decided from the person's own authority graph, never a role name. A report covers exactly the branches where the
 *   person holds EVERY permission the report needs; a `branchId` parameter can only narrow that set, never widen it.
 * - No row lock is taken (the admin command frame locks the actor's user row, which would serialise the widgets of one dashboard).
 */

export type ReportKind = 'dashboard' | 'report' | 'export';

const TIMEOUT_MS: Record<ReportKind, number> = {
  dashboard: REPORT_LIMITS.dashboardTimeoutMs,
  report: REPORT_LIMITS.reportTimeoutMs,
  export: REPORT_LIMITS.exportTimeoutMs,
};

export interface ReportBranch extends ReportBranchRef {
  timezone: string;
}

export interface ReportContext {
  readonly tx: Prisma.TransactionClient;
  /** The database clock at the start of the report. */
  readonly now: Date;
  readonly actor: AdminActor;
  /** Every active branch (the boundary of a day is each branch's own time zone). */
  readonly allBranches: readonly ReportBranch[];
  /** Whether the person holds the permission at the branch. */
  can: (permission: PermissionCodeName, branchId: string) => boolean;
  /**
   * The branches this report covers for the person: those where every `requires` permission holds. `branchId` (a filter) must be one
   * of them. Nothing at all is FORBIDDEN (a report never reveals what the person may not read).
   */
  scope: (requires: readonly PermissionCodeName[], branchId?: unknown) => ReportBranch[];
}

export interface ReportFrameDependencies {
  readonly sessions: Pick<SessionService, 'withReadOnlyTransaction' | 'resolve'>;
  readonly throttle: Pick<AuthThrottleService, 'now'>;
}

const logger = new Logger('Reports');

export async function runReport<T>(
  dependencies: ReportFrameDependencies,
  sessionToken: string | undefined,
  kind: ReportKind,
  work: (context: ReportContext) => Promise<T>,
): Promise<T> {
  if (sessionToken === undefined || capabilityDigest(sessionToken) === null) {
    throw new AuthError('AUTHENTICATION_REQUIRED');
  }
  const { sessions, throttle } = dependencies;
  try {
    return await sessions.withReadOnlyTransaction(
      async (tx) => {
        const principal = await sessions.resolve(sessionToken, tx);
        if (principal?.kind !== 'AUTHENTICATED' || principal.userId === null) {
          throw new AuthError('AUTHENTICATION_REQUIRED');
        }
        // Customers never reach the workforce reports.
        if (principal.userKind !== 'OWNER' && principal.userKind !== 'EMPLOYEE') {
          throw new AuthError('FORBIDDEN');
        }
        const graph = await loadAuthorityGraph(tx, principal.userId);
        if (!graph) throw new AuthError('AUTHENTICATION_REQUIRED');
        const actor: AdminActor = {
          principal,
          graph,
          userId: principal.userId,
          owner: graph.kind === 'OWNER',
        };
        const rows = await tx.branch.findMany({
          where: { isActive: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          select: { id: true, code: true, name: true, timezone: true },
        });
        const allBranches: ReportBranch[] = rows;
        const can = (permission: PermissionCodeName, branchId: string) =>
          decide(graph, permission, { kind: 'BRANCH', branchId });
        const scope = (requires: readonly PermissionCodeName[], branchId?: unknown) => {
          const allowed = allBranches.filter((branch) =>
            requires.every((permission) => can(permission, branch.id)),
          );
          if (allowed.length === 0) throw new AuthError('FORBIDDEN');
          if (branchId === undefined || branchId === null || branchId === '') return allowed;
          if (typeof branchId !== 'string' || !isUuid(branchId.toLowerCase())) {
            throw new AuthError('VALIDATION_FAILED', 'branchId');
          }
          const hit = allowed.find((branch) => branch.id === branchId.toLowerCase());
          if (!hit) throw new AuthError('FORBIDDEN');
          return [hit];
        };
        return work({ tx, now: await throttle.now(tx), actor, allBranches, can, scope });
      },
      { statementTimeoutMs: TIMEOUT_MS[kind] },
    );
  } catch (error) {
    if (error instanceof AuthError) throw error;
    // 57014 = the statement timeout (query_canceled); the report is too big for the period asked.
    if (
      /57014|canceling statement due to statement timeout/i.test(
        JSON.stringify(Object(error)) + String(error),
      )
    ) {
      throw new AuthError('REPORT_TIMEOUT');
    }
    logger.error(`report failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new AuthError('SERVICE_UNAVAILABLE');
  }
}
