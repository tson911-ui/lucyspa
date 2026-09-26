'use client';

import type {
  BranchSummary,
  EmployeeDirectoryEntry,
  EmployeeDirectoryGroup,
  EmployeeDirectoryResponse,
  EmployeeResponse,
  EmployeeStatus,
  InitialEmploymentClassification,
} from '@lucy-spa/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  canOfferCreate,
  classificationText,
  directoryTitle,
} from '../../../lib/workforce/employee-create';
import {
  directoryPage,
  filtersActive,
  FIRST_PAGES,
  pagerState,
  totalPages,
  withGroupPage,
  type DirectoryFilters,
  type GroupPages,
} from '../../../lib/workforce/employee-directory';
import { branchLabel, useBranches } from '../data';
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
  useResource,
  type Tone,
} from '../ui';
import { EmployeeCreateForm } from './employee-create';

const STATUSES: EmployeeStatus[] = ['ACTIVE', 'PENDING_SETUP', 'INACTIVE'];
const NO_FILTERS: DirectoryFilters = { q: '', branchId: '', status: '' };
/** Four mutually exclusive sections, managers first; each member appears in exactly one. */
const GROUPS: EmployeeDirectoryGroup[] = ['MANAGERS', 'EMPLOYEES', 'COLLABORATORS', 'TRAINEES'];
export const EMPLOYEE_STATUS_TONE: Record<EmployeeStatus, Tone> = {
  ACTIVE: 'success',
  PENDING_SETUP: 'warning',
  INACTIVE: 'neutral',
};

/**
 * Employee directory (VIEW_EMPLOYEES scope, enforced by the API before paging): a
 * "Quản lý / Managers" table (members with an active manager-group role) above a
 * "Nhân viên / Employees" table, each with its own server-side pages, and the
 * "Thêm nhân sự / Add employee" action for accounts with CREATE_EMPLOYEES.
 */
export function EmployeesScreen() {
  const { api, t } = useWorkforce();
  const { account } = useAccount();
  const branches = useBranches(api);
  const offerCreate = canOfferCreate(account);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<CreatedMember | null>(null);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [applied, setApplied] = useState(filters);
  // Bumped after a creation so both groups reload.
  const [refresh, setRefresh] = useState(0);
  // Independent pages: changing one group's page never changes the other's.
  const [pages, setPages] = useState<GroupPages>(FIRST_PAGES);

  function search(event: FormEvent) {
    event.preventDefault();
    setApplied(filters);
    // New filters: both groups start again at their first page.
    setPages(FIRST_PAGES);
  }

  function onCreated(employee: EmployeeResponse, classification: InitialEmploymentClassification) {
    setAdding(false);
    setCreated({ employee, classification });
    // Show the whole directory again so the new member is listed.
    setFilters(NO_FILTERS);
    setApplied({ ...NO_FILTERS });
    setPages(FIRST_PAGES);
    setRefresh((value) => value + 1);
  }

  return (
    <>
      <PageHeader title={t.employees.title}>
        {offerCreate && !adding ? (
          <button
            type="button"
            className="wf-button wf-button-primary"
            aria-controls="add-workforce-member"
            aria-expanded={false}
            onClick={() => {
              setCreated(null);
              setAdding(true);
            }}
          >
            {t.employees.add}
          </button>
        ) : null}
      </PageHeader>
      {created ? <CreatedNotice {...created} /> : null}
      {offerCreate && adding ? (
        <div id="add-workforce-member">
          <Section title={t.employees.create.title}>
            {branches.error ? (
              <ErrorState error={branches.error} t={t} onRetry={() => void branches.reload()} />
            ) : branches.data ? (
              <EmployeeCreateForm
                branches={branches.data}
                onCreated={onCreated}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <Loading t={t} />
            )}
          </Section>
        </div>
      ) : null}
      <Section title={t.common.search}>
        <form className="wf-filters" role="search" onSubmit={search}>
          <Field id="emp-q" label={t.employees.search}>
            <input
              id="emp-q"
              type="search"
              maxLength={100}
              value={filters.q}
              onChange={(event) => setFilters({ ...filters, q: event.target.value })}
            />
          </Field>
          <Field id="emp-branch" label={t.employees.branchFilter}>
            <select
              id="emp-branch"
              value={filters.branchId}
              onChange={(event) => setFilters({ ...filters, branchId: event.target.value })}
            >
              <option value="">{t.common.all}</option>
              {[...(branches.data?.values() ?? [])].map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="emp-status" label={t.employees.statusFilter}>
            <select
              id="emp-status"
              value={filters.status}
              onChange={(event) => setFilters({ ...filters, status: event.target.value })}
            >
              <option value="">{t.common.all}</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t.employees.statuses[status]}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="wf-button">
            {t.common.search}
          </button>
        </form>
      </Section>
      {GROUPS.map((group) => (
        <DirectoryGroupSection
          key={group}
          group={group}
          filters={applied}
          refresh={refresh}
          branches={branches.data}
          page={pages[group]}
          onPage={(page) => setPages((current) => withGroupPage(current, group, page))}
        />
      ))}
    </>
  );
}

interface CreatedMember {
  employee: EmployeeResponse;
  classification: InitialEmploymentClassification;
}

/** Success after creation: who was created, as what, and that sign-in is not yet granted. */
export function CreatedNotice({ employee, classification }: CreatedMember) {
  const { t, base } = useWorkforce();
  return (
    <Notice tone="success">
      <p>
        {fill(
          employee.status === 'ACTIVE'
            ? t.employees.create.createdWithAccess
            : t.employees.create.created,
          {
            name: employee.fullName,
            code: employee.employeeId,
            classification: classificationText(classification, t),
          },
        )}
      </p>
      <Link href={`${base}/employees/${employee.id}`}>{t.employees.create.viewCreated}</Link>
    </Notice>
  );
}

/** One group with its own current page, loaded from the server. */
function DirectoryGroupSection({
  group,
  filters,
  refresh,
  branches,
  page,
  onPage,
}: {
  group: EmployeeDirectoryGroup;
  filters: DirectoryFilters;
  refresh: number;
  branches: ReadonlyMap<string, BranchSummary> | null;
  page: number;
  onPage: (page: number) => void;
}) {
  const { api } = useWorkforce();
  const result = useResource(
    () => directoryPage(api, group, filters, page),
    [api, group, page, refresh, filters.q, filters.branchId, filters.status],
  );
  return (
    <DirectoryGroupView
      group={group}
      data={result.data}
      loading={result.loading}
      error={result.error}
      filtered={filtersActive(filters)}
      branches={branches}
      page={page}
      onPage={onPage}
      reload={result.reload}
    />
  );
}

const SECTION_TEXT = {
  MANAGERS: { title: 'managers', empty: 'noManagers', filtered: 'noManagersFiltered' },
  EMPLOYEES: { title: 'employees', empty: 'noEmployees', filtered: 'noEmployeesFiltered' },
  COLLABORATORS: {
    title: 'collaborators',
    empty: 'noCollaborators',
    filtered: 'noCollaboratorsFiltered',
  },
  TRAINEES: { title: 'trainees', empty: 'noTrainees', filtered: 'noTraineesFiltered' },
} as const;

/** A group's table, empty state and pagination (renders without a network in tests). */
export function DirectoryGroupView({
  group,
  data,
  loading,
  error,
  filtered,
  branches,
  page,
  onPage,
  reload,
}: {
  group: EmployeeDirectoryGroup;
  data: EmployeeDirectoryResponse | null;
  loading: boolean;
  error: unknown;
  filtered: boolean;
  branches: ReadonlyMap<string, BranchSummary> | null;
  page: number;
  onPage: (page: number) => void;
  reload: () => Promise<void>;
}) {
  const { t } = useWorkforce();
  const texts = t.employees.directory;
  const section = SECTION_TEXT[group];
  const title = texts[section.title];
  const items = data?.items ?? [];
  const pages = totalPages(data?.page?.total ?? 0, data?.page?.size);
  const empty = filtered ? texts[section.filtered] : texts[section.empty];
  return (
    <Section title={title}>
      {error ? <ErrorState error={error} t={t} onRetry={() => void reload()} /> : null}
      {data && !error && items.length === 0 ? <Empty>{empty}</Empty> : null}
      {items.length > 0 ? <DirectoryTable items={items} branches={branches} /> : null}
      {loading && !data ? <Loading t={t} /> : null}
      <Pagination label={title} page={page} pages={pages} onPage={onPage} />
    </Section>
  );
}

function DirectoryTable({
  items,
  branches,
}: {
  items: EmployeeDirectoryEntry[];
  branches: ReadonlyMap<string, BranchSummary> | null;
}) {
  const { t, base, locale } = useWorkforce();
  return (
    <table className="wf-table">
      <thead>
        <tr>
          <th scope="col">{t.employees.employeeId}</th>
          <th scope="col">{t.employees.fullName}</th>
          <th scope="col">{t.common.branch}</th>
          <th scope="col">{t.employees.titleColumn}</th>
          <th scope="col">{t.common.status}</th>
          <th scope="col">{t.common.actions}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((employee) => (
          <tr key={employee.id}>
            <td data-label={t.employees.employeeId}>{employee.employeeId}</td>
            <td data-label={t.employees.fullName}>{employee.fullName}</td>
            <td data-label={t.common.branch}>
              {employee.branchIds
                .map((id) => branchLabel(id, branches as Map<string, BranchSummary> | null, t))
                .join(', ') || '—'}
            </td>
            <td data-label={t.employees.titleColumn}>{directoryTitle(employee, t, locale)}</td>
            <td data-label={t.common.status}>
              <Badge tone={EMPLOYEE_STATUS_TONE[employee.status]}>
                {t.employees.statuses[employee.status]}
              </Badge>
            </td>
            <td data-label={t.common.actions}>
              <Link href={`${base}/employees/${employee.id}`}>{t.common.details}</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** « 1 2 3 … 8 »: hidden for a single page; previous/next disabled at the ends. */
export function Pagination({
  label,
  page,
  pages,
  onPage,
}: {
  label: string;
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  const { t } = useWorkforce();
  const texts = t.employees.directory;
  const state = pagerState(page, pages);
  if (!state.visible) return null;
  return (
    <nav className="wf-pagination" aria-label={fill(texts.pagination, { group: label })}>
      <button
        type="button"
        className="wf-button wf-button-quiet"
        aria-label={texts.previous}
        disabled={state.previousDisabled}
        onClick={() => onPage(page - 1)}
      >
        «
      </button>
      {state.items.map((item, index) =>
        item === 'gap' ? (
          <span key={`gap-${index}`} className="wf-muted" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            className={`wf-button ${item === page ? 'wf-button-primary' : 'wf-button-quiet'}`}
            aria-current={item === page ? 'page' : undefined}
            aria-label={fill(texts.pageNumber, { page: item })}
            onClick={() => onPage(item)}
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        className="wf-button wf-button-quiet"
        aria-label={texts.next}
        disabled={state.nextDisabled}
        onClick={() => onPage(page + 1)}
      >
        »
      </button>
    </nav>
  );
}
