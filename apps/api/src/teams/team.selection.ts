import type { TeamBulkSelection, TeamEmployeeFilters } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import { organizationId } from '../organization/organization.input.js';

export const TEAM_BATCH_SIZE = 100;

export function teamFilters(value: TeamEmployeeFilters): TeamEmployeeFilters {
  const q = value.q?.normalize('NFC').trim();
  if (q !== undefined && (q.length === 0 || [...q].length > 100 || /\p{Cc}/u.test(q)))
    throw new AuthError('VALIDATION_FAILED', 'q');
  if (value.status !== undefined && !['PENDING_SETUP', 'ACTIVE', 'INACTIVE'].includes(value.status))
    throw new AuthError('VALIDATION_FAILED', 'status');
  if (
    value.classification !== undefined &&
    !['TRAINEE', 'COLLABORATOR', 'OFFICIAL_EMPLOYEE'].includes(value.classification)
  )
    throw new AuthError('VALIDATION_FAILED', 'classification');
  if (
    value.membership !== undefined &&
    !['ALL', 'MEMBERS', 'UNASSIGNED', 'OTHER_TEAM'].includes(value.membership)
  )
    throw new AuthError('VALIDATION_FAILED', 'membership');
  return {
    ...(q === undefined ? {} : { q }),
    ...(value.status === undefined ? {} : { status: value.status }),
    ...(value.classification === undefined ? {} : { classification: value.classification }),
    ...(value.membership === undefined ? {} : { membership: value.membership }),
  };
}

export function teamSelection(value: TeamBulkSelection) {
  if ('userIds' in value) {
    const ids = [...new Set(value.userIds.map((id) => organizationId(id, 'selection')))];
    if (ids.length === 0 || ids.length > TEAM_BATCH_SIZE)
      throw new AuthError('VALIDATION_FAILED', 'selection');
    return {
      ids: ids.sort(),
      filters: {} as TeamEmployeeFilters,
      excluded: [] as string[],
      after: null,
      all: false,
    };
  }
  if (value.allMatching !== true) throw new AuthError('VALIDATION_FAILED', 'selection');
  const excluded = [
    ...new Set((value.excludedUserIds ?? []).map((id) => organizationId(id, 'selection'))),
  ];
  if (excluded.length > TEAM_BATCH_SIZE) throw new AuthError('VALIDATION_FAILED', 'selection');
  return {
    ids: null,
    filters: teamFilters(value.filters),
    excluded,
    after: value.after ? organizationId(value.after, 'selection') : null,
    all: true,
  };
}
