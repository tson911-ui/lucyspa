'use client';

import type { SkillListResponse, SkillResponse } from '@lucy-spa/contracts';
import {
  DataTable,
  Dialog,
  FacetedFilter,
  ListToolbar,
  RowActions,
  SearchInput,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/workforce';
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
  Field,
  FormFeedback,
  PageHeader,
  Section,
  SubmitButton,
  useResource,
  useSubmit,
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

  const [editing, setEditing] = useState<SkillResponse | null>(null);

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
                    onSelect: () => setEditing(skill),
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
      <PageHeader title={t.skills.title} />
      {manage ? <SkillCreate reload={skills.reload} /> : null}
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
      {editing ? (
        <SkillEdit
          key={editing.id}
          skill={editing}
          reload={skills.reload}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function SkillCreate({ reload }: { reload: () => Promise<void> }) {
  const { api, t } = useWorkforce();
  const empty = { code: '', nameVi: '', nameEn: '' };
  const [form, setForm] = useState(empty);
  const submit = useSubmit();

  async function save(event: FormEvent) {
    event.preventDefault();
    const ok = await submit.run(
      () => runMutation(() => api.post('/api/v1/skills', form), reload),
      t.skills.created,
    );
    if (ok) {
      setForm(empty);
      await reload();
    }
  }

  return (
    <Section title={t.skills.create}>
      <details className="wf-disclosure">
        <summary>{t.skills.create}</summary>
        <form className="wf-form" onSubmit={(event) => void save(event)}>
          <Field id="skill-code" label={t.common.code} required>
            <input
              id="skill-code"
              required
              maxLength={64}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          </Field>
          <div className="wf-row">
            <Field id="skill-vi" label={t.skills.nameVi} required>
              <input
                id="skill-vi"
                required
                maxLength={200}
                value={form.nameVi}
                onChange={(event) => setForm({ ...form, nameVi: event.target.value })}
              />
            </Field>
            <Field id="skill-en" label={t.skills.nameEn} required>
              <input
                id="skill-en"
                required
                maxLength={200}
                value={form.nameEn}
                onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
              />
            </Field>
          </div>
          <FormFeedback error={submit.error} success={submit.success} t={t} />
          <SubmitButton
            pending={submit.pending}
            label={t.common.create}
            pendingLabel={t.common.saving}
          />
        </form>
      </details>
    </Section>
  );
}

/** Edit and (de)activate one skill. Opened from the row menu; 7.5d moves it onto `FormDialog`. */
function SkillEdit({
  skill,
  reload,
  onClose,
}: {
  skill: SkillResponse;
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  const { api, t } = useWorkforce();
  const [form, setForm] = useState({ nameVi: skill.nameVi, nameEn: skill.nameEn, reason: '' });
  const submit = useSubmit();
  const id = `skill-${skill.id}`;

  async function rename(event: FormEvent) {
    event.preventDefault();
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/skills/${skill.id}`, {
              expectedVersion: skill.version,
              ...(form.nameVi !== skill.nameVi ? { nameVi: form.nameVi } : {}),
              ...(form.nameEn !== skill.nameEn ? { nameEn: form.nameEn } : {}),
            }),
          reload,
        ),
      t.common.saved,
    );
    if (ok) {
      await reload();
      onClose();
    }
  }

  async function toggle() {
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/skills/${skill.id}/status`, {
              expectedVersion: skill.version,
              isActive: !skill.isActive,
              reason: form.reason,
            }),
          reload,
        ),
      t.common.saved,
    );
    if (ok) {
      await reload();
      onClose();
    }
  }

  return (
    <Dialog
      onClose={onClose}
      title={`${t.common.edit}: ${skill.code}`}
      closeLabel={t.common.close}
      busy={submit.pending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submit.pending}>
            {t.common.cancel}
          </Button>
          <Button
            type="submit"
            form={`${id}-form`}
            variant="primary"
            loading={submit.pending}
            disabled={form.nameVi === skill.nameVi && form.nameEn === skill.nameEn}
          >
            {submit.pending ? t.common.saving : t.common.save}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} className="wf-form" onSubmit={(event) => void rename(event)}>
        <Field id={`${id}-vi`} label={t.skills.nameVi} required>
          <input
            id={`${id}-vi`}
            required
            maxLength={200}
            value={form.nameVi}
            onChange={(event) => setForm({ ...form, nameVi: event.target.value })}
          />
        </Field>
        <Field id={`${id}-en`} label={t.skills.nameEn} required>
          <input
            id={`${id}-en`}
            required
            maxLength={200}
            value={form.nameEn}
            onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
          />
        </Field>
        <Field id={`${id}-reason`} label={t.common.reason}>
          <input
            id={`${id}-reason`}
            maxLength={500}
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
          />
        </Field>
        <FormFeedback error={submit.error} success={submit.success} t={t} />
        <div>
          <Button
            variant={skill.isActive ? 'danger-outline' : 'secondary'}
            disabled={submit.pending || form.reason.trim() === ''}
            onClick={() => void toggle()}
          >
            {skill.isActive ? t.common.deactivate : t.common.activate}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
