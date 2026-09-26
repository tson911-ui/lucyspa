import type {
  CollaboratorWorkCancelRequest,
  CollaboratorWorkCreateRequest,
  CollaboratorWorkListResponse,
  CollaboratorWorkMode,
  CollaboratorWorkOccurrence,
  CollaboratorWorkOptionsResponse,
  CollaboratorWorkQuery,
  CollaboratorWorkUpdateRequest,
} from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError, type WorkforceApi } from './api';
import { isCalendarDate } from './employee-create';
import { formatVnd, isVndInput } from './format';
import { errorMessage } from './workflows';

/**
 * "Lịch làm CTV / Collaborator schedule" (follow-up Step 6). The API decides everything
 * (classification on the date, assignment, branch hours, overlap, pay permission); these
 * helpers only shape requests and explain refusals.
 */
export const collaboratorWorkCommands = {
  list: (api: WorkforceApi, query: CollaboratorWorkQuery) =>
    api.get<CollaboratorWorkListResponse>('/api/v1/collaborator-work', { ...query }),
  mine: (api: WorkforceApi, from: string, to: string) =>
    api.get<CollaboratorWorkListResponse>('/api/v1/me/collaborator-work', { from, to }),
  options: (api: WorkforceApi, branchId: string, workDate: string) =>
    api.get<CollaboratorWorkOptionsResponse>('/api/v1/collaborator-work/options', {
      branchId,
      workDate,
    }),
  create: (api: WorkforceApi, body: CollaboratorWorkCreateRequest) =>
    api.post<CollaboratorWorkOccurrence>('/api/v1/collaborator-work', body),
  update: (api: WorkforceApi, id: string, body: CollaboratorWorkUpdateRequest) =>
    api.post<CollaboratorWorkOccurrence>(`/api/v1/collaborator-work/${id}`, body),
  cancel: (api: WorkforceApi, id: string, body: CollaboratorWorkCancelRequest) =>
    api.post<CollaboratorWorkOccurrence>(`/api/v1/collaborator-work/${id}/cancel`, body),
};

/** The API accepts at most 62 days per query: one week back, eight weeks ahead. */
export function scheduleRange(today: string): { from: string; to: string } {
  const shift = (days: number) =>
    new Date(Date.parse(`${today}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
  return { from: shift(-7), to: shift(54) };
}

/** Hidden (no pay visibility) shows a dash; not agreed yet shows "Chưa nhập". */
export function payLabel(
  occurrence: CollaboratorWorkOccurrence,
  t: WorkforceDictionary,
  locale: Locale,
): string {
  if (!('agreedPayVnd' in occurrence) || occurrence.agreedPayVnd === undefined) return '—';
  if (occurrence.agreedPayVnd === null) return t.collaboratorWork.payNotSet;
  return formatVnd(occurrence.agreedPayVnd, locale);
}

export interface WorkForm {
  employeeId: string;
  branchId: string;
  workDate: string;
  mode: CollaboratorWorkMode;
  startTime: string;
  endTime: string;
  agreedPayVnd: string;
  note: string;
  reason: string;
}

export const EMPTY_WORK_FORM: WorkForm = {
  employeeId: '',
  branchId: '',
  workDate: '',
  mode: 'SHIFT',
  startTime: '',
  endTime: '',
  agreedPayVnd: '',
  note: '',
  reason: '',
};

export type WorkProblem = keyof WorkforceDictionary['collaboratorWork']['problems'] | null;

/** Usability checks only; a past date's reason and every rule are enforced by the API. */
export function workFormProblem(form: WorkForm, needsReason = false): WorkProblem {
  if (form.employeeId === '') return 'employeeId';
  if (form.branchId === '') return 'branchId';
  if (!isCalendarDate(form.workDate)) return 'workDate';
  if (form.mode === 'SHIFT' && !(form.startTime !== '' && form.endTime > form.startTime)) {
    return 'times';
  }
  if (form.agreedPayVnd.trim() !== '' && !isVndInput(form.agreedPayVnd.trim())) return 'pay';
  if (needsReason && form.reason.trim() === '') return 'reason';
  return null;
}

/** Pay is sent only when entered (and the caller may set it); never computed. */
export function createRequest(form: WorkForm): CollaboratorWorkCreateRequest {
  const pay = form.agreedPayVnd.trim();
  return {
    employeeId: form.employeeId,
    branchId: form.branchId,
    workDate: form.workDate,
    mode: form.mode,
    ...(form.mode === 'SHIFT' ? { startTime: form.startTime, endTime: form.endTime } : {}),
    ...(pay !== '' ? { agreedPayVnd: pay } : {}),
    ...(form.note.trim() !== '' ? { note: form.note.trim() } : {}),
    ...(form.reason.trim() !== '' ? { reason: form.reason.trim() } : {}),
  };
}

/** Only what changed; pay only when it changed (and is shown to the caller). */
export function updateRequest(
  before: CollaboratorWorkOccurrence,
  form: WorkForm,
): CollaboratorWorkUpdateRequest {
  const request: CollaboratorWorkUpdateRequest = { expectedVersion: before.version };
  if (form.workDate !== before.workDate) request.workDate = form.workDate;
  if (form.branchId !== before.branchId) request.branchId = form.branchId;
  if (form.mode !== before.mode) request.mode = form.mode;
  if (
    form.mode === 'SHIFT' &&
    (form.startTime !== before.startTime ||
      form.endTime !== before.endTime ||
      form.mode !== before.mode)
  ) {
    request.startTime = form.startTime;
    request.endTime = form.endTime;
  }
  const pay = form.agreedPayVnd.trim();
  if ('agreedPayVnd' in before && (before.agreedPayVnd ?? '') !== pay) {
    request.agreedPayVnd = pay === '' ? null : pay;
  }
  if (form.reason.trim() !== '') request.reason = form.reason.trim();
  return request;
}

export function workFormOf(occurrence: CollaboratorWorkOccurrence): WorkForm {
  return {
    employeeId: occurrence.employeeId,
    branchId: occurrence.branchId,
    workDate: occurrence.workDate,
    mode: occurrence.mode,
    startTime: occurrence.startTime,
    endTime: occurrence.endTime,
    agreedPayVnd: occurrence.agreedPayVnd ?? '',
    note: occurrence.note ?? '',
    reason: '',
  };
}

export function workErrorMessage(error: unknown, t: WorkforceDictionary): string {
  const texts = t.collaboratorWork.errors;
  if (error instanceof ApiError) {
    if (error.code === 'CONFLICT') {
      switch (error.field) {
        case 'overlap':
          return texts.overlap;
        case 'branchHours':
          return texts.branchHours;
        case 'branchClosed':
          return texts.branchClosed;
        case 'classification':
          return texts.classification;
        case 'branchAssignment':
          return texts.branchAssignment;
        case 'status':
          return texts.status;
      }
    }
    if (error.code === 'VALIDATION_FAILED' && error.field === 'endTime') return texts.endTime;
    if (error.code === 'VALIDATION_FAILED' && error.field === 'reason') return texts.reason;
    if (error.code === 'FORBIDDEN' && error.field === 'agreedPayVnd') return texts.pay;
  }
  return errorMessage(error, t);
}
