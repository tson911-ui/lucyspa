import type {
  BranchSummary,
  CurrentAccountResponse,
  ServiceExecutionWork,
} from '@lucy-spa/contracts';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import { canAt } from './permissions';
import { errorMessage } from './workflows';

export function executionBranches(
  account: CurrentAccountResponse,
  branches: ReadonlyMap<string, BranchSummary> | null,
) {
  if (account.kind !== 'EMPLOYEE') return [];
  return [...(branches?.values() ?? [])]
    .filter((branch) => canAt(account, 'PERFORM_SERVICES', branch.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

export function executionErrorMessage(error: unknown, t: WorkforceDictionary): string {
  const messages: Record<string, string> = t.execution.errors;
  return error instanceof ApiError && messages[error.code]
    ? messages[error.code]!
    : errorMessage(error, t);
}

/** Both server permission hints and line state must agree; the API repeats every check. */
export function executionActionAllowed(line: ServiceExecutionWork, action: 'start' | 'end') {
  return action === 'start'
    ? line.status === 'PLANNED' && line.execution === null && line.actions.start
    : line.status === 'IN_PROGRESS' && line.execution?.status === 'IN_PROGRESS' && line.actions.end;
}
