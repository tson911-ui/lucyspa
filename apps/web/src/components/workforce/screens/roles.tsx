'use client';

import type { PermissionCodeName, RoleListResponse, RoleResponse } from '@lucy-spa/contracts';
import { useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  activationRequest,
  canBundle,
  canEditRoles,
  createRequest,
  groupedCatalog,
  namesRequest,
  permissionLabel,
  permissionsRequest,
  roleAdminCommands,
  roleAdminErrorMessage,
  roleCodePreview,
  roleDisplayName,
} from '../../../lib/workforce/role-admin';
import { runMutation } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Empty,
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeader,
  Section,
  SubmitButton,
  useResource,
  useSubmit,
} from '../ui';

/**
 * "Vai trò & quyền" (Employee management Step 4B): the role catalog from the existing
 * role-admin API. Roles are permission bundles; where they apply is chosen per assignment
 * on employee detail. No default roles, no deletion (roles are switched off instead).
 */
export function RolesScreen() {
  const { api } = useWorkforce();
  const catalog = useResource(() => roleAdminCommands.list(api), [api]);
  return (
    <RolesAdminView
      catalog={catalog.data}
      loading={catalog.loading}
      error={catalog.error}
      reload={catalog.reload}
    />
  );
}

export function RolesAdminView({
  catalog,
  loading,
  error,
  reload,
}: {
  catalog: RoleListResponse | null;
  loading: boolean;
  error: unknown;
  reload: () => Promise<void>;
}) {
  const { t } = useWorkforce();
  const { account } = useAccount();
  const texts = t.roleAdmin;
  const editable = canEditRoles(account);
  // Page-level notice: edit forms reset after each reload (fresh role version).
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <PageHeader title={texts.title} intro={texts.intro} />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {!editable ? <Notice tone="info">{texts.readOnlyNote}</Notice> : null}
      {editable && catalog ? (
        <section className="wf-section" aria-label={texts.create}>
          <CreateRoleForm
            catalog={catalog}
            onCreated={async (role) => {
              setNotice(fill(texts.created, { name: role.displayNameVi }));
              await reload();
            }}
          />
        </section>
      ) : null}
      <Section title={t.nav.roles}>
        {loading && !catalog ? <Loading t={t} /> : null}
        {error ? <ErrorState error={error} t={t} onRetry={() => void reload()} /> : null}
        {catalog && catalog.roles.length === 0 ? <Empty>{texts.empty}</Empty> : null}
        {catalog?.roles.map((role) => (
          <RoleCard
            key={role.id}
            role={role}
            catalog={catalog}
            editable={editable}
            reload={reload}
            onSaved={setNotice}
          />
        ))}
      </Section>
      <Section title={texts.scopeTitle}>
        <p className="wf-muted">{texts.scopeHelp}</p>
      </Section>
    </>
  );
}

/** Grouped checklist over the loaded catalog; codes the actor cannot add are disabled. */
export function PermissionChecklist({
  idPrefix,
  catalog,
  selected,
  original = [],
  onChange,
  disabled,
}: {
  idPrefix: string;
  catalog: RoleListResponse;
  selected: readonly PermissionCodeName[];
  /** Permissions already in the role: removing them is never blocked by containment. */
  original?: readonly PermissionCodeName[];
  onChange: (next: PermissionCodeName[]) => void;
  disabled?: boolean;
}) {
  const { t } = useWorkforce();
  const { account } = useAccount();
  const texts = t.roleAdmin;
  return (
    <>
      <p className="wf-hint">{texts.scopeLegend}</p>
      {groupedCatalog(catalog).map(({ group, entries }) => (
        <fieldset key={group} className="wf-checklist" disabled={disabled}>
          <legend className="wf-legend">{texts.groups[group]}</legend>
          {entries.map((entry) => {
            const checked = selected.includes(entry.code);
            const blocked =
              !checked && !original.includes(entry.code) && !canBundle(account, entry.code);
            return (
              <label key={entry.code}>
                <input
                  type="checkbox"
                  name={`${idPrefix}-permission`}
                  value={entry.code}
                  checked={checked}
                  disabled={blocked}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, entry.code]
                        : selected.filter((code) => code !== entry.code),
                    )
                  }
                />
                <span>
                  {permissionLabel(entry.code, t)}{' '}
                  {entry.scopeCapability === 'GLOBAL_ONLY' ? (
                    <Badge tone="warning">{texts.scope.GLOBAL_ONLY}</Badge>
                  ) : null}{' '}
                  <span className="wf-muted wf-small">
                    ({entry.code}
                    {blocked ? ` · ${texts.notHeld}` : ''})
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      ))}
    </>
  );
}

function CreateRoleForm({
  catalog,
  onCreated,
}: {
  catalog: RoleListResponse;
  onCreated: (role: RoleResponse) => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const texts = t.roleAdmin;
  const empty = {
    code: '',
    displayNameVi: '',
    displayNameEn: '',
    reason: '',
    isManagerGroup: false,
  };
  const [form, setForm] = useState(empty);
  const [permissions, setPermissions] = useState<PermissionCodeName[]>([]);
  const submit = useSubmit();
  const code = roleCodePreview(form.code);
  const ready =
    code.valid &&
    form.displayNameVi.trim() !== '' &&
    form.displayNameEn.trim() !== '' &&
    form.reason.trim() !== '';

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const result: { role?: RoleResponse } = {};
    const ok = await submit.run(async () => {
      const outcome = await runMutation(
        () => roleAdminCommands.create(api, createRequest({ ...form, permissions })),
        () => undefined,
      );
      if (outcome.ok) result.role = outcome.value;
      return outcome;
    }, '');
    if (ok && result.role) {
      setForm(empty);
      setPermissions([]);
      await onCreated(result.role);
    }
  }

  return (
    <details className="wf-disclosure">
      <summary>{texts.create}</summary>
      <form className="wf-form wf-member-form" onSubmit={(event) => void save(event)}>
        <div className="wf-row">
          <Field id="role-new-code" label={texts.code} required hint={texts.codeHint}>
            <input
              id="role-new-code"
              required
              maxLength={64}
              autoComplete="off"
              aria-invalid={(form.code !== '' && !code.valid) || undefined}
              aria-describedby="role-new-code-hint"
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          </Field>
          <Field id="role-new-vi" label={texts.nameVi} required>
            <input
              id="role-new-vi"
              required
              maxLength={100}
              value={form.displayNameVi}
              onChange={(event) => setForm({ ...form, displayNameVi: event.target.value })}
            />
          </Field>
          <Field id="role-new-en" label={texts.nameEn} required>
            <input
              id="role-new-en"
              required
              maxLength={100}
              value={form.displayNameEn}
              onChange={(event) => setForm({ ...form, displayNameEn: event.target.value })}
            />
          </Field>
        </div>
        <ManagerGroupField
          id="role-new-manager"
          checked={form.isManagerGroup}
          onChange={(checked) => setForm({ ...form, isManagerGroup: checked })}
        />
        <h3>{texts.permissions}</h3>
        <PermissionChecklist
          idPrefix="role-new"
          catalog={catalog}
          selected={permissions}
          onChange={setPermissions}
        />
        <Field id="role-new-reason" label={t.common.reason} required hint={texts.reasonHint}>
          <input
            id="role-new-reason"
            required
            maxLength={500}
            aria-describedby="role-new-reason-hint"
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
          />
        </Field>
        {submit.error ? (
          <Notice tone="error">{roleAdminErrorMessage(submit.error, t)}</Notice>
        ) : null}
        <SubmitButton
          pending={submit.pending}
          label={texts.create}
          pendingLabel={t.common.saving}
          disabled={!ready}
        />
      </form>
    </details>
  );
}

function RoleCard({
  role,
  catalog,
  editable,
  reload,
  onSaved,
}: {
  role: RoleResponse;
  catalog: RoleListResponse;
  editable: boolean;
  reload: () => Promise<void>;
  onSaved: (message: string) => void;
}) {
  const { t, locale } = useWorkforce();
  const texts = t.roleAdmin;
  return (
    <article className="wf-card">
      <h3>
        {roleDisplayName(role, locale)} <span className="wf-muted wf-small">({role.code})</span>{' '}
        <Badge tone={role.isActive ? 'success' : 'neutral'}>
          {role.isActive ? texts.active : texts.inactive}
        </Badge>
        {role.isManagerGroup ? <Badge tone="info">{texts.managerGroup}</Badge> : null}
      </h3>
      <p className="wf-muted wf-small">
        {texts.nameVi}: {role.displayNameVi} · {texts.nameEn}: {role.displayNameEn}
      </p>
      {role.permissions.length === 0 ? (
        <p className="wf-muted">{texts.noPermissions}</p>
      ) : (
        <ul className="wf-plain-list">
          {role.permissions.map((code) => {
            const entry = catalog.permissionCatalog.find((item) => item.code === code);
            return (
              <li key={code}>
                {permissionLabel(code, t)}{' '}
                {entry?.scopeCapability === 'GLOBAL_ONLY' ? (
                  <Badge tone="warning">{texts.scope.GLOBAL_ONLY}</Badge>
                ) : null}{' '}
                <span className="wf-muted wf-small">({code})</span>
              </li>
            );
          })}
        </ul>
      )}
      {editable ? (
        <EditRoleForm
          key={role.version}
          role={role}
          catalog={catalog}
          reload={reload}
          onSaved={onSaved}
        />
      ) : null}
    </article>
  );
}

function EditRoleForm({
  role,
  catalog,
  reload,
  onSaved,
}: {
  role: RoleResponse;
  catalog: RoleListResponse;
  reload: () => Promise<void>;
  onSaved: (message: string) => void;
}) {
  const { api, t } = useWorkforce();
  const texts = t.roleAdmin;
  const [names, setNames] = useState({
    displayNameVi: role.displayNameVi,
    displayNameEn: role.displayNameEn,
    isManagerGroup: role.isManagerGroup,
  });
  const [permissions, setPermissions] = useState<PermissionCodeName[]>(role.permissions);
  const [reason, setReason] = useState('');
  const [unchanged, setUnchanged] = useState(false);
  const submit = useSubmit();
  const id = `role-${role.id}`;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (reason.trim() === '') return;
    const rename = namesRequest(role, names, reason);
    const regrant = permissionsRequest(role, permissions, reason);
    setUnchanged(rename === null && regrant === null);
    if (rename === null && regrant === null) return;
    const ok = await submit.run(
      () =>
        runMutation(async () => {
          // Names first; the permission command then uses the role's new version.
          const renamed = rename ? await roleAdminCommands.update(api, role.id, rename) : role;
          if (regrant) {
            await roleAdminCommands.setPermissions(api, role.id, {
              ...regrant,
              expectedVersion: renamed.version,
            });
          }
        }, reload),
      '',
    );
    if (ok) {
      onSaved(texts.saved);
      await reload();
    }
  }

  async function toggle() {
    if (reason.trim() === '') return;
    const ok = await submit.run(
      () =>
        runMutation(
          () => roleAdminCommands.update(api, role.id, activationRequest(role, reason)),
          reload,
        ),
      '',
    );
    if (ok) {
      onSaved(texts.toggled);
      await reload();
    }
  }

  return (
    <details className="wf-disclosure">
      <summary>{texts.edit}</summary>
      <form className="wf-form wf-member-form" onSubmit={(event) => void save(event)}>
        <p className="wf-hint">
          {texts.code}: <strong>{role.code}</strong> — {texts.codeReadonly}
        </p>
        <div className="wf-row">
          <Field id={`${id}-vi`} label={texts.nameVi} required>
            <input
              id={`${id}-vi`}
              required
              maxLength={100}
              value={names.displayNameVi}
              onChange={(event) => setNames({ ...names, displayNameVi: event.target.value })}
            />
          </Field>
          <Field id={`${id}-en`} label={texts.nameEn} required>
            <input
              id={`${id}-en`}
              required
              maxLength={100}
              value={names.displayNameEn}
              onChange={(event) => setNames({ ...names, displayNameEn: event.target.value })}
            />
          </Field>
        </div>
        <ManagerGroupField
          id={`${id}-manager`}
          checked={names.isManagerGroup}
          onChange={(checked) => setNames({ ...names, isManagerGroup: checked })}
        />
        <h4>{texts.permissions}</h4>
        <PermissionChecklist
          idPrefix={id}
          catalog={catalog}
          selected={permissions}
          original={role.permissions}
          onChange={setPermissions}
        />
        <p className="wf-hint">{texts.changeNote}</p>
        <Field id={`${id}-reason`} label={t.common.reason} required hint={texts.reasonHint}>
          <input
            id={`${id}-reason`}
            required
            maxLength={500}
            aria-describedby={`${id}-reason-hint`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {unchanged ? <Notice tone="info">{texts.noChanges}</Notice> : null}
        {submit.error ? (
          <Notice tone="error">{roleAdminErrorMessage(submit.error, t)}</Notice>
        ) : null}
        <div className="wf-form-actions">
          <SubmitButton
            pending={submit.pending}
            label={texts.save}
            pendingLabel={t.common.saving}
            disabled={reason.trim() === ''}
          />
          <button
            type="button"
            className={`wf-button ${role.isActive ? 'wf-button-quiet wf-danger-text' : ''}`}
            disabled={submit.pending || reason.trim() === ''}
            onClick={() => void toggle()}
          >
            {role.isActive ? texts.deactivate : texts.activate}
          </button>
        </div>
        <p className="wf-hint">{texts.activationHint}</p>
      </form>
    </details>
  );
}

/** Directory grouping flag: holders are listed under "Quản lý"; it grants no permission. */
function ManagerGroupField({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { t } = useWorkforce();
  const texts = t.roleAdmin;
  return (
    <div className="wf-checklist">
      <label htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          {texts.managerGroup} <span className="wf-muted wf-small">{texts.managerGroupHint}</span>
        </span>
      </label>
    </div>
  );
}
