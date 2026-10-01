'use client';

import type {
  BranchSummary,
  EmployeeAuthorizationResponse,
  EmployeeResponse,
  RoleListResponse,
} from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  Field,
  FormDialog,
  FormGrid,
  ListSection,
  RowActions,
  Select,
  Stack,
  TextInput,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import {
  assignableRoles,
  assignRequest,
  canManageRoles,
  canRevokeAt,
  grantable,
  isSelf,
  revokeRequest,
  roleCommands,
  roleErrorMessage,
  roleName,
  scopeFromKey,
  scopeKey,
  scopeLabel,
  scopeOptions,
} from '../../../lib/workforce/employee-roles';
import { ApiError } from '../../../lib/workforce/api';
import { fill } from '../../../i18n/workforce';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { runMutation } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  useResource,
  useSubmit,
  useSuccessToast,
} from '../ui';

/**
 * "Vai trò" on employee detail (Employee management Step 4). Shown to accounts with
 * MANAGE_PERMISSIONS over every branch of the employee (the API's read rule). Assign and
 * remove use the existing role-admin commands; the API enforces containment, scope,
 * self-target and Owner protection.
 */
export function RolesSection({
  employee,
  ended,
  official,
  branches,
}: {
  employee: EmployeeResponse;
  /** ENDED employment in effect: no new roles are offered (the API refuses them too). */
  ended: boolean;
  /** OFFICIAL_EMPLOYEE today: the only classification that may hold a manager-group role. */
  official: boolean;
  branches: ReadonlyMap<string, BranchSummary> | null;
}) {
  const { account } = useAccount();
  if (!canManageRoles(account, employee)) return null;
  return <RolesPanel employee={employee} ended={ended} official={official} branches={branches} />;
}

function RolesPanel({
  employee,
  ended,
  official,
  branches,
}: {
  employee: EmployeeResponse;
  ended: boolean;
  official: boolean;
  branches: ReadonlyMap<string, BranchSummary> | null;
}) {
  const { api } = useWorkforce();
  const authorization = useResource(
    () => roleCommands.authorization(api, employee.id),
    [api, employee.id],
  );
  const catalog = useResource(() => roleCommands.catalog(api), [api]);
  return (
    <RolesView
      employee={employee}
      ended={ended}
      official={official}
      branches={branches}
      authorization={authorization.data}
      catalog={catalog.data}
      loading={authorization.loading || catalog.loading}
      error={authorization.error ?? catalog.error}
      reload={async () => {
        await Promise.all([authorization.reload(), catalog.reload()]);
      }}
    />
  );
}

type RoleAssignment = EmployeeAuthorizationResponse['roleAssignments'][number];

type Overlay = { kind: 'assign' } | { kind: 'revoke'; assignment: RoleAssignment };

/** The roles view for loaded data (separated so it renders without a network). */
export function RolesView({
  employee,
  ended,
  official = true,
  branches,
  authorization,
  catalog,
  loading,
  error,
  reload,
}: {
  employee: EmployeeResponse;
  ended: boolean;
  /** Manager-group roles are offered only to an OFFICIAL_EMPLOYEE (the API enforces it). */
  official?: boolean;
  branches: ReadonlyMap<string, BranchSummary> | null;
  authorization: EmployeeAuthorizationResponse | null;
  catalog: RoleListResponse | null;
  loading: boolean;
  error: unknown;
  reload: () => Promise<void>;
}) {
  const { t, locale } = useWorkforce();
  const { account } = useAccount();
  const notify = useSuccessToast();
  const texts = t.roles;
  const self = isSelf(account, employee);
  const scopes = scopeOptions(account, employee, branches);
  const roles = assignableRoles(catalog);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const inactive = new Set(catalog?.roles.filter((role) => !role.isActive).map((role) => role.id));
  const canAssign =
    !self && !ended && authorization !== null && roles.length > 0 && scopes.length > 0;

  const finish = (message: string) => {
    setOverlay(null);
    notify(message);
  };

  const columns: DataTableColumn<RoleAssignment>[] = [
    {
      key: 'role',
      header: texts.role,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (assignment) => (
        <>
          <strong>{roleName(assignment, catalog, locale)}</strong>{' '}
          <span className="ls-hint">({assignment.roleCode})</span>
          {inactive.has(assignment.roleId) ? (
            <span className="ls-hint"> {texts.inactiveRole}</span>
          ) : null}
        </>
      ),
    },
    {
      key: 'scope',
      header: texts.scope,
      cell: (assignment) => (
        <Badge tone={assignment.scope.kind === 'GLOBAL' ? 'warning' : 'info'}>
          {scopeLabel(assignment.scope, branches, t, account.organization)}
        </Badge>
      ),
    },
    ...(!self
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (assignment: RoleAssignment) =>
              canRevokeAt(account, assignment.scope) ? (
                <RowActions
                  menuLabel={fill(t.common.list.actionsFor, {
                    name: roleName(assignment, catalog, locale),
                  })}
                  items={[
                    {
                      id: 'revoke',
                      label: texts.revoke,
                      tone: 'danger',
                      onSelect: () => setOverlay({ kind: 'revoke', assignment }),
                    },
                  ]}
                />
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <>
      <Stack gap="page">
        {error ? <ErrorState error={error} t={t} onRetry={() => void reload()} /> : null}
        {ended ? <Notice tone="warning">{texts.endedNoNewRoles}</Notice> : null}
        {!ended && catalog && roles.length === 0 ? (
          <Notice tone="info">{texts.emptyCatalog}</Notice>
        ) : null}
        {!ended && !self && roles.length > 0 && scopes.length === 0 ? (
          <Notice tone="info">{texts.noScope}</Notice>
        ) : null}
        <ListSection
          title={texts.title}
          actions={
            canAssign ? (
              <Button
                variant="secondary"
                icon="plus"
                onClick={() => setOverlay({ kind: 'assign' })}
              >
                {texts.assign}
              </Button>
            ) : undefined
          }
        >
          <p className="ls-hint">{self ? texts.selfNote : texts.intro}</p>
          {loading && !authorization ? <Loading t={t} /> : null}
          <DataTable
            mode="client"
            caption={texts.title}
            columns={columns}
            rows={authorization?.roleAssignments ?? []}
            rowKey={(assignment) => assignment.id}
            empty={authorization ? <Empty>{texts.none}</Empty> : undefined}
            paging={{ off: 'A member holds a handful of roles; the API caps the assignments.' }}
          />
          <p className="ls-hint">{texts.history}</p>
        </ListSection>
      </Stack>
      {overlay?.kind === 'assign' && authorization ? (
        <AssignRoleDialog
          employee={employee}
          authorization={authorization}
          roles={roles}
          scopes={scopes}
          official={official}
          branches={branches}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
      {overlay?.kind === 'revoke' && authorization ? (
        <RevokeRoleDialog
          employee={employee}
          authorization={authorization}
          assignment={overlay.assignment}
          catalog={catalog}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
    </>
  );
}

/** Assign one role at one scope: scope first (it decides which roles are grantable), then role. */
export function AssignRoleDialog({
  employee,
  authorization,
  roles,
  scopes,
  official,
  branches,
  reload,
  onClose,
  onDone,
}: {
  employee: EmployeeResponse;
  authorization: EmployeeAuthorizationResponse;
  roles: ReturnType<typeof assignableRoles>;
  scopes: ReturnType<typeof scopeOptions>;
  official: boolean;
  branches: ReadonlyMap<string, BranchSummary> | null;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const texts = t.roles;
  const [roleId, setRoleId] = useState('');
  const [scope, setScope] = useState('');
  const [reason, setReason] = useState('');
  const submit = useSubmit();
  const selectedScope = scopeFromKey(scope);
  const ready = selectedScope !== null && roleId !== '' && reason.trim() !== '';

  async function save() {
    if (!selectedScope || !ready) return;
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            roleCommands.assign(
              api,
              employee.id,
              assignRequest(authorization.version, roleId, selectedScope, reason),
            ),
          reload,
        ),
      '',
    );
    if (ok) {
      await reload();
      onDone(texts.assigned);
    }
  }

  return (
    <FormDialog
      title={texts.assign}
      labels={formOverlayLabels(t, texts.assign)}
      busy={submit.pending}
      dirty={scope !== '' || roleId !== '' || reason !== ''}
      submitDisabled={!ready}
      error={
        submit.error ? <Notice tone="error">{roleErrorMessage(submit.error, t)}</Notice> : undefined
      }
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <Field label={texts.scope} required>
          {(control) => (
            <Select
              {...control}
              placeholder="—"
              value={scope}
              onChange={(event) => {
                setScope(event.target.value);
                setRoleId('');
              }}
              options={scopes.map((option) => ({
                value: scopeKey(option),
                label: scopeLabel(option, branches, t, account.organization),
              }))}
            />
          )}
        </Field>
        <Field label={texts.role} required>
          {(control) => (
            <Select
              {...control}
              placeholder="—"
              value={roleId}
              disabled={!selectedScope}
              onChange={(event) => setRoleId(event.target.value)}
              options={roles.map((role) => {
                const managerBlocked = role.isManagerGroup && !official;
                const allowed =
                  !managerBlocked && (!selectedScope || grantable(account, role, selectedScope));
                const name = locale === 'vi' ? role.displayNameVi : role.displayNameEn;
                return {
                  value: role.id,
                  disabled: !allowed,
                  label: `${name} (${role.code})${
                    managerBlocked
                      ? ` — ${texts.managerOfficialOnly}`
                      : allowed
                        ? ''
                        : ` — ${texts.exceeds}`
                  }`,
                };
              })}
            />
          )}
        </Field>
        <Field label={t.common.reason} required hint={texts.reasonHint}>
          {(control) => (
            <TextInput
              {...control}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
        <p className="ls-hint">{texts.signOutNote}</p>
      </FormGrid>
    </FormDialog>
  );
}

/** Remove one role assignment: a confirmation with a required reason. */
export function RevokeRoleDialog({
  employee,
  authorization,
  assignment,
  catalog,
  reload,
  onClose,
  onDone,
}: {
  employee: EmployeeResponse;
  authorization: EmployeeAuthorizationResponse;
  assignment: RoleAssignment;
  catalog: RoleListResponse | null;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const texts = t.roles;
  return (
    <ConfirmDialog
      title={t.employees.detail.revokeRoleTitle}
      description={texts.signOutNote}
      facts={[
        { label: texts.role, value: roleName(assignment, catalog, locale) },
        { label: t.common.name, value: employee.fullName },
      ]}
      tone="danger"
      confirmLabel={texts.revoke}
      busyLabel={t.common.saving}
      cancelLabel={t.common.cancel}
      referenceLabel={t.errors.reference}
      reasonField={{
        label: t.common.reason,
        required: true,
        requiredLabel: t.common.required,
        requiredMessage: t.common.form.reasonRequired,
        hint: texts.reasonHint,
      }}
      describeError={(error) => ({
        message: roleErrorMessage(error, t),
        reference: error instanceof ApiError ? error.requestId : null,
      })}
      onCancel={onClose}
      onConfirm={async (reason) => {
        const outcome = await runMutation(
          () =>
            roleCommands.revoke(
              api,
              employee.id,
              revokeRequest(authorization.version, assignment.id, reason ?? ''),
            ),
          reload,
        );
        if (!outcome.ok) throw outcome.error;
        await reload();
        onDone(texts.revoked);
      }}
    />
  );
}
