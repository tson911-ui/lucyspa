'use client';

import type { SkillListResponse, SkillResponse } from '@lucy-spa/contracts';
import {
  DataTable,
  FilterChips,
  ListToolbar,
  SearchInput,
  Select,
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

  const all = skills.data?.skills ?? [];
  const rows = filterSkills(all, list);
  const active = (list.q ? 1 : 0) + (list.status ? 1 : 0);
  const chips = [
    ...(list.q ? [{ key: 'q', label: `“${list.q}”` }] : []),
    ...(list.status
      ? [
          {
            key: 'status',
            label: `${t.common.status}: ${
              list.status === 'active' ? t.common.active : t.common.inactive
            }`,
          },
        ]
      : []),
  ];
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
      sortable: true,
      sortValue: (skill) => skillSortValue(skill, 'nameVi'),
      cell: (skill) => skill.nameVi,
    },
    {
      key: 'nameEn',
      header: t.skills.nameEn,
      hideBelow: 'md',
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
            cell: (skill: SkillResponse) => <SkillEdit skill={skill} reload={skills.reload} />,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader title={t.skills.title} />
      {manage ? <SkillCreate reload={skills.reload} /> : null}
      <Section title={t.skills.title}>
        {skills.data && all.length > 0 ? (
          <ListToolbar
            labels={toolbarLabels(t)}
            activeFilters={active}
            resultCount={resultsText(t, rows.length)}
            onReset={() => updateList({ q: '', status: '' })}
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
              <Field id="skill-status" label={t.common.status}>
                <Select
                  id="skill-status"
                  value={list.status}
                  placeholder={t.common.all}
                  options={[
                    { value: 'active', label: t.common.active },
                    { value: 'inactive', label: t.common.inactive },
                  ]}
                  onChange={(event) => updateList({ status: event.target.value })}
                />
              </Field>
            }
            chips={
              <FilterChips
                chips={chips}
                removeLabel={t.common.list.removeFilter}
                onRemove={(key) => updateList(key === 'q' ? { q: '' } : { status: '' })}
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
      </Section>
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

function SkillEdit({ skill, reload }: { skill: SkillResponse; reload: () => Promise<void> }) {
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
    if (ok) await reload();
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
    if (ok) await reload();
  }

  return (
    <details className="wf-disclosure">
      <summary>{t.common.edit}</summary>
      <form className="wf-inline-form" onSubmit={(event) => void rename(event)}>
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
        <SubmitButton
          pending={submit.pending}
          label={t.common.save}
          pendingLabel={t.common.saving}
          disabled={form.nameVi === skill.nameVi && form.nameEn === skill.nameEn}
        />
        <Field id={`${id}-reason`} label={t.common.reason}>
          <input
            id={`${id}-reason`}
            maxLength={500}
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
          />
        </Field>
        <button
          type="button"
          className="wf-button wf-button-quiet"
          disabled={submit.pending || form.reason.trim() === ''}
          onClick={() => void toggle()}
        >
          {skill.isActive ? t.common.deactivate : t.common.activate}
        </button>
        <FormFeedback error={submit.error} success={submit.success} t={t} />
      </form>
    </details>
  );
}
