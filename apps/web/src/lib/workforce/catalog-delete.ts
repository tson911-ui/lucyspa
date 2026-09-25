import type { CatalogDeleteResponse } from '@lucy-spa/contracts';
import { fill, type WorkforceDictionary } from '../../i18n/workforce';
import { ApiError, type WorkforceApi } from './api';
import { errorMessage } from './workflows';

/**
 * Permanent deletion of an incorrectly created service or service category. This is not
 * deactivation ("Ngừng hoạt động"): the record is removed and only its audit snapshot
 * remains. The API authorizes and validates every deletion; the UI only asks for
 * confirmation and explains refusals.
 */
export type DeleteKind = 'service' | 'category';

export interface DeleteTarget {
  kind: DeleteKind;
  id: string;
  name: string;
  code: string;
  version: number;
}

export function deletePath(target: Pick<DeleteTarget, 'kind' | 'id'>): string {
  return target.kind === 'service'
    ? `/api/v1/services/${target.id}/delete`
    : `/api/v1/service-categories/${target.id}/delete`;
}

/** Sends the confirmed deletion; only called after the user confirmed in the dialog. */
export function requestDelete(
  api: Pick<WorkforceApi, 'post'>,
  target: DeleteTarget,
): Promise<CatalogDeleteResponse> {
  return api.post<CatalogDeleteResponse>(deletePath(target), {
    expectedVersion: target.version,
  });
}

/** Refusals explained in the user's language, including what to do instead. */
export function deleteErrorMessage(
  error: unknown,
  kind: DeleteKind,
  t: WorkforceDictionary,
): string {
  if (error instanceof ApiError && error.code === 'CONFLICT') {
    if (kind === 'category' && error.field === 'services')
      return t.services.deleteCategoryHasServices;
    if (kind === 'service' && error.field === 'inUse') return t.services.deleteServiceInUse;
  }
  return errorMessage(error, t);
}

export function deletedMessage(target: DeleteTarget, t: WorkforceDictionary): string {
  return fill(target.kind === 'service' ? t.services.deletedService : t.services.deletedCategory, {
    name: target.name,
  });
}

/** Removes a deleted record from a displayed list immediately, before the list reloads. */
export function withoutDeleted<T extends { id: string }>(
  rows: readonly T[],
  deleted: ReadonlySet<string>,
): T[] {
  return rows.filter((row) => !deleted.has(row.id));
}
