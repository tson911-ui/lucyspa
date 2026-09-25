import type {
  EmployeeResponse,
  EmployeeSkillGrantRequest,
  EmployeeSkillRevokeRequest,
  EmployeeSkillsResponse,
  SkillListResponse,
  SkillResponse,
} from '@lucy-spa/contracts';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError, type WorkforceApi } from './api';
import { canAcross, type Account } from './permissions';
import { errorMessage } from './workflows';

/**
 * Employee skills on employee detail (Employee management Step 5): what services the member
 * is qualified to perform. Skills are employee-level qualifications from the existing skill
 * catalog — never a role, permission, classification, status or branch. Grants are kept as
 * history when removed. The API enforces MANAGE_SKILLS over every branch, no self changes,
 * no new skills for INACTIVE accounts or ENDED employment.
 */

/** MANAGE_SKILLS over every branch of the member, never on oneself (unless Owner). */
export function canManageSkills(account: Account, employee: EmployeeResponse): boolean {
  const other = account.kind === 'OWNER' || account.id !== employee.id;
  return other && canAcross(account, 'MANAGE_SKILLS', employee.branchIds);
}

/** New grants: active catalog skills the member does not currently hold. */
export function assignableSkills(
  catalog: SkillListResponse | null,
  held: EmployeeSkillsResponse | null,
): SkillResponse[] {
  const current = new Set(held?.skills.map((entry) => entry.skill.id));
  return (catalog?.skills ?? []).filter((skill) => skill.isActive && !current.has(skill.id));
}

/** Why assigning is not offered, if it is not (the API refuses these cases too). */
export function assignBlocker(
  employee: EmployeeResponse,
  ended: boolean,
): 'ended' | 'inactive' | null {
  if (ended) return 'ended';
  if (employee.status === 'INACTIVE') return 'inactive';
  return null;
}

/** Optional reason (the existing commands accept one; blank is omitted). */
export function grantRequest(skillId: string, reason: string): EmployeeSkillGrantRequest {
  const trimmed = reason.trim();
  return trimmed ? { skillId, reason: trimmed } : { skillId };
}

export function revokeRequest(reason: string): EmployeeSkillRevokeRequest {
  const trimmed = reason.trim();
  return trimmed ? { reason: trimmed } : {};
}

export const skillCommands = {
  catalog: (api: WorkforceApi) => api.get<SkillListResponse>('/api/v1/skills'),
  employee: (api: WorkforceApi, id: string) =>
    api.get<EmployeeSkillsResponse>(`/api/v1/employees/${id}/skills`),
  grant: (api: WorkforceApi, id: string, body: EmployeeSkillGrantRequest) =>
    api.post<EmployeeSkillsResponse>(`/api/v1/employees/${id}/skills`, body),
  revoke: (api: WorkforceApi, id: string, skillId: string, body: EmployeeSkillRevokeRequest) =>
    api.post<EmployeeSkillsResponse>(`/api/v1/employees/${id}/skills/${skillId}/revoke`, body),
};

export function skillErrorMessage(error: unknown, t: WorkforceDictionary): string {
  const texts = t.employees.skillsSection;
  if (error instanceof ApiError) {
    if (error.code === 'CONFLICT' && error.field === 'employment') return texts.ended;
    if (error.code === 'CONFLICT' && error.field === 'status') return texts.inactive;
    if (error.code === 'CONFLICT' && error.field === 'skillId') return texts.alreadyHeld;
    if (error.code === 'VALIDATION_FAILED' && error.field === 'skillId') return texts.unavailable;
  }
  return errorMessage(error, t);
}
