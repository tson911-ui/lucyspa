import type { BranchSummary, CurrentAccountResponse, ReassignServicesRequest, ReplacementOptionsResponse } from '@lucy-spa/contracts';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import { canAt } from './permissions';
import { errorMessage } from './workflows';

export function reassignmentBranches(account: CurrentAccountResponse, branches: ReadonlyMap<string, BranchSummary> | null) {
  return [...(branches?.values() ?? [])].filter((branch) => branch.isActive && canAt(account, 'REASSIGN_SERVICES', branch.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

export function reassignmentError(error: unknown, t: WorkforceDictionary) {
  const messages: Record<string, string> = t.reassignment.errors;
  return error instanceof ApiError && messages[error.code] ? messages[error.code]! : errorMessage(error, t);
}

/** Compose only the displayed scope/versions, selected candidate and explicit acknowledgement. */
export function reassignmentBody(options: ReplacementOptionsResponse | null, employeeUserId: string, reason: string, acknowledgeSpecific: boolean): ReassignServicesRequest | null {
  const note = reason.normalize('NFC').trim();
  if (!options || !options.candidates.some((candidate) => candidate.id === employeeUserId) ||
      [...note].length < 3 || [...note].length > 500 || !/[\p{L}\p{N}]/u.test(note) ||
      (options.requiresSpecificAcknowledgement && !acknowledgeSpecific)) return null;
  return {
    scope: options.scope, targets: options.lines.map((line) => ({ id: line.id, expectedVersion: line.version })),
    employeeUserId, context: options.lines.some((line) => line.leaveConflict) ? 'LEAVE' : 'MANAGER',
    reason: note, acknowledgeSpecific,
  };
}
