import type { AuthorizationScope } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import { text } from '../auth/registration.js';
import { isUuid } from '../employees/employee.input.js';

export function organizationId(value: string, field = 'id'): string {
  const id = value.toLowerCase();
  if (!isUuid(id)) throw new AuthError('VALIDATION_FAILED', field);
  return id;
}

export function organizationCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(code)) throw new AuthError('VALIDATION_FAILED', 'code');
  return code;
}

export function organizationName(value: string): string {
  return text(value, 'name', 150);
}

export function organizationScope(scope: AuthorizationScope): AuthorizationScope {
  if (scope.kind === 'GLOBAL') return { kind: 'GLOBAL' };
  if (scope.kind === 'REGION')
    return { kind: 'REGION', regionId: organizationId(scope.regionId, 'scope') };
  if (scope.kind === 'AREA') return { kind: 'AREA', areaId: organizationId(scope.areaId, 'scope') };
  if (scope.kind === 'BRANCH')
    return { kind: 'BRANCH', branchId: organizationId(scope.branchId, 'scope') };
  throw new AuthError('VALIDATION_FAILED', 'scope');
}

export function scopeData(scope: AuthorizationScope) {
  return {
    scopeKind: scope.kind,
    regionId: scope.kind === 'REGION' ? scope.regionId : null,
    areaId: scope.kind === 'AREA' ? scope.areaId : null,
    branchId: scope.kind === 'BRANCH' ? scope.branchId : null,
  };
}

export function scopeFrom(row: {
  scopeKind: string;
  regionId: string | null;
  areaId: string | null;
  branchId: string | null;
}): AuthorizationScope {
  if (row.scopeKind === 'REGION' && row.regionId) return { kind: 'REGION', regionId: row.regionId };
  if (row.scopeKind === 'AREA' && row.areaId) return { kind: 'AREA', areaId: row.areaId };
  if (row.scopeKind === 'BRANCH' && row.branchId) return { kind: 'BRANCH', branchId: row.branchId };
  return { kind: 'GLOBAL' };
}

export function pageInput(page?: string, limit?: string) {
  const number = page === undefined ? 1 : Number(page);
  const size = limit === undefined ? 50 : Number(limit);
  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > 1_000_000 ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 100
  ) {
    throw new AuthError('VALIDATION_FAILED', 'page');
  }
  return { number, size };
}
