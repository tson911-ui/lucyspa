'use client';

import type {
  BranchSummary,
  EmployeeBranchAssignmentsResponse,
  EmployeeResponse,
  EmploymentResponse,
} from '@lucy-spa/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { formatDateTime } from '../../../lib/workforce/format';
import { canAnywhere } from '../../../lib/workforce/permissions';
import { detailActions, employmentEnded } from '../../../lib/workforce/employee-detail';
import { runMutation } from '../../../lib/workforce/workflows';
import { branchLabel, useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Empty,
  ErrorState,
  Field,
  FormFeedback,
  Loading,
  Notice,
  PageHeader,
  Section,
  SubmitButton,
  useResource,
  useSubmit,
} from '../ui';
import { EMPLOYEE_STATUS_TONE } from './employees';
import {
  AccessSection,
  ClassificationBadge,
  EmploymentSection,
  ProfileSection,
} from './employee-lifecycle';
import { RolesSection } from './employee-roles';
import { SkillsSection } from './employee-skills';

/**
 * One workforce member (Employee management Steps 3–5): profile, employment classification
 * (history, promotion, ending), sign-in account (password reset, status), roles, branch
 * assignments and skills (current and removed). Account status and employment
 * classification are shown separately. Actions are offered from the `/auth/me` hints; the
 * API authorizes every command.
 */
export function EmployeeDetailScreen({ id }: { id: string }) {
  const { api, t, base } = useWorkforce();
  const employee = useResource(
    () => api.get<EmployeeResponse>(`/api/v1/employees/${id}`),
    [api, id],
  );
  const employment = useResource(
    () => api.get<EmploymentResponse>(`/api/v1/employees/${id}/employment`),
    [api, id],
  );
  const branches = useBranches(api);
  const reloadAll = async () => {
    await Promise.all([employee.reload(), employment.reload()]);
  };

  return (
    <>
      <p>
        <Link href={`${base}/employees`}>← {t.common.back}</Link>
      </p>
      {employee.loading && !employee.data ? <Loading t={t} /> : null}
      {employee.error ? (
        <ErrorState error={employee.error} t={t} onRetry={() => void employee.reload()} />
      ) : null}
      {employee.data ? (
        <EmployeeDetail
          employee={employee.data}
          employment={employment.data}
          employmentError={employment.error}
          branches={branches.data}
          reloadAll={reloadAll}
          reloadEmployment={employment.reload}
        />
      ) : null}
    </>
  );
}

/** The loaded detail: header, lifecycle sections, branch assignments and skills. */
export function EmployeeDetail({
  employee,
  employment,
  employmentError,
  branches,
  reloadAll,
  reloadEmployment,
}: {
  employee: EmployeeResponse;
  employment: EmploymentResponse | null;
  employmentError: unknown;
  branches: Map<string, BranchSummary> | null;
  reloadAll: () => Promise<void>;
  reloadEmployment: () => Promise<void>;
}) {
  const { t } = useWorkforce();
  const { account } = useAccount();
  const actions = detailActions(account, employee, employment);
  const timeZone =
    (employee.branchIds[0] && branches?.get(employee.branchIds[0])?.timezone) || 'UTC';
  return (
    <>
      <PageHeader title={employee.fullName} intro={employee.employeeId}>
        <span className="wf-header-badges">
          <span className="wf-muted wf-small">{t.employees.classification}:</span>
          <ClassificationBadge employment={employment} />
          <span className="wf-muted wf-small">{t.employees.detail.accountStatus}:</span>
          <Badge tone={EMPLOYEE_STATUS_TONE[employee.status]}>
            {t.employees.statuses[employee.status]}
          </Badge>
        </span>
      </PageHeader>
      <ProfileSection employee={employee} actions={actions} onChanged={reloadAll} />
      {employmentError ? (
        <ErrorState error={employmentError} t={t} onRetry={() => void reloadEmployment()} />
      ) : null}
      {employment ? (
        <EmploymentSection
          employee={employee}
          employment={employment}
          actions={actions}
          timeZone={timeZone}
          onChanged={reloadAll}
        />
      ) : null}
      <AccessSection
        employee={employee}
        employment={employment}
        actions={actions}
        onChanged={reloadAll}
      />
      <RolesSection
        employee={employee}
        ended={employment ? employmentEnded(employment) : false}
        branches={branches}
      />
      <BranchAssignments employee={employee} branches={branches} reloadEmployee={reloadAll} />
      <SkillsSection
        employee={employee}
        ended={employment ? employmentEnded(employment) : false}
        branches={branches}
      />
    </>
  );
}

function BranchAssignments({
  employee,
  branches,
  reloadEmployee,
}: {
  employee: EmployeeResponse;
  branches: Map<string, BranchSummary> | null;
  reloadEmployee: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const assignments = useResource(
    () =>
      api.get<EmployeeBranchAssignmentsResponse>(
        `/api/v1/employees/${employee.id}/branch-assignments`,
      ),
    [api, employee.id],
  );
  const [branchId, setBranchId] = useState('');
  const [reason, setReason] = useState('');
  const submit = useSubmit();
  // UX hint only: the API checks MANAGE_EMPLOYEE_SCOPE over every old and new branch.
  const manage =
    canAnywhere(account, 'MANAGE_EMPLOYEE_SCOPE') &&
    (account.kind === 'OWNER' || account.id !== employee.id);
  const reloadAll = async () => {
    await Promise.all([assignments.reload(), reloadEmployee()]);
  };
  const activeIds = new Set(assignments.data?.active.map((entry) => entry.branchId));
  const assignable = [...(branches?.values() ?? [])].filter(
    (branch) => branch.isActive && !activeIds.has(branch.id),
  );

  async function assign(event: FormEvent) {
    event.preventDefault();
    if (!assignments.data) return;
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/employees/${employee.id}/branch-assignments`, {
              expectedVersion: assignments.data!.version,
              branchId,
              reason,
            }),
          reloadAll,
        ),
      t.common.saved,
    );
    if (ok) {
      setBranchId('');
      setReason('');
      await reloadAll();
    }
  }

  async function revoke(target: string) {
    if (!assignments.data) return;
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/employees/${employee.id}/branch-assignments/${target}/revoke`, {
              expectedVersion: assignments.data!.version,
              reason,
            }),
          reloadAll,
        ),
      t.common.saved,
    );
    if (ok) {
      setReason('');
      await reloadAll();
    }
  }

  // Timestamps are shown in the timezone of the branch they refer to.
  const zone = (branchId: string) => branches?.get(branchId)?.timezone ?? 'UTC';
  return (
    <Section title={t.employees.assignments}>
      {manage ? <Notice tone="info">{t.employees.assignmentNote}</Notice> : null}
      {assignments.loading ? <Loading t={t} /> : null}
      {assignments.error ? (
        <ErrorState error={assignments.error} t={t} onRetry={() => void assignments.reload()} />
      ) : null}
      <FormFeedback error={submit.error} success={submit.success} t={t} />
      {assignments.data && assignments.data.active.length === 0 ? (
        <Empty>{t.employees.noAssignments}</Empty>
      ) : null}
      <ul className="wf-plain-list">
        {assignments.data?.active.map((entry) => (
          <li key={entry.id} className="wf-list-row">
            <span>
              {branchLabel(entry.branchId, branches, t)}{' '}
              <span className="wf-muted wf-small">
                {t.employees.grantedAt}{' '}
                {formatDateTime(entry.grantedAt, zone(entry.branchId), locale)}
              </span>
            </span>
            {manage ? (
              <button
                type="button"
                className="wf-button wf-button-quiet"
                disabled={submit.pending || reason.trim() === ''}
                title={t.common.reason}
                onClick={() => void revoke(entry.branchId)}
              >
                {t.employees.revokeAssignment}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {manage ? (
        <form className="wf-form" onSubmit={(event) => void assign(event)}>
          <Field id="assign-reason" label={t.common.reason} required>
            <input
              id="assign-reason"
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="wf-filters">
            <Field id="assign-branch" label={t.common.branch} required>
              <select
                id="assign-branch"
                required
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
              >
                <option value="" disabled>
                  —
                </option>
                {assignable.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </Field>
            <SubmitButton
              pending={submit.pending}
              label={t.employees.assign}
              pendingLabel={t.common.saving}
              disabled={branchId === '' || reason.trim() === ''}
            />
          </div>
        </form>
      ) : null}
      {assignments.data && assignments.data.history.length > 0 ? (
        <>
          <h3>{t.employees.history}</h3>
          <ul className="wf-plain-list">
            {assignments.data.history.map((entry) => (
              <li key={entry.id} className="wf-muted">
                {branchLabel(entry.branchId, branches, t)} ·{' '}
                {formatDateTime(entry.grantedAt, zone(entry.branchId), locale)} –{' '}
                {entry.revokedAt
                  ? formatDateTime(entry.revokedAt, zone(entry.branchId), locale)
                  : '…'}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Section>
  );
}
