'use client';

import type {
  BranchSummary,
  EmployeeBranchAssignmentEntry,
  EmployeeBranchAssignmentsResponse,
  EmployeeResponse,
  EmploymentResponse,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Cluster,
  ConfirmDialog,
  DataTable,
  Field,
  FormDialog,
  FormGrid,
  ListSection,
  RowActions,
  Select,
  Stack,
  Tabs,
  TextInput,
  type DataTableColumn,
  type MenuItem,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { organizationDictionary } from '../../../i18n/organization';
import {
  detailActions,
  employmentEnded,
  menuOverlays,
  type DetailOverlay,
} from '../../../lib/workforce/employee-detail';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDateTime } from '../../../lib/workforce/format';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { canAnywhere } from '../../../lib/workforce/permissions';
import { runMutation } from '../../../lib/workforce/workflows';
import { branchLabel, useBranches } from '../data';
import { ManagementLevels, useManagementLevelVisible } from './management-levels';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  useResource,
  useSubmit,
  useSuccessToast,
} from '../ui';
import { EMPLOYEE_STATUS_TONE } from './employees';
import {
  AccessSection,
  EmploymentSection,
  EndDialog,
  PasswordDialog,
  ProfileDialog,
  ProfileSection,
  PromoteDialog,
  StatusDialog,
  TitleBadge,
} from './employee-lifecycle';
import { RolesSection } from './employee-roles';
import { SkillsSection } from './employee-skills';

/**
 * One workforce member (Employee management Steps 3–5) on its own page: header with the
 * edit-profile action and a `⋮` menu (classification, password, sign-in status, end of
 * employment), then tabs for profile and sign-in account, employment history, roles and
 * branches, and skills. Account status and employment classification are shown separately.
 * Actions are offered from the `/auth/me` hints; the API authorizes every command.
 */
export function EmployeeDetailScreen({ id }: { id: string }) {
  const { api, t } = useWorkforce();
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

  if (employee.error && !employee.data) {
    return <ErrorState error={employee.error} t={t} onRetry={() => void employee.reload()} />;
  }
  if (!employee.data) return <Loading t={t} />;
  return (
    <EmployeeDetail
      employee={employee.data}
      employment={employment.data}
      employmentError={employment.error}
      branches={branches.data}
      reloadAll={reloadAll}
      reloadEmployment={employment.reload}
    />
  );
}

type TabId = 'profile' | 'employment' | 'access' | 'skills';

/** The loaded detail: header, summary badges and the tabs. */
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
  const { t, locale, base } = useWorkforce();
  const { account } = useAccount();
  const notify = useSuccessToast();
  const showLevel = useManagementLevelVisible();
  const text = organizationDictionary(locale);
  const texts = t.employees.detail;
  const actions = detailActions(account, employee, employment);
  const ended = employment ? employmentEnded(employment) : false;
  const [tab, setTab] = useState<TabId>('profile');
  const [overlay, setOverlay] = useState<DetailOverlay | null>(null);
  const timeZone =
    (employee.branchIds[0] && branches?.get(employee.branchIds[0])?.timezone) || 'UTC';

  /** After a successful change: close the dialog and say what happened (the dialog reloaded first). */
  const finish = (message: string) => {
    setOverlay(null);
    notify(message);
  };
  const menuItems: Record<Exclude<DetailOverlay, 'profile'>, MenuItem> = {
    promote: {
      id: 'promote',
      label: texts.promote,
      onSelect: () => setOverlay('promote'),
    },
    password: {
      id: 'password',
      label: employee.status === 'PENDING_SETUP' ? texts.setPassword : texts.resetPassword,
      onSelect: () => setOverlay('password'),
    },
    status: {
      id: 'status',
      label: employee.status === 'INACTIVE' ? texts.reactivate : texts.deactivate,
      ...(employee.status === 'INACTIVE' ? {} : { tone: 'danger' as const }),
      onSelect: () => setOverlay('status'),
    },
    end: {
      id: 'end',
      label: texts.end,
      tone: 'danger',
      onSelect: () => setOverlay('end'),
    },
  };
  const menu = menuOverlays(actions).map((key) => menuItems[key]);

  return (
    <>
      <PageHeader
        title={employee.fullName}
        intro={employee.employeeId}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={Link}
            items={[
              { label: t.employees.title, href: `${base}/employees` },
              { label: employee.fullName },
            ]}
          />
        }
      >
        {menu.length > 0 ? <RowActions menuLabel={text.moreActions} items={menu} /> : null}
        {actions.editProfile ? (
          <Button variant="primary" icon="edit" onClick={() => setOverlay('profile')}>
            {texts.editProfile}
          </Button>
        ) : null}
      </PageHeader>
      <Cluster gap="inline">
        <span className="ls-hint">{t.employees.titleColumn}:</span>
        <TitleBadge employment={employment} />
        {showLevel ? (
          <>
            <span className="ls-hint">{text.level}:</span>
            <ManagementLevels
              appointments={employee.organizationAppointments}
              branches={branches}
            />
          </>
        ) : null}
        <span className="ls-hint">{texts.accountStatus}:</span>
        <Badge tone={EMPLOYEE_STATUS_TONE[employee.status]}>
          {t.employees.statuses[employee.status]}
        </Badge>
      </Cluster>
      <Tabs
        label={texts.tabsLabel}
        value={tab}
        onChange={(id) => setTab(id as TabId)}
        tabs={[
          {
            id: 'profile',
            label: texts.profile,
            panel: (
              <Stack gap="page">
                <ProfileSection employee={employee} />
                <AccessSection employee={employee} employment={employment} />
              </Stack>
            ),
          },
          {
            id: 'employment',
            label: texts.employment,
            panel: (
              <Stack gap="page">
                {employmentError ? (
                  <ErrorState
                    error={employmentError}
                    t={t}
                    onRetry={() => void reloadEmployment()}
                  />
                ) : null}
                {employment ? (
                  <EmploymentSection employment={employment} timeZone={timeZone} />
                ) : !employmentError ? (
                  <Loading t={t} />
                ) : null}
              </Stack>
            ),
          },
          {
            id: 'access',
            label: texts.accessTab,
            panel: (
              <Stack gap="page">
                <RolesSection
                  employee={employee}
                  ended={ended}
                  official={employment?.current?.classification === 'OFFICIAL_EMPLOYEE'}
                  branches={branches}
                />
                <BranchAssignments
                  employee={employee}
                  branches={branches}
                  reloadEmployee={reloadAll}
                />
              </Stack>
            ),
          },
          {
            id: 'skills',
            label: t.employees.skills,
            panel: <SkillsSection employee={employee} ended={ended} branches={branches} />,
          },
        ]}
      />
      {overlay === 'profile' ? (
        <ProfileDialog
          employee={employee}
          reload={reloadAll}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
      {overlay === 'promote' && employment ? (
        <PromoteDialog
          employee={employee}
          employment={employment}
          reload={reloadAll}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
      {overlay === 'end' && employment ? (
        <EndDialog
          employee={employee}
          employment={employment}
          canDisable={actions.disableWhenEnding}
          reload={reloadAll}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
      {overlay === 'password' ? (
        <PasswordDialog
          employee={employee}
          reload={reloadAll}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
      {overlay === 'status' ? (
        <StatusDialog
          employee={employee}
          reload={reloadAll}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
    </>
  );
}

type AssignmentOverlay =
  { kind: 'assign' } | { kind: 'revoke'; entry: EmployeeBranchAssignmentEntry };

/** Branch assignments: the current ones with a `⋮` end action, then the history. */
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
  const notify = useSuccessToast();
  const assignments = useResource(
    () =>
      api.get<EmployeeBranchAssignmentsResponse>(
        `/api/v1/employees/${employee.id}/branch-assignments`,
      ),
    [api, employee.id],
  );
  const [overlay, setOverlay] = useState<AssignmentOverlay | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
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
  const finish = (message: string) => {
    setOverlay(null);
    notify(message);
  };
  // Timestamps are shown in the timezone of the branch they refer to.
  const zone = (branchId: string) => branches?.get(branchId)?.timezone ?? 'UTC';

  const columns: DataTableColumn<EmployeeBranchAssignmentEntry>[] = [
    {
      key: 'branch',
      header: t.common.branch,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (entry) => branchLabel(entry.branchId, branches, t),
    },
    {
      key: 'granted',
      header: t.employees.grantedAt,
      cell: (entry) => formatDateTime(entry.grantedAt, zone(entry.branchId), locale),
    },
    ...(manage
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (entry: EmployeeBranchAssignmentEntry) => (
              <RowActions
                menuLabel={fill(t.common.list.actionsFor, {
                  name: branchLabel(entry.branchId, branches, t),
                })}
                items={[
                  {
                    id: 'revoke',
                    label: t.employees.revokeAssignment,
                    tone: 'danger',
                    onSelect: () => setOverlay({ kind: 'revoke', entry }),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];
  const historyColumns: DataTableColumn<EmployeeBranchAssignmentEntry>[] = [
    {
      key: 'branch',
      header: t.common.branch,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (entry) => branchLabel(entry.branchId, branches, t),
    },
    {
      key: 'granted',
      header: t.employees.grantedAt,
      cell: (entry) => formatDateTime(entry.grantedAt, zone(entry.branchId), locale),
    },
    {
      key: 'revoked',
      header: t.employees.revokedAt,
      cell: (entry) =>
        entry.revokedAt ? formatDateTime(entry.revokedAt, zone(entry.branchId), locale) : '…',
    },
  ];
  const history = assignments.data?.history ?? [];

  return (
    <>
      <ListSection
        title={t.employees.assignments}
        actions={
          manage ? (
            <Button
              variant="secondary"
              icon="plus"
              disabled={!assignments.data || assignable.length === 0}
              onClick={() => setOverlay({ kind: 'assign' })}
            >
              {t.employees.assign}
            </Button>
          ) : undefined
        }
      >
        {manage ? <Notice tone="info">{t.employees.assignmentNote}</Notice> : null}
        <DataTable
          mode="client"
          caption={t.employees.assignments}
          columns={columns}
          rows={assignments.data?.active ?? []}
          rowKey={(entry) => entry.id}
          loading={assignments.loading && !assignments.data}
          loadingLabel={t.common.loading}
          error={
            assignments.error ? (
              <ErrorState
                error={assignments.error}
                t={t}
                onRetry={() => void assignments.reload()}
              />
            ) : undefined
          }
          empty={assignments.data ? <Empty>{t.employees.noAssignments}</Empty> : undefined}
          paging={{ off: 'A member works at a few branches: the list is the branch count.' }}
        />
      </ListSection>
      {history.length > 0 ? (
        <ListSection title={t.employees.history} count={history.length}>
          <DataTable
            mode="client"
            caption={t.employees.history}
            columns={historyColumns}
            rows={history}
            rowKey={(entry) => entry.id}
            paging={{
              page: historyPage,
              pageSize: 20,
              onPageChange: setHistoryPage,
              labels: paginationLabels(t, t.employees.history),
            }}
          />
        </ListSection>
      ) : null}
      {overlay?.kind === 'assign' && assignments.data ? (
        <AssignBranchDialog
          employee={employee}
          version={assignments.data.version}
          assignable={assignable}
          reload={reloadAll}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
      {overlay?.kind === 'revoke' && assignments.data ? (
        <RevokeBranchDialog
          employee={employee}
          version={assignments.data.version}
          entry={overlay.entry}
          branches={branches}
          reload={reloadAll}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
    </>
  );
}

/** Add the member to one more branch. */
function AssignBranchDialog({
  employee,
  version,
  assignable,
  reload,
  onClose,
  onDone,
}: {
  employee: EmployeeResponse;
  version: number;
  assignable: BranchSummary[];
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { api, t } = useWorkforce();
  const [branchId, setBranchId] = useState('');
  const [reason, setReason] = useState('');
  const submit = useSubmit();

  async function save() {
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/employees/${employee.id}/branch-assignments`, {
              expectedVersion: version,
              branchId,
              reason,
            }),
          reload,
        ),
      '',
    );
    if (ok) {
      await reload();
      onDone(t.common.saved);
    }
  }

  return (
    <FormDialog
      title={t.employees.assign}
      labels={formOverlayLabels(t, t.employees.assign)}
      busy={submit.pending}
      dirty={branchId !== '' || reason !== ''}
      submitDisabled={branchId === '' || reason.trim() === ''}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <Field label={t.common.branch} required>
          {(control) => (
            <Select
              {...control}
              placeholder="—"
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              options={assignable.map((branch) => ({ value: branch.id, label: branch.name }))}
            />
          )}
        </Field>
        <Field label={t.common.reason} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
        <p className="ls-hint">{t.employees.assignmentNote}</p>
      </FormGrid>
    </FormDialog>
  );
}

/** End one branch assignment: a confirmation with a required reason. */
function RevokeBranchDialog({
  employee,
  version,
  entry,
  branches,
  reload,
  onClose,
  onDone,
}: {
  employee: EmployeeResponse;
  version: number;
  entry: EmployeeBranchAssignmentEntry;
  branches: Map<string, BranchSummary> | null;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { api, t } = useWorkforce();
  return (
    <ConfirmDialog
      title={t.employees.detail.revokeAssignmentTitle}
      description={t.employees.assignmentNote}
      facts={[
        { label: t.common.branch, value: branchLabel(entry.branchId, branches, t) },
        { label: t.common.name, value: employee.fullName },
      ]}
      tone="danger"
      confirmLabel={t.employees.revokeAssignment}
      busyLabel={t.common.saving}
      cancelLabel={t.common.cancel}
      referenceLabel={t.errors.reference}
      reasonField={{
        label: t.common.reason,
        required: true,
        requiredLabel: t.common.required,
        requiredMessage: t.common.form.reasonRequired,
      }}
      describeError={confirmError(t)}
      onCancel={onClose}
      onConfirm={async (reason) => {
        const outcome = await runMutation(
          () =>
            api.post(
              `/api/v1/employees/${employee.id}/branch-assignments/${entry.branchId}/revoke`,
              { expectedVersion: version, reason: reason ?? '' },
            ),
          reload,
        );
        if (!outcome.ok) throw outcome.error;
        await reload();
        onDone(t.common.saved);
      }}
    />
  );
}
