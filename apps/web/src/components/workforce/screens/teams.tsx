'use client';

import type {
  EmployeeStatus,
  EmploymentClassification,
  TeamEmployee,
  TeamEmployeeFilters,
  TeamListResponse,
  TeamMembershipFilter,
  TeamSummary,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Combobox,
  ConfirmDialog,
  DataTable,
  DEFAULT_PAGE_SIZE,
  DescriptionList,
  EmptyState,
  FacetedFilter,
  Field,
  FormDialog,
  FormGrid,
  ListSection,
  ListToolbar,
  Menu,
  RowActions,
  SearchInput,
  SelectionBar,
  Select,
  Tabs,
  Textarea,
  TextInput,
  PageHeader as UiPageHeader,
  useUrlState,
  type DataTableColumn,
  type MenuItem,
} from '@lucy-spa/ui';
import { ListCrumbLink, PrefetchLink as Link } from '../link';
import { useMemo, useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { organizationDictionary } from '../../../i18n/organization';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  normalizePage,
  normalizePageSize,
  paginationLabels,
  resultsText,
  toolbarLabels,
} from '../../../lib/workforce/list-view';
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
import {
  normalizeTeamList,
  TEAM_LIST_DEFAULTS,
  TEAM_PAGE_KEYS,
  teamListQuery,
} from '../../../lib/workforce/teams-list';
import { runMutation } from '../../../lib/workforce/workflows';
import { opensInput } from '../../../lib/workforce/opens-input';
import { EMPLOYEE_STATUS_TONE } from './employees';
import { focusFirstInvalidSoon } from './service-price-fields';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  CheckField,
  Card,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  useResource,
  useSubmit,
  useSuccessToast,
} from '../ui';

/** Teams: a paged, searchable list (server mode, 20/page); a team opens its own page. */
export function TeamsScreen() {
  const { api, t, locale, base } = useWorkforce();
  const { account } = useAccount();
  const text = organizationDictionary(locale);
  const allowed = canAnywhere(account, 'VIEW_TEAMS') || canAnywhere(account, 'MANAGE_TEAMS');
  const manage = canAnywhere(account, 'MANAGE_TEAMS');
  const notify = useSuccessToast();
  const branches = useBranches(api);
  const [list, updateList] = useUrlState(TEAM_LIST_DEFAULTS, {
    normalize: normalizeTeamList,
    resetOnChange: TEAM_PAGE_KEYS,
  });
  const [creating, setCreating] = useState(false);
  const teams = useResource(
    () =>
      allowed
        ? api.get<TeamListResponse>('/api/v1/teams', teamListQuery(list))
        : Promise.resolve(null),
    [api, allowed, list.branch, list.q, list.page, list.pageSize],
  );
  if (!allowed) return <Notice tone="warning">{text.noAccess}</Notice>;

  const active = (list.q ? 1 : 0) + (list.branch ? 1 : 0);
  const columns: DataTableColumn<TeamSummary>[] = [
    {
      key: 'name',
      header: t.common.name,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      cell: (team) => (
        // The status sits under the name (never squeezed beside it, so it cannot overlap a wrapped name at 200 % text).
        <span className="ls-cell-stack">
          <Link className="ls-link" href={`${base}/teams/${team.id}`}>
            {team.name}
          </Link>
          {!team.isActive ? (
            <span>
              <Badge tone="neutral">{text.inactive}</Badge>
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'code',
      header: t.common.code,
      cell: (team) => (
        <span className="ls-ppl-code" translate="no">
          {team.code}
        </span>
      ),
    },
    {
      key: 'branch',
      header: t.common.branch,
      hideBelow: 'md',
      wrap: true,
      cell: (team) => branches.data?.get(team.branchId)?.name ?? t.common.unknownBranch,
    },
    {
      key: 'leader',
      header: text.leader,
      hideBelow: 'lg',
      wrap: true,
      // No leader is an empty value, muted, not a sentence in ink with the weight of a real name.
      cell: (team) =>
        team.leader?.fullName ?? <span className="ls-ppl-muted">{text.noLeader}</span>,
    },
    {
      key: 'members',
      header: text.members,
      numeric: true,
      cell: (team) => team.memberCount,
    },
  ];

  return (
    <>
      <PageHeader title={text.teams} intro={text.noLimit}>
        {manage ? (
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            {text.createTeam}
          </Button>
        ) : null}
      </PageHeader>
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={active}
        onReset={() => updateList({ q: '', branch: '' })}
        reload={{ label: t.common.reload, onClick: () => void teams.reload() }}
        search={
          <SearchInput
            id="team-q"
            value={list.q}
            label={text.searchTeams}
            hint={text.exampleTeams}
            clearLabel={t.common.list.clearSearch}
            onSearch={(q) => updateList({ q }, { replace: true })}
          />
        }
        filters={
          <FacetedFilter
            label={t.common.branch}
            clearLabel={t.common.list.clearChoice}
            options={[...(branches.data?.values() ?? [])].map((branch) => ({
              value: branch.id,
              label: branch.name,
            }))}
            selected={list.branch ? [list.branch] : []}
            onChange={([branch]) => updateList({ branch: branch ?? '' })}
          />
        }
      />
      <DataTable
        drillDown
        mode="server"
        caption={fill(t.common.list.table, { list: text.teams })}
        columns={columns}
        rows={teams.data?.items ?? []}
        rowKey={(team) => team.id}
        loading={teams.loading}
        loadingLabel={t.common.loading}
        error={
          teams.error ? (
            <ErrorState error={teams.error} t={t} onRetry={() => void teams.reload()} />
          ) : undefined
        }
        empty={
          teams.data ? (
            <EmptyState icon="users" title={active > 0 ? text.noMatchTitle : text.teamsEmptyTitle}>
              {active > 0 ? text.noRows : text.teamsEmpty}
            </EmptyState>
          ) : undefined
        }
        paging={{
          page: list.page,
          pageSize: list.pageSize,
          total: teams.data?.page.total ?? 0,
          onPageChange: (page) => updateList({ page }),
          onPageSizeChange: (pageSize) => updateList({ pageSize }),
          labels: paginationLabels(t, text.teams),
        }}
      />
      {creating ? (
        <TeamCreate
          onClose={() => setCreating(false)}
          onCreated={async () => {
            await teams.reload();
            setCreating(false);
            notify(text.created);
          }}
        />
      ) : null}
    </>
  );
}

/** Short form (4 fields): a dialog opened from the page header. Mounted only while open. */
function TeamCreate({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const text = organizationDictionary(locale);
  const branches = useBranches(api);
  const [form, setForm] = useState({ branchId: '', code: '', name: '', reason: '' });
  const submit = useSubmit();
  const ready =
    form.branchId !== '' &&
    form.code.trim() !== '' &&
    form.name.trim() !== '' &&
    form.reason.trim() !== '';

  // Validate on submit: the button stays enabled, each missing field says so where it is.
  const [tried, setTried] = useState(false);
  const missing = (value: string) =>
    tried && value.trim() === '' ? t.common.form.fieldRequired : undefined;

  async function save() {
    if (!ready) {
      setTried(true);
      return;
    }
    const ok = await submit.run(
      () => runMutation(() => api.post('/api/v1/teams', form), onCreated),
      '',
    );
    if (ok) await onCreated();
  }

  return (
    <FormDialog
      title={text.createTeamTitle}
      labels={formOverlayLabels(t, t.common.create)}
      busy={submit.pending}
      dirty={form.code !== '' || form.name !== '' || form.reason !== '' || form.branchId !== ''}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <Field
          label={t.common.branch}
          required
          error={tried && form.branchId === '' ? t.common.form.choiceRequired : undefined}
        >
          {(control) => (
            <Select
              {...control}
              placeholder={text.choose}
              value={form.branchId}
              onChange={(event) => setForm({ ...form, branchId: event.target.value })}
              options={[...(branches.data?.values() ?? [])]
                .filter((branch) => branch.isActive && canAt(account, 'MANAGE_TEAMS', branch.id))
                .map((branch) => ({ value: branch.id, label: branch.name }))}
            />
          )}
        </Field>
        <Field label={t.common.code} required width="md" error={missing(form.code)}>
          {(control) => (
            <TextInput
              {...control}
              name="code"
              maxLength={64}
              spellCheck={false}
              autoCapitalize="none"
              translate="no"
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.common.name} required error={missing(form.name)}>
          {(control) => (
            <TextInput
              {...control}
              name="name"
              maxLength={200}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.common.reason} required error={missing(form.reason)}>
          {(control) => (
            <TextInput
              {...control}
              name="reason"
              maxLength={500}
              value={form.reason}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

type TeamOverlay = 'edit' | 'leader' | 'removeLeader' | 'delete';

/**
 * One team on its own page: summary, header actions (edit, change leader, a `⋮` menu with
 * remove leader and delete) and the members table with bulk add / remove / transfer.
 */
export function TeamDetailScreen({ id }: { id: string }) {
  const { api, t, locale, base, navigate } = useWorkforce();
  const text = organizationDictionary(locale);
  const notify = useSuccessToast();
  const branches = useBranches(api);
  const team = useResource(() => api.get<TeamSummary>(`/api/v1/teams/${id}`), [api, id]);
  const [overlay, setOverlay] = useState<TeamOverlay | null>(null);

  if (team.error && !team.data) {
    return <ErrorState error={team.error} t={t} onRetry={() => void team.reload()} />;
  }
  if (!team.data) return <Loading t={t} page />;
  const current = team.data;

  /** After a successful change: refresh, close the overlay and say what happened. */
  const finish = (message: string) => async () => {
    await team.reload();
    setOverlay(null);
    notify(message);
  };
  const menu: MenuItem[] = [
    ...(current.isActive && current.canAssignLeader && current.leader
      ? [
          {
            id: 'removeLeader',
            label: opensInput(text.removeLeader),
            icon: 'user' as const,
            onSelect: () => setOverlay('removeLeader'),
          },
        ]
      : []),
    ...(current.isActive && current.canManage
      ? [
          {
            id: 'delete',
            label: opensInput(text.deleteTeam),
            icon: 'trash' as const,
            tone: 'danger' as const,
            onSelect: () => setOverlay('delete'),
          },
        ]
      : []),
  ];
  return (
    <>
      <UiPageHeader
        title={current.name}
        // An inactive team says so under the title (kit status slot), not in a separate notice box.
        status={!current.isActive ? <Badge tone="neutral">{text.inactive}</Badge> : undefined}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={ListCrumbLink}
            items={[{ label: text.teams, href: `${base}/teams` }, { label: current.name }]}
          />
        }
        actions={
          <>
            {menu.length > 0 ? <RowActions menuLabel={text.moreActions} items={menu} /> : null}
            {current.isActive && current.canAssignLeader ? (
              <Button variant="secondary" onClick={() => setOverlay('leader')}>
                {text.changeLeader}
              </Button>
            ) : null}
            {current.isActive && current.canManage ? (
              <Button variant="primary" icon="edit" onClick={() => setOverlay('edit')}>
                {text.editTeam}
              </Button>
            ) : null}
          </>
        }
      />
      <Card as="section" aria-label={current.name}>
        <DescriptionList
          columns={2}
          items={[
            {
              label: t.common.branch,
              value: branches.data?.get(current.branchId)?.name ?? t.common.unknownBranch,
            },
            { label: t.common.code, value: <span translate="no">{current.code}</span> },
            {
              label: text.leader,
              value: current.leader?.fullName ?? (
                <span className="ls-ppl-muted">{text.noLeader}</span>
              ),
            },
            { label: text.members, value: current.memberCount },
          ]}
        />
      </Card>
      {current.isActive ? <TeamMembers team={current} reload={team.reload} /> : null}
      {overlay === 'edit' ? (
        <TeamEdit
          team={current}
          reload={team.reload}
          onClose={() => setOverlay(null)}
          onSaved={finish(text.saved)}
        />
      ) : null}
      {overlay === 'leader' ? (
        <LeaderDialog
          team={current}
          reload={team.reload}
          onClose={() => setOverlay(null)}
          onSaved={finish(text.saved)}
        />
      ) : null}
      {overlay === 'removeLeader' ? (
        <TeamConfirm
          kind="removeLeader"
          team={current}
          reload={team.reload}
          onClose={() => setOverlay(null)}
          onDone={finish(text.leaderRemoved)}
        />
      ) : null}
      {overlay === 'delete' ? (
        <TeamConfirm
          kind="delete"
          team={current}
          reload={team.reload}
          onClose={() => setOverlay(null)}
          onDone={async () => {
            notify(text.deleted);
            navigate?.(`${base}/teams`);
          }}
        />
      ) : null}
    </>
  );
}

/** Rename the team: a short form in a dialog. */
function TeamEdit({
  team,
  reload,
  onClose,
  onSaved,
}: {
  team: TeamSummary;
  reload: () => Promise<void>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [name, setName] = useState(team.name);
  const [reason, setReason] = useState('');
  const submit = useSubmit();
  const changed = name.trim() !== team.name;
  // Validate on submit: a missing name or reason is reported at its field (the button is off only while nothing changed).
  const [tried, setTried] = useState(false);

  async function save() {
    if (name.trim() === '' || reason.trim() === '') {
      setTried(true);
      focusFirstInvalidSoon();
      return;
    }
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/teams/${team.id}`, { expectedVersion: team.version, reason, name }),
          reload,
        ),
      '',
    );
    if (ok) await onSaved();
  }

  return (
    <FormDialog
      title={text.editTeamTitle}
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={changed || reason !== ''}
      submitDisabled={!changed}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <Field
          label={t.common.name}
          required
          error={tried && name.trim() === '' ? t.common.form.fieldRequired : undefined}
        >
          {(control) => (
            <TextInput
              {...control}
              name="name"
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={t.common.reason}
          required
          error={tried && reason.trim() === '' ? t.common.form.reasonRequired : undefined}
        >
          {(control) => (
            <TextInput
              {...control}
              name="reason"
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/** Pick the new leader among eligible employees (searched on the server) and say why. */
function LeaderDialog({
  team,
  reload,
  onClose,
  onSaved,
}: {
  team: TeamSummary;
  reload: () => Promise<void>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [q, setQ] = useState('');
  const [leader, setLeader] = useState<{ value: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const candidates = useResource(
    () =>
      teamEmployees(
        api,
        team.id,
        { q, membership: 'ALL', classification: 'OFFICIAL_EMPLOYEE', status: 'ACTIVE' },
        1,
        20,
      ),
    [api, team.id, q],
  );
  const submit = useSubmit();
  const [tried, setTried] = useState(false);

  async function save() {
    if (leader === null || reason.trim() === '') {
      setTried(true);
      focusFirstInvalidSoon();
      return;
    }
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/teams/${team.id}/leader`, {
              userId: leader?.value ?? null,
              expectedVersion: team.version,
              reason,
            }),
          reload,
        ),
      '',
    );
    if (ok) await onSaved();
  }

  const fetched = (candidates.data?.items ?? []).map((employee) => ({
    value: employee.userId,
    label: `${employee.fullName} (${employee.employeeCode})`,
  }));
  // The chosen person stays in the list while the search text narrows it.
  const options = leader ? [leader, ...fetched.filter((o) => o.value !== leader.value)] : fetched;
  return (
    <FormDialog
      title={text.changeLeaderTitle}
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={leader !== null || reason !== ''}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <Field
          label={text.leaderField}
          required
          error={tried && leader === null ? t.common.form.choiceRequired : undefined}
        >
          {(control) => (
            <Combobox
              {...control}
              options={options}
              value={leader?.value ?? null}
              onValueChange={(value) => setLeader(options.find((o) => o.value === value) ?? null)}
              onQueryChange={setQ}
              loading={candidates.loading}
              loadingLabel={t.common.loading}
              // A failed search says so; "no match" only when the search worked.
              emptyLabel={candidates.error ? t.errors.network : text.noRows}
              placeholder={text.exampleEmployee}
              resultsLabel={(count) => resultsText(t, count)}
            />
          )}
        </Field>
        <Field
          label={t.common.reason}
          required
          error={tried && reason.trim() === '' ? t.common.form.reasonRequired : undefined}
        >
          {(control) => (
            <TextInput
              {...control}
              name="reason"
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/** Remove the leader or delete the team: a confirmation with a required reason. */
function TeamConfirm({
  kind,
  team,
  reload,
  onClose,
  onDone,
}: {
  kind: 'removeLeader' | 'delete';
  team: TeamSummary;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const removing = kind === 'removeLeader';
  return (
    <ConfirmDialog
      title={removing ? text.removeLeaderTitle : text.deleteTitle}
      description={removing ? text.removeLeaderBody : text.deleteWarning}
      facts={[{ label: text.teams, value: `${team.name} (${team.code})` }]}
      tone="danger"
      confirmLabel={removing ? text.removeLeader : text.deleteTeam}
      busyLabel={removing ? t.common.removing : t.common.deleting}
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
            removing
              ? api.post(`/api/v1/teams/${team.id}/leader`, {
                  userId: null,
                  expectedVersion: team.version,
                  reason: reason ?? '',
                })
              : api.post(`/api/v1/teams/${team.id}/delete`, {
                  expectedVersion: team.version,
                  reason: reason ?? '',
                  confirmed: true,
                }),
          reload,
        );
        if (!outcome.ok) throw outcome.error;
        await onDone();
      }}
    />
  );
}

type BulkAction = 'ADD' | 'REMOVE' | 'TRANSFER';
type MemberMode = 'members' | 'add' | 'view';

const MEMBER_STATUSES: readonly string[] = ['ACTIVE', 'INACTIVE', 'PENDING_SETUP'];
const MEMBER_CLASSIFICATIONS: readonly string[] = ['OFFICIAL_EMPLOYEE', 'COLLABORATOR', 'TRAINEE'];
const MEMBERSHIPS: readonly string[] = ['MEMBERS', 'ALL', 'UNASSIGNED', 'OTHER_TEAM'];

/**
 * The members view lives in the address bar so Back/Forward and a shared link restore it: the tab (`mtab`), search (`mq`),
 * status (`mst`), classification (`mcl`), the read-only "current team" filter (`mteam`), page (`mpage`) and page size
 * (`msize`). The `m` prefix keeps them apart from any other list's keys.
 */
const MEMBER_URL_DEFAULTS = {
  mtab: 'members',
  mq: '',
  mst: '',
  mcl: '',
  mteam: '',
  mpage: 1,
  msize: DEFAULT_PAGE_SIZE,
};
type MemberUrlState = typeof MEMBER_URL_DEFAULTS;
const MEMBER_URL_OPTIONS = {
  normalize: (state: MemberUrlState): MemberUrlState => ({
    mtab: state.mtab === 'add' ? 'add' : 'members',
    mq: state.mq,
    mst: MEMBER_STATUSES.includes(state.mst) ? state.mst : '',
    mcl: MEMBER_CLASSIFICATIONS.includes(state.mcl) ? state.mcl : '',
    mteam: MEMBERSHIPS.includes(state.mteam) ? state.mteam : '',
    mpage: normalizePage(state.mpage),
    msize: normalizePageSize(state.msize),
  }),
  resetOnChange: ['mpage'],
};
/** Filters cleared when the members tab changes (each tab starts from its own default view). */
const MEMBER_FILTERS_CLEARED: Partial<MemberUrlState> = { mq: '', mst: '', mcl: '', mteam: '' };

/**
 * Members of one team. Managers get two tabs: the current members (select some to remove or
 * transfer them) and the employees without a team (select some to add them). Everyone else sees
 * one read-only list with a "current team" filter.
 */
function TeamMembers({ team, reload }: { team: TeamSummary; reload: () => Promise<void> }) {
  const { locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [url, updateUrl] = useUrlState(MEMBER_URL_DEFAULTS, MEMBER_URL_OPTIONS);
  if (!team.canManage) {
    return (
      <ListSection title={text.members}>
        <MemberList team={team} reload={reload} mode="view" url={url} updateUrl={updateUrl} />
      </ListSection>
    );
  }
  return (
    <Tabs
      label={text.members}
      value={url.mtab}
      onChange={(id) =>
        updateUrl({ ...MEMBER_FILTERS_CLEARED, mtab: id === 'add' ? 'add' : 'members' })
      }
      tabs={[
        {
          id: 'members',
          // No count in a tab label (Owner rule): the number lives in the summary and the table's "Hiển thị" line.
          label: text.members,
          panel: (
            <MemberList
              team={team}
              reload={reload}
              mode="members"
              url={url}
              updateUrl={updateUrl}
            />
          ),
        },
        {
          id: 'add',
          label: text.addTab,
          panel: (
            <MemberList team={team} reload={reload} mode="add" url={url} updateUrl={updateUrl} />
          ),
        },
      ]}
    />
  );
}

/** The API filters of a members view, from its URL state (the tab fixes the membership outside the read-only view). */
function memberFilters(
  mode: MemberMode,
  url: Pick<MemberUrlState, 'mq' | 'mst' | 'mcl' | 'mteam'>,
): TeamEmployeeFilters {
  return {
    membership:
      mode === 'add'
        ? 'UNASSIGNED'
        : mode === 'members'
          ? 'MEMBERS'
          : ((url.mteam || 'MEMBERS') as TeamMembershipFilter),
    ...(url.mq ? { q: url.mq } : {}),
    ...(url.mst ? { status: url.mst as EmployeeStatus } : {}),
    ...(url.mcl ? { classification: url.mcl as Exclude<EmploymentClassification, 'ENDED'> } : {}),
  };
}

/** One members table: filters, row selection and the bulk actions that fit the mode. */
function MemberList({
  team,
  reload,
  mode,
  url,
  updateUrl,
}: {
  team: TeamSummary;
  reload: () => Promise<void>;
  mode: MemberMode;
  url: MemberUrlState;
  updateUrl: (patch: Partial<MemberUrlState>, change?: { replace?: boolean }) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const notify = useSuccessToast();
  const page = url.mpage;
  const pageSize = url.msize;
  // Rebuilt only when a filter value changes (primitive keys), so the resource does not reload on every render.
  const { mq, mst, mcl, mteam } = url;
  const filterKey = `${mode}|${mq}|${mst}|${mcl}|${mteam}`;
  const filters = useMemo(
    () => memberFilters(mode, { mq, mst, mcl, mteam }),
    [mode, mq, mst, mcl, mteam],
  );
  // A selection belongs to the filters it was made under: a filter change (also by Back/Forward) clears it, derived in render.
  const [picked, setPicked] = useState<{ key: string; value: MemberSelection }>({
    key: filterKey,
    value: EMPTY_SELECTION,
  });
  const selection = picked.key === filterKey ? picked.value : EMPTY_SELECTION;
  const setSelection = (value: MemberSelection) => setPicked({ key: filterKey, value });
  const [bulk, setBulk] = useState<{ action: BulkAction; count: number } | null>(null);
  const selectable = mode !== 'view';
  const candidates = useResource(
    () => teamEmployees(api, team.id, filters, page, pageSize),
    [api, team.id, filters, page, pageSize],
  );
  const total = candidates.data?.page.total ?? 0;
  const count = selectionCount(selection, total);

  /** A new filter goes to the address bar (page back to 1 via `resetOnChange`); typing replaces the entry. */
  function filter(next: Partial<MemberUrlState>, replace = false) {
    updateUrl(next, { replace });
  }

  const items = candidates.data?.items ?? [];
  const limitReached = (id: string) =>
    (selection.kind === 'explicit' && selection.ids.length >= 100 && !selected(selection, id)) ||
    (selection.kind === 'matching' && selection.excluded.length >= 100 && selected(selection, id));
  const columns: DataTableColumn<TeamEmployee>[] = [
    {
      key: 'employee',
      header: text.employee,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      cell: (employee) => {
        const name = employee.fullName + ' (' + employee.employeeCode + ')';
        // The name is the label of its checkbox: one row-wide target, and the phone card title.
        return selectable ? (
          <CheckField
            label={name}
            disabled={limitReached(employee.userId)}
            checked={selected(selection, employee.userId)}
            onChange={() => setSelection(toggleMember(selection, employee.userId))}
          />
        ) : (
          name
        );
      },
    },
    {
      key: 'status',
      header: t.common.status,
      // The same status badge as the staff list (icon + word), not plain text on this page only.
      cell: (employee) => (
        <Badge tone={EMPLOYEE_STATUS_TONE[employee.status]}>
          {t.employees.statuses[employee.status]}
        </Badge>
      ),
    },
    {
      key: 'classification',
      header: text.classification,
      hideBelow: 'lg',
      cell: (employee) =>
        employee.classification ? t.employees.classifications[employee.classification] : '—',
    },
    {
      key: 'team',
      header: text.currentTeam,
      hideBelow: 'md',
      wrap: true,
      cell: (employee) => employee.teamName ?? text.unassigned,
    },
  ];
  const activeFilters =
    (filters.q ? 1 : 0) + (filters.status ? 1 : 0) + (filters.classification ? 1 : 0);
  const allMatching = selection.kind === 'matching';

  return (
    <>
      {selectable && count > 0 ? (
        <SelectionBar label={text.selectionActions} summary={`${text.selection}: ${count}`}>
          {!allMatching && count < total ? (
            <Button
              variant="ghost"
              onClick={() => setSelection({ kind: 'matching', excluded: [] })}
            >
              {fill(text.selectAllCount, { count: total })}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => setSelection(EMPTY_SELECTION)}>
            {text.clear}
          </Button>
          {mode === 'members' ? (
            <>
              <Button variant="secondary" onClick={() => setBulk({ action: 'TRANSFER', count })}>
                {text.transferOpen}
              </Button>
              <Button variant="danger-outline" onClick={() => setBulk({ action: 'REMOVE', count })}>
                {text.remove}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => setBulk({ action: 'ADD', count })}>
              {text.add}
            </Button>
          )}
        </SelectionBar>
      ) : (
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={activeFilters}
          onReset={() => filter(MEMBER_FILTERS_CLEARED)}
          reload={{ label: t.common.reload, onClick: () => void candidates.reload() }}
          search={
            <SearchInput
              id={`member-q-${mode}`}
              value={mq}
              label={text.search}
              hint={text.exampleEmployee}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => filter({ mq: q }, true)}
            />
          }
          filters={
            <>
              <FacetedFilter
                label={t.common.status}
                clearLabel={t.common.list.clearChoice}
                options={(['ACTIVE', 'INACTIVE', 'PENDING_SETUP'] as const).map((status) => ({
                  value: status,
                  label: t.employees.statuses[status],
                }))}
                selected={mst ? [mst] : []}
                onChange={([status]) => filter({ mst: status ?? '' })}
              />
              <FacetedFilter
                label={text.classification}
                clearLabel={t.common.list.clearChoice}
                options={(['OFFICIAL_EMPLOYEE', 'COLLABORATOR', 'TRAINEE'] as const).map(
                  (classification) => ({
                    value: classification,
                    label: t.employees.classifications[classification],
                  }),
                )}
                selected={mcl ? [mcl] : []}
                onChange={([classification]) => filter({ mcl: classification ?? '' })}
              />
              {mode === 'view' ? (
                <FacetedFilter
                  label={text.currentTeam}
                  clearLabel={t.common.list.clearChoice}
                  options={[
                    { value: 'MEMBERS', label: text.currentMembers },
                    { value: 'ALL', label: text.allEmployees },
                    { value: 'UNASSIGNED', label: text.unassigned },
                    { value: 'OTHER_TEAM', label: text.otherTeam },
                  ]}
                  selected={[filters.membership ?? 'MEMBERS']}
                  onChange={([membership]) =>
                    filter({ mteam: membership && membership !== 'MEMBERS' ? membership : '' })
                  }
                />
              ) : null}
            </>
          }
          actions={
            selectable ? (
              <Menu
                label={text.select}
                icon="check"
                items={[
                  {
                    id: 'page',
                    label: text.selectPage,
                    disabled: candidates.loading || items.length === 0,
                    onSelect: () =>
                      setSelection(
                        selectPage(
                          selection,
                          items.map((entry) => entry.userId),
                        ),
                      ),
                  },
                  {
                    id: 'all',
                    label: text.selectAll,
                    disabled: candidates.loading || total === 0,
                    onSelect: () => setSelection({ kind: 'matching', excluded: [] }),
                  },
                ]}
              />
            ) : undefined
          }
        />
      )}
      {allMatching ? <Notice tone="info">{text.allSelected}</Notice> : null}
      <DataTable
        mode="server"
        caption={fill(t.common.list.table, { list: text.members })}
        columns={columns}
        rows={items}
        rowKey={(employee) => employee.userId}
        loading={candidates.loading}
        loadingLabel={t.common.loading}
        error={
          candidates.error ? (
            <ErrorState error={candidates.error} t={t} onRetry={() => void candidates.reload()} />
          ) : undefined
        }
        empty={
          candidates.data ? (
            <Empty
              title={text.people.noCandidatesTitle}
              action={
                mq || mst || mcl || mteam ? (
                  <Button variant="secondary" onClick={() => filter(MEMBER_FILTERS_CLEARED)}>
                    {t.common.list.reset}
                  </Button>
                ) : undefined
              }
            >
              {text.noRows}
            </Empty>
          ) : undefined
        }
        paging={{
          page,
          pageSize,
          total,
          onPageChange: (next) => updateUrl({ mpage: next }),
          onPageSizeChange: (size) => updateUrl({ msize: size }),
          labels: paginationLabels(t, text.members),
        }}
      />
      {bulk !== null ? (
        <BulkDialog
          team={team}
          action={bulk.action}
          count={bulk.count}
          label={
            bulk.action === 'ADD'
              ? text.add
              : bulk.action === 'REMOVE'
                ? text.remove
                : text.transfer
          }
          selection={selection}
          filters={filters}
          onClose={() => setBulk(null)}
          onFinished={async (ok) => {
            setSelection(EMPTY_SELECTION);
            await Promise.all([reload(), candidates.reload()]);
            if (ok) {
              setBulk(null);
              notify(text.saved);
            }
          }}
        />
      ) : null}
    </>
  );
}

/** Confirm a bulk change: batches run on the server; a failure keeps the completed batches. */
function BulkDialog({
  team,
  action,
  count,
  label,
  selection,
  filters,
  onClose,
  onFinished,
}: {
  team: TeamSummary;
  action: BulkAction;
  count: number;
  label: string;
  selection: MemberSelection;
  filters: TeamEmployeeFilters;
  onClose: () => void;
  onFinished: (ok: boolean) => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState<{ value: string; label: string } | null>(null);
  const [targetQuery, setTargetQuery] = useState('');
  const [progress, setProgress] = useState({ processed: 0, changed: 0 });
  const [tried, setTried] = useState(false);
  const submit = useSubmit();
  const targets = useResource(
    () =>
      action === 'TRANSFER'
        ? api.get<TeamListResponse>('/api/v1/teams', {
            branchId: team.branchId,
            q: targetQuery,
            page: 1,
            limit: 20,
          })
        : Promise.resolve(null),
    [api, action, team.branchId, targetQuery],
  );
  const needsTarget = action === 'TRANSFER';
  const fetchedTargets = (targets.data?.items ?? [])
    .filter((entry) => entry.id !== team.id && entry.isActive && entry.canManage)
    .map((entry) => ({ value: entry.id, label: entry.name }));
  const targetOptions = target
    ? [target, ...fetchedTargets.filter((o) => o.value !== target.value)]
    : fetchedTargets;

  async function save() {
    if (reason.trim() === '' || (needsTarget && target === null)) {
      setTried(true);
      focusFirstInvalidSoon();
      return;
    }
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
                ...(needsTarget && target ? { targetTeamId: target.value } : {}),
                expectedVersion: team.version,
                reason,
                selection: bulkSelection(selection, filters),
              },
              setProgress,
            ),
          () => undefined,
        ),
      '',
    );
    await onFinished(ok);
  }

  return (
    <FormDialog
      title={label}
      description={`${fill(text.bulkBody, { count })} ${text.bulkHint}`}
      labels={formOverlayLabels(t, label)}
      busy={submit.pending}
      dirty={reason !== '' || target !== null}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        {needsTarget ? (
          <Field
            label={text.target}
            required
            error={tried && target === null ? t.common.form.choiceRequired : undefined}
          >
            {(control) => (
              <Combobox
                {...control}
                options={targetOptions}
                value={target?.value ?? null}
                onValueChange={(value) =>
                  setTarget(targetOptions.find((o) => o.value === value) ?? null)
                }
                onQueryChange={setTargetQuery}
                loading={targets.loading}
                loadingLabel={t.common.loading}
                emptyLabel={text.noRows}
                placeholder={text.exampleTarget}
                resultsLabel={(n) => resultsText(t, n)}
              />
            )}
          </Field>
        ) : null}
        <Field
          label={t.common.reason}
          required
          error={tried && reason.trim() === '' ? t.common.form.reasonRequired : undefined}
        >
          {(control) => (
            <Textarea
              {...control}
              name="reason"
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
      {submit.pending ? (
        <p role="status" className="ls-hint">
          {text.progress}: {progress.processed}. {text.changed}: {progress.changed}.
        </p>
      ) : null}
    </FormDialog>
  );
}
