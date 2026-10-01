'use client';

import type {
  EmployeeStatus,
  EmploymentClassification,
  OrganizationPage,
  TeamEmployee,
  TeamEmployeeFilters,
  TeamListResponse,
  TeamMembershipFilter,
  TeamSummary,
} from '@lucy-spa/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { organizationDictionary } from '../../../i18n/organization';
import { canAnywhere, canAt } from '../../../lib/workforce/permissions';
import {
  bulkSelection,
  changeTeamMembers,
  EMPTY_SELECTION,
  selected,
  selectPage,
  selectionCount,
  teamEmployees,
  toggleMember,
  type MemberSelection,
} from '../../../lib/workforce/teams';
import { runMutation } from '../../../lib/workforce/workflows';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import {
  CheckField,
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
  VisuallyHidden,
} from '../ui';

export function OrganizationPager({
  page,
  onChange,
  disabled = false,
}: {
  page: OrganizationPage;
  onChange: (page: number) => void;
  disabled?: boolean;
}) {
  const { locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const pages = Math.max(1, Math.ceil(page.total / page.size));
  return (
    <div className="wf-form-actions" aria-label={text.page}>
      <button
        type="button"
        className="wf-button"
        disabled={disabled || page.number <= 1}
        onClick={() => onChange(page.number - 1)}
      >
        {text.previous}
      </button>
      <span>
        {text.page} {page.number} / {pages} · {text.total} {page.total}
      </span>
      <button
        type="button"
        className="wf-button"
        disabled={disabled || page.number >= pages}
        onClick={() => onChange(page.number + 1)}
      >
        {text.next}
      </button>
    </div>
  );
}

export function TeamsScreen() {
  const { api, t, locale, base } = useWorkforce();
  const { account } = useAccount();
  const text = organizationDictionary(locale);
  const allowed = canAnywhere(account, 'VIEW_TEAMS') || canAnywhere(account, 'MANAGE_TEAMS');
  const branches = useBranches(api);
  const [branchId, setBranchId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useResource(
    () =>
      allowed
        ? api.get<TeamListResponse>('/api/v1/teams', { branchId, q, page, limit: 50 })
        : Promise.resolve(null),
    [api, allowed, branchId, q, page],
  );
  if (!allowed) return <Notice tone="warning">{text.noAccess}</Notice>;
  return (
    <>
      <PageHeader title={text.teams} />
      <p className="wf-muted">{text.noLimit}</p>
      <div className="wf-filters">
        <Field id="teams-branch" label={t.common.branch}>
          <select
            id="teams-branch"
            value={branchId}
            onChange={(event) => {
              setBranchId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t.common.all}</option>
            {[...(branches.data?.values() ?? [])].map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="teams-search" label={t.common.search}>
          <input
            id="teams-search"
            value={q}
            maxLength={100}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </Field>
      </div>
      {canAnywhere(account, 'MANAGE_TEAMS') ? <CreateTeam onSaved={list.reload} /> : null}
      {list.loading ? <Loading t={t} /> : null}
      {list.error ? (
        <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
      ) : null}
      {list.data ? (
        <Section title={text.teams}>
          {!list.data.items.length ? (
            <Empty>{text.noRows}</Empty>
          ) : (
            <table className="wf-table">
              <thead>
                <tr>
                  <th>{t.common.name}</th>
                  <th>{t.common.branch}</th>
                  <th>{text.leader}</th>
                  <th>{text.members}</th>
                  <th>{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((team) => (
                  <tr key={team.id}>
                    <td data-label={t.common.name}>
                      {team.name} <small>{team.code}</small>
                    </td>
                    <td data-label={t.common.branch}>
                      {branches.data?.get(team.branchId)?.name ?? t.common.unknownBranch}
                    </td>
                    <td data-label={text.leader}>{team.leader?.fullName ?? text.noLeader}</td>
                    <td data-label={text.members}>{team.memberCount}</td>
                    <td data-label={t.common.actions}>
                      <Link href={`${base}/teams/${team.id}`}>{t.common.details}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <OrganizationPager page={list.data.page} onChange={setPage} disabled={list.loading} />
        </Section>
      ) : null}
    </>
  );
}

function CreateTeam({ onSaved }: { onSaved: () => Promise<void> }) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const text = organizationDictionary(locale);
  const branches = useBranches(api);
  const [form, setForm] = useState({ branchId: '', code: '', name: '', reason: '' });
  const submit = useSubmit();
  async function save(event: FormEvent) {
    event.preventDefault();
    const ok = await submit.run(
      () => runMutation(() => api.post('/api/v1/teams', form), onSaved),
      text.saved,
    );
    if (ok) {
      setForm({ ...form, code: '', name: '', reason: '' });
      await onSaved();
    }
  }
  return (
    <Section title={text.createTeam}>
      <details>
        <summary>{text.createTeam}</summary>
        <form className="wf-form" onSubmit={(event) => void save(event)}>
          <Field id="new-team-branch" label={t.common.branch} required>
            <select
              id="new-team-branch"
              required
              value={form.branchId}
              onChange={(event) => setForm({ ...form, branchId: event.target.value })}
            >
              <option value="">{text.choose}</option>
              {[...(branches.data?.values() ?? [])]
                .filter((branch) => branch.isActive && canAt(account, 'MANAGE_TEAMS', branch.id))
                .map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field id="new-team-code" label={t.common.code} required>
            <input
              id="new-team-code"
              required
              maxLength={64}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          </Field>
          <Field id="new-team-name" label={t.common.name} required>
            <input
              id="new-team-name"
              required
              maxLength={200}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field id="new-team-reason" label={t.common.reason} required>
            <input
              id="new-team-reason"
              required
              maxLength={500}
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
            />
          </Field>
          <FormFeedback error={submit.error} success={submit.success} t={t} />
          <SubmitButton
            pending={submit.pending}
            label={t.common.create}
            pendingLabel={t.common.saving}
            disabled={!form.reason.trim()}
          />
        </form>
      </details>
    </Section>
  );
}

export function TeamDetailScreen({ id }: { id: string }) {
  const { api, t, locale, base } = useWorkforce();
  const text = organizationDictionary(locale);
  const team = useResource(() => api.get<TeamSummary>(`/api/v1/teams/${id}`), [api, id]);
  return (
    <>
      <Link href={`${base}/teams`}>← {text.teams}</Link>
      {team.loading ? <Loading t={t} /> : null}
      {team.error ? (
        <ErrorState error={team.error} t={t} onRetry={() => void team.reload()} />
      ) : null}
      {team.data ? (
        <>
          <PageHeader title={team.data.name} />
          <p>
            {text.leader}: {team.data.leader?.fullName ?? text.noLeader} · {text.members}:{' '}
            {team.data.memberCount}
          </p>
          {!team.data.isActive ? <Notice tone="info">{text.inactive}</Notice> : null}
          {team.data.canManage && team.data.isActive ? (
            <TeamSettings team={team.data} reload={team.reload} />
          ) : null}
          {team.data.canAssignLeader && team.data.isActive ? (
            <LeaderEditor team={team.data} reload={team.reload} />
          ) : null}
          {team.data.isActive ? <TeamMembers team={team.data} reload={team.reload} /> : null}
        </>
      ) : null}
    </>
  );
}

function TeamSettings({ team, reload }: { team: TeamSummary; reload: () => Promise<void> }) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [name, setName] = useState(team.name);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const submit = useSubmit();
  async function save(remove: boolean) {
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/teams/${team.id}${remove ? '/delete' : ''}`, {
              expectedVersion: team.version,
              reason,
              ...(remove ? { confirmed: true } : { name }),
            }),
          reload,
        ),
      text.saved,
    );
    if (ok) {
      setReason('');
      setConfirmed(false);
      await reload();
    }
  }
  return (
    <Section title={text.editTeam}>
      <details>
        <summary>{text.editTeam}</summary>
        <form
          className="wf-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
        >
          <Field id="team-name" label={t.common.name} required>
            <input
              id="team-name"
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field id="team-reason" label={t.common.reason} required>
            <input
              id="team-reason"
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <FormFeedback error={submit.error} success={submit.success} t={t} />
          <SubmitButton
            pending={submit.pending}
            label={t.common.save}
            pendingLabel={t.common.saving}
            disabled={!reason.trim() || !name.trim()}
          />
          <Notice tone="warning">{text.deleteWarning}</Notice>
          <CheckField
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            label={text.confirmDelete}
          />
          <button
            className="wf-button wf-button-danger"
            type="button"
            disabled={submit.pending || !confirmed || !reason.trim()}
            onClick={() => void save(true)}
          >
            {text.deleteTeam}
          </button>
        </form>
      </details>
    </Section>
  );
}

function LeaderEditor({ team, reload }: { team: TeamSummary; reload: () => Promise<void> }) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [leader, setLeader] = useState<TeamEmployee | null>(null);
  const [reason, setReason] = useState('');
  const candidates = useResource(
    () =>
      teamEmployees(
        api,
        team.id,
        { q, membership: 'ALL', classification: 'OFFICIAL_EMPLOYEE', status: 'ACTIVE' },
        page,
      ),
    [api, team.id, q, page],
  );
  const submit = useSubmit();
  async function save(userId: string | null) {
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/teams/${team.id}/leader`, {
              userId,
              expectedVersion: team.version,
              reason,
            }),
          reload,
        ),
      text.saved,
    );
    if (ok) {
      setLeader(null);
      setReason('');
      await Promise.all([reload(), candidates.reload()]);
    }
  }
  return (
    <Section title={text.leader}>
      <details>
        <summary>{text.leader}</summary>
        <Field id="leader-search" label={text.leaderSearch}>
          <input
            id="leader-search"
            value={q}
            maxLength={100}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </Field>
        {candidates.loading ? <Loading t={t} /> : null}
        {candidates.error ? (
          <ErrorState error={candidates.error} t={t} onRetry={() => void candidates.reload()} />
        ) : null}
        {candidates.data ? (
          <>
            {!candidates.data.items.length ? (
              <Empty>{text.noRows}</Empty>
            ) : (
              <ul>
                {candidates.data.items.map((employee) => (
                  <li key={employee.userId}>
                    <label>
                      <input
                        type="radio"
                        name="team-leader"
                        checked={leader?.userId === employee.userId}
                        onChange={() => setLeader(employee)}
                      />{' '}
                      {employee.fullName} ({employee.employeeCode})
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <OrganizationPager page={candidates.data.page} onChange={setPage} />
          </>
        ) : null}
        {leader ? (
          <p>
            {text.selection}: {leader.fullName}
          </p>
        ) : null}
        <Field id="leader-reason" label={t.common.reason} required>
          <input
            id="leader-reason"
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <FormFeedback error={submit.error} success={submit.success} t={t} />
        <div className="wf-form-actions">
          <button
            type="button"
            className="wf-button wf-button-primary"
            disabled={submit.pending || !leader || !reason.trim()}
            onClick={() => void save(leader!.userId)}
          >
            {text.saveLeader}
          </button>
          <button
            type="button"
            className="wf-button wf-button-danger"
            disabled={submit.pending || !team.leader || !reason.trim()}
            onClick={() => void save(null)}
          >
            {text.removeLeader}
          </button>
        </div>
      </details>
    </Section>
  );
}

function TransferTarget({
  team,
  value,
  onChange,
  disabled,
}: {
  team: TeamSummary;
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useResource(
    () =>
      api.get<TeamListResponse>('/api/v1/teams', { branchId: team.branchId, q, page, limit: 50 }),
    [api, team.branchId, q, page],
  );
  return (
    <fieldset disabled={disabled}>
      <legend>{text.target}</legend>
      <Field id="target-team-search" label={t.common.search}>
        <input
          id="target-team-search"
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
        />
      </Field>
      {list.loading ? <Loading t={t} /> : null}
      {list.error ? (
        <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
      ) : null}
      {list.data ? (
        <>
          <ul>
            {list.data.items
              .filter((entry) => entry.id !== team.id && entry.isActive && entry.canManage)
              .map((entry) => (
                <li key={entry.id}>
                  <label>
                    <input
                      type="radio"
                      name="transfer-team"
                      checked={value === entry.id}
                      onChange={() => onChange(entry.id)}
                    />{' '}
                    {entry.name}
                  </label>
                </li>
              ))}
          </ul>
          <OrganizationPager page={list.data.page} onChange={setPage} />
        </>
      ) : null}
    </fieldset>
  );
}

export function TeamMemberTable({
  employees,
  selection,
  onToggle,
  disabled,
  selectable,
}: {
  employees: readonly TeamEmployee[];
  selection: MemberSelection;
  onToggle: (id: string) => void;
  disabled: boolean;
  selectable: boolean;
}) {
  const { t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  return (
    <table className="wf-table">
      <thead>
        <tr>
          {selectable ? <th>{text.selection}</th> : null}
          <th>{text.employee}</th>
          <th>{t.common.status}</th>
          <th>{text.classification}</th>
          <th>{text.currentTeam}</th>
        </tr>
      </thead>
      <tbody>
        {employees.map((employee) => (
          <tr key={employee.userId}>
            {selectable ? (
              <td data-label={text.selection}>
                <CheckField
                  label={
                    <VisuallyHidden>{`${text.selection}: ${employee.fullName}`}</VisuallyHidden>
                  }
                  disabled={
                    disabled ||
                    (selection.kind === 'explicit' &&
                      selection.ids.length >= 100 &&
                      !selected(selection, employee.userId)) ||
                    (selection.kind === 'matching' &&
                      selection.excluded.length >= 100 &&
                      selected(selection, employee.userId))
                  }
                  checked={selected(selection, employee.userId)}
                  onChange={() => onToggle(employee.userId)}
                />
              </td>
            ) : null}
            <td data-label={text.employee}>
              {employee.fullName} <small>({employee.employeeCode})</small>
            </td>
            <td data-label={t.common.status}>{t.employees.statuses[employee.status]}</td>
            <td data-label={text.classification}>
              {employee.classification ? t.employees.classifications[employee.classification] : '—'}
            </td>
            <td data-label={text.currentTeam}>{employee.teamName ?? text.unassigned}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TeamMembers({ team, reload }: { team: TeamSummary; reload: () => Promise<void> }) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [filters, setFilters] = useState<TeamEmployeeFilters>({ membership: 'MEMBERS' });
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<MemberSelection>(EMPTY_SELECTION);
  const [action, setAction] = useState<'ADD' | 'REMOVE' | 'TRANSFER'>('REMOVE');
  const [targetTeamId, setTargetTeamId] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, changed: 0 });
  const submit = useSubmit();
  const candidates = useResource(
    () => teamEmployees(api, team.id, filters, page),
    [api, team.id, filters, page],
  );
  const count = selectionCount(selection, candidates.data?.page.total ?? 0);
  function filter(next: TeamEmployeeFilters) {
    setFilters(next);
    setPage(1);
    setSelection(EMPTY_SELECTION);
    setConfirmed(false);
  }
  function chooseAction(next: 'ADD' | 'REMOVE' | 'TRANSFER') {
    setAction(next);
    setTargetTeamId('');
    filter({ ...filters, membership: next === 'ADD' ? 'UNASSIGNED' : 'MEMBERS' });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!confirmed || !count) return;
    setProgress({ processed: 0, changed: 0 });
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            changeTeamMembers(
              api,
              team.id,
              {
                action,
                ...(action === 'TRANSFER' ? { targetTeamId } : {}),
                expectedVersion: team.version,
                reason,
                selection: bulkSelection(selection, filters),
              },
              setProgress,
            ),
          async () => {
            await Promise.all([reload(), candidates.reload()]);
          },
        ),
      text.saved,
    );
    setConfirmed(false);
    setSelection(EMPTY_SELECTION);
    if (ok) setReason('');
    await Promise.all([reload(), candidates.reload()]);
  }
  return (
    <Section title={text.members}>
      {team.canManage ? (
        <div className="wf-form-actions">
          {(['ADD', 'REMOVE', 'TRANSFER'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              className="wf-button"
              aria-pressed={action === entry}
              disabled={submit.pending}
              onClick={() => chooseAction(entry)}
            >
              {entry === 'ADD' ? text.add : entry === 'REMOVE' ? text.remove : text.transfer}
            </button>
          ))}
        </div>
      ) : null}
      <fieldset disabled={submit.pending}>
        <legend>{t.common.search}</legend>
        <div className="wf-filters">
          <Field id="member-search" label={text.search}>
            <input
              id="member-search"
              value={filters.q ?? ''}
              maxLength={100}
              onChange={(event) => filter({ ...filters, q: event.target.value })}
            />
          </Field>
          <Field id="member-status" label={t.common.status}>
            <select
              id="member-status"
              value={filters.status ?? ''}
              onChange={(event) => {
                const rest = { ...filters };
                delete rest.status;
                filter(
                  event.target.value
                    ? { ...rest, status: event.target.value as EmployeeStatus }
                    : rest,
                );
              }}
            >
              <option value="">{t.common.all}</option>
              {(['ACTIVE', 'INACTIVE', 'PENDING_SETUP'] as const).map((status) => (
                <option key={status} value={status}>
                  {t.employees.statuses[status]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="member-classification" label={text.classification}>
            <select
              id="member-classification"
              value={filters.classification ?? ''}
              onChange={(event) => {
                const rest = { ...filters };
                delete rest.classification;
                filter(
                  event.target.value
                    ? {
                        ...rest,
                        classification: event.target.value as Exclude<
                          EmploymentClassification,
                          'ENDED'
                        >,
                      }
                    : rest,
                );
              }}
            >
              <option value="">{t.common.all}</option>
              {(['OFFICIAL_EMPLOYEE', 'COLLABORATOR', 'TRAINEE'] as const).map((classification) => (
                <option key={classification} value={classification}>
                  {t.employees.classifications[classification]}
                </option>
              ))}
            </select>
          </Field>
          {!team.canManage ? (
            <Field id="member-membership" label={text.currentTeam}>
              <select
                id="member-membership"
                value={filters.membership ?? 'MEMBERS'}
                onChange={(event) =>
                  filter({ ...filters, membership: event.target.value as TeamMembershipFilter })
                }
              >
                <option value="MEMBERS">{text.currentMembers}</option>
                <option value="ALL">{text.allEmployees}</option>
                <option value="UNASSIGNED">{text.unassigned}</option>
                <option value="OTHER_TEAM">{text.otherTeam}</option>
              </select>
            </Field>
          ) : null}
        </div>
      </fieldset>
      <p className="wf-muted">{text.selectionCleared}</p>
      {candidates.loading ? <Loading t={t} /> : null}
      {candidates.error ? (
        <ErrorState error={candidates.error} t={t} onRetry={() => void candidates.reload()} />
      ) : null}
      {candidates.data ? (
        <>
          {team.canManage ? (
            <div className="wf-form-actions">
              <button
                type="button"
                className="wf-button"
                disabled={submit.pending || candidates.loading}
                onClick={() => {
                  setSelection(
                    selectPage(
                      selection,
                      candidates.data!.items.map((entry) => entry.userId),
                    ),
                  );
                  setConfirmed(false);
                }}
              >
                {text.selectPage}
              </button>
              <button
                type="button"
                className="wf-button"
                disabled={submit.pending || candidates.loading || !candidates.data.page.total}
                onClick={() => {
                  setSelection({ kind: 'matching', excluded: [] });
                  setConfirmed(false);
                }}
              >
                {text.selectAll}
              </button>
              <button
                type="button"
                className="wf-button"
                disabled={submit.pending}
                onClick={() => {
                  setSelection(EMPTY_SELECTION);
                  setConfirmed(false);
                }}
              >
                {text.clear}
              </button>
              <span aria-live="polite">
                {text.selection}: {count}
              </span>
            </div>
          ) : null}
          {selection.kind === 'matching' ? <Notice tone="info">{text.allSelected}</Notice> : null}
          {!candidates.data.items.length ? (
            <Empty>{text.noRows}</Empty>
          ) : (
            <TeamMemberTable
              employees={candidates.data.items}
              selection={selection}
              selectable={team.canManage}
              disabled={submit.pending || candidates.loading}
              onToggle={(id) => {
                setSelection(toggleMember(selection, id));
                setConfirmed(false);
              }}
            />
          )}
          <OrganizationPager
            page={candidates.data.page}
            onChange={setPage}
            disabled={submit.pending || candidates.loading}
          />
        </>
      ) : null}
      {team.canManage ? (
        <form className="wf-form" onSubmit={(event) => void save(event)}>
          <p className="wf-muted">{text.selectionLimit}</p>
          <p className="wf-muted">{text.bulkHint}</p>
          {action === 'TRANSFER' ? (
            <TransferTarget
              team={team}
              value={targetTeamId}
              onChange={(id) => {
                setTargetTeamId(id);
                setConfirmed(false);
              }}
              disabled={submit.pending}
            />
          ) : null}
          <Field id="members-reason" label={t.common.reason} required>
            <textarea
              id="members-reason"
              required
              maxLength={500}
              disabled={submit.pending}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <CheckField
            checked={confirmed}
            disabled={submit.pending}
            onChange={(event) => setConfirmed(event.target.checked)}
            label={text.confirmBulk}
          />
          <p role="status">
            {text.progress}: {progress.processed} · {text.changed}: {progress.changed}
          </p>
          <FormFeedback error={submit.error} success={submit.success} t={t} />
          <SubmitButton
            pending={submit.pending}
            label={action === 'ADD' ? text.add : action === 'REMOVE' ? text.remove : text.transfer}
            pendingLabel={t.common.saving}
            disabled={
              !confirmed ||
              !count ||
              !reason.trim() ||
              candidates.loading ||
              (action === 'TRANSFER' && !targetTeamId)
            }
          />
        </form>
      ) : null}
    </Section>
  );
}
