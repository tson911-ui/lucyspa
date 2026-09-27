import type {
  ReassignmentLineKind,
  ReassignmentScope,
  ReassignServicesRequest,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import {
  reassignServices,
  reassignmentScope,
  reassignmentWork,
  replacementOptions,
  type WorkQuery,
} from './reassignment.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const idOf = (value: string) => {
  if (typeof value !== 'string' || !UUID.test(value)) throw new AuthError('NOT_FOUND');
  return value.toLowerCase();
};
const kindOf = (kind: string): ReassignmentLineKind => {
  if (kind !== 'BOOKING' && kind !== 'VISIT') throw new AuthError('NOT_FOUND');
  return kind;
};
const scopeOf = (scope: string): ReassignmentScope => {
  if (scope !== 'LINE' && scope !== 'PARTICIPANT')
    throw new AuthError('VALIDATION_FAILED', 'scope');
  return scope;
};

export function normalizeReassignment(input: ReassignServicesRequest): ReassignServicesRequest {
  const scope = scopeOf(input.scope);
  const reason = typeof input.reason === 'string' ? input.reason.normalize('NFC').trim() : '';
  if ([...reason].length < 3 || [...reason].length > 500 || !/[\p{L}\p{N}]/u.test(reason))
    throw new AuthError('VALIDATION_FAILED', 'reason');
  if (input.context !== 'LEAVE' && input.context !== 'MANAGER')
    throw new AuthError('VALIDATION_FAILED', 'context');
  if (typeof input.acknowledgeSpecific !== 'boolean')
    throw new AuthError('VALIDATION_FAILED', 'acknowledgeSpecific');
  if (
    !Array.isArray(input.targets) ||
    input.targets.length < 1 ||
    input.targets.length > 20 ||
    input.targets.some(
      (target) =>
        !target ||
        !UUID.test(target.id) ||
        !Number.isInteger(target.expectedVersion) ||
        target.expectedVersion < 1 ||
        target.expectedVersion > 2_147_483_647,
    )
  )
    throw new AuthError('VALIDATION_FAILED', 'targets');
  if (!UUID.test(input.employeeUserId)) throw new AuthError('VALIDATION_FAILED', 'employeeUserId');
  const targets = input.targets.map((target) => ({
    id: target.id.toLowerCase(),
    expectedVersion: target.expectedVersion,
  }));
  if (new Set(targets.map((target) => target.id)).size !== targets.length)
    throw new AuthError('VALIDATION_FAILED', 'targets');
  return {
    scope,
    reason,
    context: input.context,
    acknowledgeSpecific: input.acknowledgeSpecific,
    employeeUserId: input.employeeUserId.toLowerCase(),
    targets,
  };
}

/** Translate only safe concurrency outcomes, inside the frame so its rollback remains atomic. */
export function reassignmentFailure(error: unknown): never {
  if (error instanceof AuthError) throw error;
  const meta = Reflect.get(Object(error), 'meta');
  const state = sqlStateOf(error) ?? (meta ? Reflect.get(Object(meta), 'code') : undefined);
  if (
    ['55P03', '40P01', '40001', '23505', '23P01'].includes(state ?? '') ||
    ['P2002', 'P2034'].includes(Reflect.get(Object(error), 'code'))
  ) {
    throw new AuthError('REASSIGNMENT_CONFLICT');
  }
  throw error;
}

@Injectable()
export class ReassignmentService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  list(token: string | undefined, branch: string, query: WorkQuery) {
    const id = idOf(branch);
    return this.read(token, (context) => reassignmentWork(context, id, query));
  }

  replacements(token: string | undefined, rawKind: string, identifier: string, rawScope: string) {
    const kind = kindOf(rawKind);
    const id = idOf(identifier);
    const scope = scopeOf(rawScope);
    return this.read(token, (context) => replacementOptions(context, kind, id, scope));
  }

  reassign(
    token: string | undefined,
    rawKind: string,
    identifier: string,
    body: ReassignServicesRequest,
    requestId?: string,
  ) {
    const kind = kindOf(rawKind);
    const id = idOf(identifier);
    const input = normalizeReassignment(body);
    let lockedUsers = new Set<string>();
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      {
        exclusive: false,
        requestId,
        lockUsers: async (tx) => {
          const hint = await reassignmentScope(tx, kind, id, input.scope);
          lockedUsers = new Set(
            [
              input.employeeUserId,
              ...hint.flatMap((line) => [
                line.view.employee.id,
                ...(line.ownerId ? [line.ownerId] : []),
              ]),
            ].filter(Boolean),
          );
          return [...lockedUsers];
        },
      },
      async (context) => {
        try {
          return await reassignServices(context, kind, id, input, lockedUsers);
        } catch (error) {
          return reassignmentFailure(error);
        }
      },
    );
  }

  private read<T>(token: string | undefined, work: (context: AdminContext) => Promise<T>) {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false },
      work,
    );
  }
}
