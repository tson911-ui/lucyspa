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
import {
  DataTable,
  FilterChips,
  ListToolbar,
  SearchInput,
  Select,
  buttonClass,
  useUrlState,
  type DataTableColumn,
  type FilterChip,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  canOfferCreate,
  classificationText,
  directoryTitle,
} from '../../../lib/workforce/employee-create';
import {
  DIRECTORY_PAGE_SIZE,
  directoryPage,
  EMPLOYEE_LIST_DEFAULTS,
  EMPLOYEE_PAGE_KEYS,
  filtersActive,
  GROUP_PAGE_KEY,
  normalizeEmployeeList,
  type DirectoryFilters,
} from '../../../lib/workforce/employee-directory';
import { paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
import { organizationDictionary } from '../../../i18n/organization';
import { branchLabel, useBranches } from '../data';
import { ManagementLevels, useManagementLevelVisible } from './management-levels';
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
 * Search, filters, page size and each table's page live in the address bar (`useUrlState`).
 */
export function EmployeesScreen() {
  const { api, t } = useWorkforce();
  const { account } = useAccount();
  const branches = useBranches(api);
  const offerCreate = canOfferCreate(account);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<CreatedMember | null>(null);
  const [list, updateList] = useUrlState(EMPLOYEE_LIST_DEFAULTS, {
    normalize: normalizeEmployeeList,
    resetOnChange: EMPLOYEE_PAGE_KEYS,
  });
  // Bumped after a creation so both groups reload.
  const [refresh, setRefresh] = useState(0);
  const filters: DirectoryFilters = { q: list.q, branchId: list.branch, status: list.status };

  function onCreated(employee: EmployeeResponse, classification: InitialEmploymentClassification) {
    setAdding(false);
    setCreated({ employee, classification });
    // Show the whole directory again so the new member is listed.
    updateList({ ...EMPLOYEE_LIST_DEFAULTS });
    setRefresh((value) => value + 1);
  }

  const branchList = [...(branches.data?.values() ?? [])];
  const chips: FilterChip[] = [
    ...(list.q ? [{ key: 'q', label: `“${list.q}”` }] : []),
    ...(list.branch
      ? [
          {
            key: 'branch',
            label: `${t.employees.branchFilter}: ${
              branchList.find((branch) => branch.id === list.branch)?.name ?? list.branch
            }`,
          },
        ]
      : []),
    ...(list.status
      ? [
          {
            key: 'status',
            label: `${t.employees.statusFilter}: ${
              t.employees.statuses[list.status as EmployeeStatus]
            }`,
          },
        ]
      : []),
  ];

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
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={chips.length}
          onReset={() => updateList({ q: '', branch: '', status: '' })}
          search={
            <SearchInput
              id="emp-q"
              value={list.q}
              label={t.employees.search}
              placeholder={t.employees.search}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => updateList({ q }, { replace: true })}
            />
          }
          filters={
            <>
              <Field id="emp-branch" label={t.employees.branchFilter}>
                <Select
                  id="emp-branch"
                  value={list.branch}
                  placeholder={t.common.all}
                  options={branchList.map((branch) => ({ value: branch.id, label: branch.name }))}
                  onChange={(event) => updateList({ branch: event.target.value })}
                />
              </Field>
              <Field id="emp-status" label={t.employees.statusFilter}>
                <Select
                  id="emp-status"
                  value={list.status}
                  placeholder={t.common.all}
                  options={STATUSES.map((status) => ({
                    value: status,
                    label: t.employees.statuses[status],
                  }))}
                  onChange={(event) => updateList({ status: event.target.value })}
                />
              </Field>
            </>
          }
          chips={
            <FilterChips
              chips={chips}
              removeLabel={t.common.list.removeFilter}
              onRemove={(key) => updateList({ [key]: '' })}
            />
          }
        />
      </Section>
      {GROUPS.map((group) => (
        <DirectoryGroupSection
          key={group}
          group={group}
          filters={filters}
          refresh={refresh}
          branches={branches.data}
          page={list[GROUP_PAGE_KEY[group]]}
          pageSize={list.pageSize}
          onPage={(page) => updateList({ [GROUP_PAGE_KEY[group]]: page })}
          onPageSize={(pageSize) => updateList({ pageSize })}
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
  pageSize,
  onPage,
  onPageSize,
}: {
  group: EmployeeDirectoryGroup;
  filters: DirectoryFilters;
  refresh: number;
  branches: ReadonlyMap<string, BranchSummary> | null;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
}) {
  const { api } = useWorkforce();
  const result = useResource(
    () => directoryPage(api, group, filters, page, pageSize),
    [api, group, page, pageSize, refresh, filters.q, filters.branchId, filters.status],
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
      pageSize={pageSize}
      onPage={onPage}
      onPageSize={onPageSize}
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
  pageSize = DIRECTORY_PAGE_SIZE,
  onPage,
  onPageSize,
  reload,
}: {
  group: EmployeeDirectoryGroup;
  data: EmployeeDirectoryResponse | null;
  loading: boolean;
  error: unknown;
  filtered: boolean;
  branches: ReadonlyMap<string, BranchSummary> | null;
  page: number;
  pageSize?: number;
  onPage: (page: number) => void;
  onPageSize?: (pageSize: number) => void;
  reload: () => Promise<void>;
}) {
  const { t, base, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const texts = t.employees.directory;
  const section = SECTION_TEXT[group];
  const title = texts[section.title];
  const items = data?.items ?? [];
  const empty = filtered ? texts[section.filtered] : texts[section.empty];
  const showLevel = useManagementLevelVisible();

  const columns: DataTableColumn<EmployeeDirectoryEntry>[] = [
    {
      key: 'employeeId',
      header: t.employees.employeeId,
      cell: (employee) => employee.employeeId,
    },
    {
      key: 'fullName',
      header: t.employees.fullName,
      mobileTitle: true,
      cell: (employee) => (
        <Link className="ls-link" href={`${base}/employees/${employee.id}`}>
          {employee.fullName}
        </Link>
      ),
    },
    {
      key: 'branch',
      header: t.common.branch,
      hideBelow: 'md',
      cell: (employee) =>
        employee.branchIds
          .map((id) => branchLabel(id, branches as Map<string, BranchSummary> | null, t))
          .join(', ') || '—',
    },
    {
      key: 'title',
      header: t.employees.titleColumn,
      hideBelow: 'lg',
      cell: (employee) => directoryTitle(employee, t, locale),
    },
    ...(showLevel
      ? [
          {
            key: 'level',
            header: text.level,
            hideBelow: 'lg' as const,
            cell: (employee: EmployeeDirectoryEntry) => (
              <ManagementLevels
                appointments={employee.organizationAppointments}
                branches={branches}
              />
            ),
          },
        ]
      : []),
    {
      key: 'status',
      header: t.common.status,
      cell: (employee) => (
        <Badge tone={EMPLOYEE_STATUS_TONE[employee.status]}>
          {t.employees.statuses[employee.status]}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (employee) => (
        <Link className={buttonClass('secondary')} href={`${base}/employees/${employee.id}`}>
          {t.common.details}
        </Link>
      ),
    },
  ];

  return (
    <Section title={title}>
      <DataTable
        mode="server"
        caption={fill(t.common.list.table, { list: title })}
        columns={columns}
        rows={items}
        rowKey={(employee) => employee.id}
        loading={loading}
        loadingLabel={t.common.loading}
        error={error ? <ErrorState error={error} t={t} onRetry={() => void reload()} /> : undefined}
        empty={data ? <Empty>{empty}</Empty> : undefined}
        paging={{
          page,
          pageSize,
          total: data?.page?.total ?? items.length,
          onPageChange: onPage,
          onPageSizeChange: onPageSize,
          labels: paginationLabels(t, title),
        }}
      />
    </Section>
  );
}
