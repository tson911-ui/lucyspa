'use client';

import type { PermissionCodeName, RoleListResponse, RoleResponse } from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  Drawer,
  FacetedFilter,
  Field,
  FormDrawer,
  FormGrid,
  FormSection,
  ListToolbar,
  RowActions,
  SearchInput,
  TextInput,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  paginationLabels,
  resultsText,
  sortLabels,
  toolbarLabels,
} from '../../../lib/workforce/list-view';
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
import {
  filterRoles,
  normalizeRoleList,
  ROLE_LIST_DEFAULTS,
  ROLE_PAGE_KEYS,
  roleSortValue,
} from '../../../lib/workforce/roles-list';
import { runMutation } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  CheckField,
  Empty,
  ErrorState,
  Notice,
  PageHeader,
  useResource,
  useSubmit,
  useSuccessToast,
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

type Overlay =
  | { kind: 'create' }
  | { kind: 'edit'; role: RoleResponse }
  | { kind: 'view'; role: RoleResponse }
  | { kind: 'status'; role: RoleResponse };

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
  const { t, locale } = useWorkforce();
  const { account } = useAccount();
  const texts = t.roleAdmin;
  const editable = canEditRoles(account);
  const notify = useSuccessToast();
  const [list, updateList] = useUrlState(ROLE_LIST_DEFAULTS, {
    normalize: normalizeRoleList,
    resetOnChange: ROLE_PAGE_KEYS,
  });
  const [overlay, setOverlay] = useState<Overlay | null>(null);

  /** After a successful save: refresh the list, close the overlay and say what happened. */
  const finish = (message: string) => async () => {
    await reload();
    setOverlay(null);
    notify(message);
  };

  const all = catalog?.roles ?? [];
  const rows = filterRoles(all, list);
  const active = (list.q ? 1 : 0) + (list.status ? 1 : 0);
  const columns: DataTableColumn<RoleResponse>[] = [
    {
      key: 'name',
      header: t.common.name,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      sortable: true,
      sortValue: (role) => roleSortValue(role, 'name', locale),
      cell: (role) => (
        <>
          {roleDisplayName(role, locale)}{' '}
          {role.isManagerGroup ? <Badge tone="info">{texts.managerGroup}</Badge> : null}
        </>
      ),
    },
    {
      key: 'code',
      header: t.common.code,
      hideBelow: 'md',
      sortable: true,
      sortValue: (role) => roleSortValue(role, 'code', locale),
      cell: (role) => role.code,
    },
    {
      key: 'permissions',
      header: texts.permissionsColumn,
      numeric: true,
      sortable: true,
      sortValue: (role) => roleSortValue(role, 'permissions', locale),
      cell: (role) => role.permissions.length,
    },
    {
      key: 'status',
      header: t.common.status,
      sortable: true,
      sortValue: (role) => roleSortValue(role, 'status', locale),
      cell: (role) => (
        <Badge tone={role.isActive ? 'success' : 'neutral'}>
          {role.isActive ? texts.active : texts.inactive}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (role) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: roleDisplayName(role, locale) })}
          items={[
            editable
              ? {
                  id: 'edit',
                  label: t.common.edit,
                  icon: 'edit',
                  onSelect: () => setOverlay({ kind: 'edit', role }),
                }
              : {
                  id: 'view',
                  label: texts.view,
                  icon: 'eye',
                  onSelect: () => setOverlay({ kind: 'view', role }),
                },
            ...(editable
              ? [
                  {
                    id: 'status',
                    label: role.isActive ? texts.deactivate : texts.activate,
                    tone: role.isActive ? ('danger' as const) : ('default' as const),
                    onSelect: () => setOverlay({ kind: 'status', role }),
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader title={texts.title} intro={texts.intro}>
        {editable && catalog ? (
          <Button variant="primary" icon="plus" onClick={() => setOverlay({ kind: 'create' })}>
            {texts.create}
          </Button>
        ) : null}
      </PageHeader>
      {!editable ? <Notice tone="info">{texts.readOnlyNote}</Notice> : null}
      {catalog && all.length > 0 ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={active}
          resultCount={resultsText(t, rows.length)}
          onReset={() => updateList({ q: '', status: '' })}
          reload={{ label: t.common.reload, onClick: () => void reload() }}
          search={
            <SearchInput
              id="role-q"
              value={list.q}
              label={texts.search}
              placeholder={texts.search}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => updateList({ q }, { replace: true })}
            />
          }
          filters={
            <FacetedFilter
              label={t.common.status}
              clearLabel={t.common.list.clearChoice}
              options={[
                { value: 'active', label: texts.active },
                { value: 'inactive', label: texts.inactive },
              ]}
              selected={list.status ? [list.status] : []}
              onChange={([status]) => updateList({ status: status ?? '' })}
            />
          }
        />
      ) : null}
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: t.nav.roles })}
        columns={columns}
        rows={rows}
        rowKey={(role) => role.id}
        sort={{ key: list.sort, direction: list.dir === 'desc' ? 'desc' : 'asc' }}
        onSortChange={(sort) => updateList({ sort: sort.key, dir: sort.direction })}
        sortLabels={sortLabels(t)}
        loading={loading}
        loadingLabel={t.common.loading}
        error={error ? <ErrorState error={error} t={t} onRetry={() => void reload()} /> : undefined}
        empty={
          catalog ? <Empty>{all.length === 0 ? texts.empty : texts.noMatch}</Empty> : undefined
        }
        paging={{
          page: list.page,
          pageSize: list.pageSize,
          onPageChange: (page) => updateList({ page }),
          onPageSizeChange: (pageSize) => updateList({ pageSize }),
          labels: paginationLabels(t, t.nav.roles),
        }}
      />
      {catalog && overlay?.kind === 'create' ? (
        <RoleForm
          catalog={catalog}
          onClose={() => setOverlay(null)}
          onDone={(role) =>
            finish(role ? fill(texts.created, { name: role.displayNameVi }) : texts.saved)()
          }
        />
      ) : null}
      {catalog && overlay?.kind === 'edit' ? (
        <RoleForm
          key={`${overlay.role.id}-${overlay.role.version}`}
          catalog={catalog}
          role={overlay.role}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={() => finish(texts.saved)()}
        />
      ) : null}
      {catalog && overlay?.kind === 'view' ? (
        <RoleView role={overlay.role} catalog={catalog} onClose={() => setOverlay(null)} />
      ) : null}
      {overlay?.kind === 'status' ? (
        <RoleStatus
          key={overlay.role.id}
          role={overlay.role}
          reload={reload}
          onClose={() => setOverlay(null)}
          onChanged={finish(texts.toggled)}
        />
      ) : null}
    </>
  );
}

/**
 * Grouped permission matrix over the loaded catalog (one `FormSection` per group, one `CheckField`
 * per permission); codes the actor cannot add are disabled.
 */
export function PermissionMatrix({
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
      <p className="ls-hint">{texts.scopeLegend}</p>
      {groupedCatalog(catalog).map(({ group, entries }) => (
        <FormSection key={group} title={texts.groups[group]}>
          {entries.map((entry) => {
            const checked = selected.includes(entry.code);
            const blocked =
              !checked && !original.includes(entry.code) && !canBundle(account, entry.code);
            return (
              <CheckField
                key={entry.code}
                name={`${idPrefix}-permission`}
                value={entry.code}
                checked={checked}
                disabled={disabled === true || blocked}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, entry.code]
                      : selected.filter((code) => code !== entry.code),
                  )
                }
                label={
                  <span>
                    {permissionLabel(entry.code, t)}{' '}
                    {entry.scopeCapability === 'GLOBAL_ONLY' ? (
                      <Badge tone="warning">{texts.scope.GLOBAL_ONLY}</Badge>
                    ) : null}
                  </span>
                }
                hint={blocked ? `${entry.code} · ${texts.notHeld}` : entry.code}
              />
            );
          })}
        </FormSection>
      ))}
      <p className="ls-hint">{texts.scopeHelp}</p>
    </>
  );
}

/** Create (no `role`) or edit one role in a drawer: names, manager-group flag, permissions, reason. */
export function RoleForm({
  catalog,
  role,
  reload = () => Promise.resolve(),
  onClose,
  onDone,
}: {
  catalog: RoleListResponse;
  role?: RoleResponse;
  reload?: () => Promise<void>;
  onClose: () => void;
  /** Called after a successful save, with the new role when this was a create. */
  onDone: (created?: RoleResponse) => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const texts = t.roleAdmin;
  const [form, setForm] = useState({
    code: '',
    displayNameVi: role?.displayNameVi ?? '',
    displayNameEn: role?.displayNameEn ?? '',
    isManagerGroup: role?.isManagerGroup ?? false,
    reason: '',
  });
  const [permissions, setPermissions] = useState<PermissionCodeName[]>(role?.permissions ?? []);
  const submit = useSubmit();
  const id = role ? `role-${role.id}` : 'role-new';
  const code = roleCodePreview(form.code);
  const rename = role ? namesRequest(role, form, form.reason) : null;
  const regrant = role ? permissionsRequest(role, permissions, form.reason) : null;
  const changed = role
    ? rename !== null || regrant !== null
    : form.code !== '' ||
      form.displayNameVi !== '' ||
      form.displayNameEn !== '' ||
      form.isManagerGroup ||
      permissions.length > 0;
  const ready = role
    ? changed && form.reason.trim() !== ''
    : code.valid &&
      form.displayNameVi.trim() !== '' &&
      form.displayNameEn.trim() !== '' &&
      form.reason.trim() !== '';

  async function save() {
    if (!ready) return;
    const result: { role?: RoleResponse } = {};
    const ok = await submit.run(
      () =>
        runMutation(async () => {
          if (!role) {
            result.role = await roleAdminCommands.create(
              api,
              createRequest({ ...form, permissions }),
            );
            return;
          }
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
    if (!ok) return;
    await onDone(result.role);
  }

  return (
    <FormDrawer
      title={role ? `${texts.edit}: ${roleDisplayName(role, locale)}` : texts.create}
      labels={formOverlayLabels(t, role ? t.common.save : t.common.create)}
      busy={submit.pending}
      dirty={changed}
      submitDisabled={!ready}
      error={
        submit.error ? (
          <Notice tone="error">{roleAdminErrorMessage(submit.error, t)}</Notice>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        {role ? (
          <p className="ls-hint">
            {texts.code}: <strong>{role.code}</strong> — {texts.codeReadonly}
          </p>
        ) : (
          <Field
            label={texts.code}
            required
            hint={texts.codeHint}
            width="md"
            {...(form.code !== '' && !code.valid ? { error: texts.invalidCode } : {})}
          >
            {(control) => (
              <TextInput
                {...control}
                maxLength={64}
                autoComplete="off"
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value })}
              />
            )}
          </Field>
        )}
        <Field label={texts.nameVi} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={100}
              value={form.displayNameVi}
              onChange={(event) => setForm({ ...form, displayNameVi: event.target.value })}
            />
          )}
        </Field>
        <Field label={texts.nameEn} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={100}
              value={form.displayNameEn}
              onChange={(event) => setForm({ ...form, displayNameEn: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
      <CheckField
        checked={form.isManagerGroup}
        onChange={(event) => setForm({ ...form, isManagerGroup: event.target.checked })}
        label={texts.managerGroup}
        hint={texts.managerGroupHint}
      />
      <FormSection
        title={texts.permissions}
        description={fill(texts.permissionsSelected, { count: permissions.length })}
      >
        <PermissionMatrix
          idPrefix={id}
          catalog={catalog}
          selected={permissions}
          original={role?.permissions ?? []}
          onChange={setPermissions}
        />
      </FormSection>
      {role ? <p className="ls-hint">{texts.changeNote}</p> : null}
      <Field label={t.common.reason} required hint={texts.reasonHint}>
        {(control) => (
          <TextInput
            {...control}
            maxLength={500}
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
          />
        )}
      </Field>
    </FormDrawer>
  );
}

/** Read-only view of one role's permissions, for people who may see but not change roles. */
function RoleView({
  role,
  catalog,
  onClose,
}: {
  role: RoleResponse;
  catalog: RoleListResponse;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const texts = t.roleAdmin;
  return (
    <Drawer
      open
      title={`${texts.viewTitle}: ${roleDisplayName(role, locale)}`}
      closeLabel={t.common.close}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t.common.close}
        </Button>
      }
    >
      <PermissionMatrix
        idPrefix={`role-${role.id}`}
        catalog={catalog}
        selected={role.permissions}
        original={role.permissions}
        onChange={() => undefined}
        disabled
      />
    </Drawer>
  );
}

/** Switch a role off or on: a confirmation with a required reason, opened from the row menu. */
function RoleStatus({
  role,
  reload,
  onClose,
  onChanged,
}: {
  role: RoleResponse;
  reload: () => Promise<void>;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const texts = t.roleAdmin;
  const deactivating = role.isActive;
  return (
    <ConfirmDialog
      title={deactivating ? texts.deactivateTitle : texts.activateTitle}
      description={texts.activationHint}
      facts={[{ label: t.common.code, value: `${role.code} · ${roleDisplayName(role, locale)}` }]}
      tone={deactivating ? 'danger' : 'neutral'}
      confirmLabel={deactivating ? texts.deactivate : texts.activate}
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
          () => roleAdminCommands.update(api, role.id, activationRequest(role, reason ?? '')),
          reload,
        );
        if (!outcome.ok) throw outcome.error;
        await onChanged();
      }}
    />
  );
}
