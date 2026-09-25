'use client';

import type {
  BranchSummary,
  EmployeeAuthorizationResponse,
  EmployeeResponse,
  RoleListResponse,
} from '@lucy-spa/contracts';
import { useState, type FormEvent } from 'react';
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
import { runMutation } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Empty,
  ErrorState,
  Field,
  Loading,
  Notice,
  Section,
  SubmitButton,
  useResource,
  useSubmit,
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
  branches,
}: {
  employee: EmployeeResponse;
  /** ENDED employment in effect: no new roles are offered (the API refuses them too). */
  ended: boolean;
  branches: ReadonlyMap<string, BranchSummary> | null;
}) {
  const { account } = useAccount();
  if (!canManageRoles(account, employee)) return null;
  return <RolesPanel employee={employee} ended={ended} branches={branches} />;
}

function RolesPanel({
  employee,
  ended,
  branches,
}: {
  employee: EmployeeResponse;
  ended: boolean;
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

/** The roles view for loaded data (separated so it renders without a network). */
export function RolesView({
  employee,
  ended,
  branches,
  authorization,
  catalog,
  loading,
  error,
  reload,
}: {
  employee: EmployeeResponse;
  ended: boolean;
  branches: ReadonlyMap<string, BranchSummary> | null;
  authorization: EmployeeAuthorizationResponse | null;
  catalog: RoleListResponse | null;
  loading: boolean;
  error: unknown;
  reload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const texts = t.roles;
  const self = isSelf(account, employee);
  const scopes = scopeOptions(account, employee, branches);
  const roles = assignableRoles(catalog);
  const [roleId, setRoleId] = useState('');
  const [scope, setScope] = useState('');
  const [reason, setReason] = useState('');
  const submit = useSubmit();
  const selectedScope = scopeFromKey(scope);
  const inactive = new Set(catalog?.roles.filter((role) => !role.isActive).map((role) => role.id));

  async function assign(event: FormEvent) {
    event.preventDefault();
    if (!authorization || !selectedScope || roleId === '' || reason.trim() === '') return;
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
      texts.assigned,
    );
    if (ok) {
      setRoleId('');
      setReason('');
      await reload();
    }
  }

  async function revoke(assignmentId: string) {
    if (!authorization || reason.trim() === '') return;
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            roleCommands.revoke(
              api,
              employee.id,
              revokeRequest(authorization.version, assignmentId, reason),
            ),
          reload,
        ),
      texts.revoked,
    );
    if (ok) {
      setReason('');
      await reload();
    }
  }

  return (
    <Section title={texts.title}>
      <p className="wf-muted">{texts.intro}</p>
      {loading && !authorization ? <Loading t={t} /> : null}
      {error ? <ErrorState error={error} t={t} onRetry={() => void reload()} /> : null}
      {submit.error ? <Notice tone="error">{roleErrorMessage(submit.error, t)}</Notice> : null}
      {submit.success ? <Notice tone="success">{submit.success}</Notice> : null}
      {authorization && authorization.roleAssignments.length === 0 ? (
        <Empty>{texts.none}</Empty>
      ) : null}
      <ul className="wf-plain-list">
        {authorization?.roleAssignments.map((assignment) => (
          <li key={assignment.id} className="wf-list-row">
            <span>
              <strong>{roleName(assignment, catalog, locale)}</strong>{' '}
              <span className="wf-muted wf-small">({assignment.roleCode})</span>{' '}
              <Badge tone={assignment.scope.kind === 'GLOBAL' ? 'warning' : 'info'}>
                {scopeLabel(assignment.scope, branches, t)}
              </Badge>
              {inactive.has(assignment.roleId) ? (
                <span className="wf-muted wf-small"> {texts.inactiveRole}</span>
              ) : null}
            </span>
            {!self && canRevokeAt(account, assignment.scope) ? (
              <button
                type="button"
                className="wf-button wf-button-quiet"
                disabled={submit.pending || reason.trim() === ''}
                title={texts.reasonHint}
                onClick={() => void revoke(assignment.id)}
              >
                {texts.revoke}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {self ? <p className="wf-hint">{texts.selfNote}</p> : null}
      {ended ? <Notice tone="warning">{texts.endedNoNewRoles}</Notice> : null}
      {!self && authorization ? (
        <form className="wf-form wf-member-form" onSubmit={(event) => void assign(event)}>
          <Field id="role-reason" label={t.common.reason} required hint={texts.reasonHint}>
            <input
              id="role-reason"
              required
              maxLength={500}
              aria-describedby="role-reason-hint"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {!ended && catalog && roles.length === 0 ? (
            <Notice tone="info">{texts.emptyCatalog}</Notice>
          ) : null}
          {!ended && scopes.length === 0 ? <p className="wf-hint">{texts.noScope}</p> : null}
          {!ended && roles.length > 0 && scopes.length > 0 ? (
            <>
              <div className="wf-row">
                <Field id="role-scope" label={texts.scope} required>
                  <select
                    id="role-scope"
                    required
                    value={scope}
                    onChange={(event) => {
                      setScope(event.target.value);
                      setRoleId('');
                    }}
                  >
                    <option value="" disabled>
                      —
                    </option>
                    {scopes.map((option) => (
                      <option key={scopeKey(option)} value={scopeKey(option)}>
                        {scopeLabel(option, branches, t)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="role-id" label={texts.role} required>
                  <select
                    id="role-id"
                    required
                    value={roleId}
                    disabled={!selectedScope}
                    onChange={(event) => setRoleId(event.target.value)}
                  >
                    <option value="" disabled>
                      —
                    </option>
                    {roles.map((role) => {
                      const allowed = !selectedScope || grantable(account, role, selectedScope);
                      return (
                        <option key={role.id} value={role.id} disabled={!allowed}>
                          {locale === 'vi' ? role.displayNameVi : role.displayNameEn} ({role.code})
                          {allowed ? '' : ` — ${texts.exceeds}`}
                        </option>
                      );
                    })}
                  </select>
                </Field>
              </div>
              <p className="wf-hint">{texts.signOutNote}</p>
              <SubmitButton
                pending={submit.pending}
                label={texts.assign}
                pendingLabel={t.common.saving}
                disabled={roleId === '' || !selectedScope || reason.trim() === ''}
              />
            </>
          ) : null}
        </form>
      ) : null}
      <p className="wf-hint">{texts.history}</p>
    </Section>
  );
}
