'use client';

import type { SkillListResponse, SkillResponse } from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  FacetedFilter,
  Field,
  FormDialog,
  FormGrid,
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
import { canGlobal } from '../../../lib/workforce/permissions';
import {
  filterSkills,
  normalizeSkillList,
  SKILL_LIST_DEFAULTS,
  SKILL_PAGE_KEYS,
  skillSortValue,
} from '../../../lib/workforce/skills-list';
import { runMutation } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  PageHeader,
  useResource,
  useSubmit,
  useSuccessToast,
} from '../ui';

/**
 * Skill catalog: GLOBAL MANAGE_SKILLS creates, renames and (de)activates skills. The API returns
 * every skill, so search, status filter, sorting and paging run in the browser (`DataTable`
 * client mode); their state lives in the address bar.
 */
export function SkillsScreen() {
  const { api, t } = useWorkforce();
  const { account } = useAccount();
  const manage = canGlobal(account, 'MANAGE_SKILLS');
  const skills = useResource(() => api.get<SkillListResponse>('/api/v1/skills'), [api]);
  const [list, updateList] = useUrlState(SKILL_LIST_DEFAULTS, {
    normalize: normalizeSkillList,
    resetOnChange: SKILL_PAGE_KEYS,
  });

  type Overlay =
    | { kind: 'create' }
    | { kind: 'edit'; skill: SkillResponse }
    | { kind: 'status'; skill: SkillResponse };
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const notify = useSuccessToast();

  /** After a successful save: refresh the list, close the overlay and say what happened. */
  const finish = (message: string) => async () => {
    await skills.reload();
    setOverlay(null);
    notify(message);
  };

  const all = skills.data?.skills ?? [];
  const rows = filterSkills(all, list);
  const active = (list.q ? 1 : 0) + (list.status ? 1 : 0);
  const columns: DataTableColumn<SkillResponse>[] = [
    {
      key: 'code',
      header: t.common.code,
      sortable: true,
      sortValue: (skill) => skillSortValue(skill, 'code'),
      cell: (skill) => skill.code,
    },
    {
      key: 'nameVi',
      header: t.skills.nameVi,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      sortable: true,
      sortValue: (skill) => skillSortValue(skill, 'nameVi'),
      cell: (skill) => skill.nameVi,
    },
    {
      key: 'nameEn',
      header: t.skills.nameEn,
      hideBelow: 'xl',
      truncate: true,
      width: 'lg',
      sortable: true,
      sortValue: (skill) => skillSortValue(skill, 'nameEn'),
      cell: (skill) => skill.nameEn,
    },
    {
      key: 'status',
      header: t.common.status,
      sortable: true,
      sortValue: (skill) => skillSortValue(skill, 'status'),
      cell: (skill) => (
        <Badge tone={skill.isActive ? 'success' : 'neutral'}>
          {skill.isActive ? t.common.active : t.common.inactive}
        </Badge>
      ),
    },
    ...(manage
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (skill: SkillResponse) => (
              <RowActions
                menuLabel={fill(t.common.list.actionsFor, { name: skill.nameVi })}
                items={[
                  {
                    id: 'edit',
                    label: t.common.edit,
                    icon: 'edit',
                    onSelect: () => setOverlay({ kind: 'edit', skill }),
                  },
                  {
                    id: 'status',
                    label: skill.isActive ? t.common.deactivate : t.common.activate,
                    tone: skill.isActive ? 'danger' : 'default',
                    onSelect: () => setOverlay({ kind: 'status', skill }),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader title={t.skills.title}>
        {manage ? (
          <Button variant="primary" icon="plus" onClick={() => setOverlay({ kind: 'create' })}>
            {t.skills.create}
          </Button>
        ) : null}
      </PageHeader>
      {skills.data && all.length > 0 ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={active}
          resultCount={resultsText(t, rows.length)}
          onReset={() => updateList({ q: '', status: '' })}
          reload={{ label: t.common.reload, onClick: () => void skills.reload() }}
          search={
            <SearchInput
              id="skill-q"
              value={list.q}
              label={t.skills.search}
              placeholder={t.skills.search}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => updateList({ q }, { replace: true })}
            />
          }
          filters={
            <FacetedFilter
              label={t.common.status}
              clearLabel={t.common.list.clearChoice}
              options={[
                { value: 'active', label: t.common.active },
                { value: 'inactive', label: t.common.inactive },
              ]}
              selected={list.status ? [list.status] : []}
              onChange={([status]) => updateList({ status: status ?? '' })}
            />
          }
        />
      ) : null}
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: t.skills.title })}
        columns={columns}
        rows={rows}
        rowKey={(skill) => skill.id}
        sort={{ key: list.sort, direction: list.dir === 'desc' ? 'desc' : 'asc' }}
        onSortChange={(sort) => updateList({ sort: sort.key, dir: sort.direction })}
        sortLabels={sortLabels(t)}
        loading={skills.loading}
        loadingLabel={t.common.loading}
        error={
          skills.error ? (
            <ErrorState error={skills.error} t={t} onRetry={() => void skills.reload()} />
          ) : undefined
        }
        empty={
          skills.data ? (
            <Empty>{all.length === 0 ? t.common.empty : t.skills.noMatch}</Empty>
          ) : undefined
        }
        paging={{
          page: list.page,
          pageSize: list.pageSize,
          onPageChange: (page) => updateList({ page }),
          onPageSizeChange: (pageSize) => updateList({ pageSize }),
          labels: paginationLabels(t, t.skills.title),
        }}
      />
      {overlay?.kind === 'create' ? (
        <SkillCreate onClose={() => setOverlay(null)} onCreated={finish(t.skills.created)} />
      ) : null}
      {overlay?.kind === 'edit' ? (
        <SkillEdit
          key={overlay.skill.id}
          skill={overlay.skill}
          onClose={() => setOverlay(null)}
          onSaved={finish(t.common.saved)}
        />
      ) : null}
      {overlay?.kind === 'status' ? (
        <SkillStatus
          key={overlay.skill.id}
          skill={overlay.skill}
          onClose={() => setOverlay(null)}
          onChanged={finish(t.common.saved)}
        />
      ) : null}
    </>
  );
}

/** Short form (3 fields): a dialog opened from the page header. Mounted only while open, so it resets on close. */
function SkillCreate({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const [form, setForm] = useState({ code: '', nameVi: '', nameEn: '' });
  const submit = useSubmit();

  async function save() {
    const ok = await submit.run(
      () => runMutation(() => api.post('/api/v1/skills', form), onCreated),
      '',
    );
    if (ok) await onCreated();
  }

  return (
    <FormDialog
      title={t.skills.create}
      labels={formOverlayLabels(t, t.common.create)}
      busy={submit.pending}
      dirty={form.code !== '' || form.nameVi !== '' || form.nameEn !== ''}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <Field label={t.common.code} required width="md">
          {(control) => (
            <TextInput
              {...control}
              maxLength={64}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.skills.nameVi} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={form.nameVi}
              onChange={(event) => setForm({ ...form, nameVi: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.skills.nameEn} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={form.nameEn}
              onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/** Rename one skill. Opened from the row menu. */
function SkillEdit({
  skill,
  onClose,
  onSaved,
}: {
  skill: SkillResponse;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const [form, setForm] = useState({ nameVi: skill.nameVi, nameEn: skill.nameEn });
  const submit = useSubmit();
  const changed = form.nameVi !== skill.nameVi || form.nameEn !== skill.nameEn;

  async function save() {
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/skills/${skill.id}`, {
              expectedVersion: skill.version,
              ...(form.nameVi !== skill.nameVi ? { nameVi: form.nameVi } : {}),
              ...(form.nameEn !== skill.nameEn ? { nameEn: form.nameEn } : {}),
            }),
          onSaved,
        ),
      '',
    );
    if (ok) await onSaved();
  }

  return (
    <FormDialog
      title={`${t.common.edit}: ${skill.code}`}
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={changed}
      submitDisabled={!changed}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <Field label={t.skills.nameVi} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={form.nameVi}
              onChange={(event) => setForm({ ...form, nameVi: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.skills.nameEn} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={form.nameEn}
              onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/** Activate or deactivate: a confirmation with a required reason, opened from the row menu. */
function SkillStatus({
  skill,
  onClose,
  onChanged,
}: {
  skill: SkillResponse;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const deactivating = skill.isActive;
  return (
    <ConfirmDialog
      title={deactivating ? t.skills.deactivateTitle : t.skills.activateTitle}
      description={deactivating ? t.skills.deactivateBody : t.skills.activateBody}
      facts={[{ label: t.common.code, value: `${skill.code} · ${skill.nameVi}` }]}
      tone={deactivating ? 'danger' : 'neutral'}
      confirmLabel={deactivating ? t.common.deactivate : t.common.activate}
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
            api.post(`/api/v1/skills/${skill.id}/status`, {
              expectedVersion: skill.version,
              isActive: !skill.isActive,
              reason: reason ?? '',
            }),
          onChanged,
        );
        if (!outcome.ok) throw outcome.error;
        await onChanged();
      }}
    />
  );
}
