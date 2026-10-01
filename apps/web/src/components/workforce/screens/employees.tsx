'use client';

import type {
  BranchSummary,
  EmployeeDirectoryEntry,
  EmployeeDirectoryGroup,
  EmployeeDirectoryResponse,
  EmployeeStatus,
} from '@lucy-spa/contracts';
import {
  DataTable,
  FacetedFilter,
  ListSection,
  ListToolbar,
  MultiValue,
  RowActions,
  SearchInput,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { canOfferCreate, directoryTitle } from '../../../lib/workforce/employee-create';
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
import { Badge, Button, Empty, ErrorState, PageHeader, useResource, type Tone } from '../ui';

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
  const { api, t, base, navigate } = useWorkforce();
  const { account } = useAccount();
  const branches = useBranches(api);
  const offerCreate = canOfferCreate(account);
  const [list, updateList] = useUrlState(EMPLOYEE_LIST_DEFAULTS, {
    normalize: normalizeEmployeeList,
    resetOnChange: EMPLOYEE_PAGE_KEYS,
  });
  // Bumped by the toolbar reload so every group reloads.
  const [refresh, setRefresh] = useState(0);
  const filters: DirectoryFilters = { q: list.q, branchId: list.branch, status: list.status };

  const branchList = [...(branches.data?.values() ?? [])];
  const activeFilters = (list.q ? 1 : 0) + (list.branch ? 1 : 0) + (list.status ? 1 : 0);

  return (
    <>
      <PageHeader title={t.employees.title}>
        {offerCreate ? (
          <Button variant="primary" icon="plus" onClick={() => navigate?.(`${base}/employees/new`)}>
            {t.employees.add}
          </Button>
        ) : null}
      </PageHeader>
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={activeFilters}
        onReset={() => updateList({ q: '', branch: '', status: '' })}
        reload={{ label: t.common.reload, onClick: () => setRefresh((value) => value + 1) }}
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
            <FacetedFilter
              label={t.employees.branchFilter}
              clearLabel={t.common.list.clearChoice}
              options={branchList.map((branch) => ({ value: branch.id, label: branch.name }))}
              selected={list.branch ? [list.branch] : []}
              onChange={([branch]) => updateList({ branch: branch ?? '' })}
            />
            <FacetedFilter
              label={t.employees.statusFilter}
              clearLabel={t.common.list.clearChoice}
              options={STATUSES.map((status) => ({
                value: status,
                label: t.employees.statuses[status],
              }))}
              selected={list.status ? [list.status] : []}
              onChange={([status]) => updateList({ status: status ?? '' })}
            />
          </>
        }
      />
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
  const { t, base, locale, navigate } = useWorkforce();
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
      truncate: true,
      width: 'md',
      cell: (employee) => (
        <Link
          className="ls-link"
          href={`${base}/employees/${employee.id}`}
          title={employee.fullName}
        >
          {employee.fullName}
        </Link>
      ),
    },
    {
      key: 'branch',
      header: t.common.branch,
      hideBelow: 'xl',
      cell: (employee) => (
        <MultiValue
          values={employee.branchIds.map((id) =>
            branchLabel(id, branches as Map<string, BranchSummary> | null, t),
          )}
          moreLabel={t.common.list.showAllValues}
          listLabel={t.common.branch}
        />
      ),
    },
    {
      key: 'title',
      header: t.employees.titleColumn,
      hideBelow: 'xl',
      truncate: true,
      width: 'sm',
      cell: (employee) => directoryTitle(employee, t, locale),
    },
    ...(showLevel
      ? [
          {
            key: 'level',
            header: text.level,
            hideBelow: 'xl' as const,
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
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: employee.fullName })}
          items={[
            {
              id: 'view',
              label: t.common.details,
              icon: 'eye',
              onSelect: () => navigate?.(`${base}/employees/${employee.id}`),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <ListSection title={title}>
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
    </ListSection>
  );
}
