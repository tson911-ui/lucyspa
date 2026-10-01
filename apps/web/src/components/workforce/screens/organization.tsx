'use client';

import type {
  OrganizationAppointment,
  OrganizationAppointmentsResponse,
  OrganizationArea,
  OrganizationBranch,
  OrganizationRegion,
  OrganizationSnapshotResponse,
} from '@lucy-spa/contracts';
import {
  DataTable,
  FacetedFilter,
  ListToolbar,
  RowActions,
  SearchInput,
  Tabs,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState, type ReactNode } from 'react';
import { fill } from '../../../i18n/workforce';
import { organizationDictionary } from '../../../i18n/organization';
import {
  paginationLabels,
  resultsText,
  sortLabels,
  toolbarLabels,
} from '../../../lib/workforce/list-view';
import {
  filterAppointments,
  filterAreas,
  filterBranches,
  filterRegions,
  formatScope,
  ORG_LEVELS,
  ORG_LIST_DEFAULTS,
  ORG_PAGE_KEYS,
  ORG_TAB_RESET,
  normalizeOrgList,
  regionName,
  type OrgTab,
} from '../../../lib/workforce/organization-list';
import { canAnywhere } from '../../../lib/workforce/permissions';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Notice,
  PageHeader,
  useResource,
  useSuccessToast,
} from '../ui';
import {
  AppointmentCreate,
  AppointmentEnd,
  AreaCreate,
  AreaEdit,
  BranchPlacement,
  OrgStatusConfirm,
  RegionCreate,
  RegionRename,
} from './organization-dialogs';

type Overlay =
  | { kind: 'createRegion' }
  | { kind: 'renameRegion'; region: OrganizationRegion }
  | { kind: 'regionStatus'; region: OrganizationRegion }
  | { kind: 'createArea' }
  | { kind: 'editArea'; area: OrganizationArea }
  | { kind: 'areaStatus'; area: OrganizationArea }
  | { kind: 'placement'; branch: OrganizationBranch }
  | { kind: 'appoint' }
  | { kind: 'endAppointment'; item: OrganizationAppointment };

/**
 * Organization hierarchy: regions, areas, branch placement and management appointments in four
 * tabs. The API returns everything, so search, the one filter of each tab and paging run in the
 * browser (`DataTable` client mode); their state lives in the address bar. Every change is a
 * dialog (short forms) opened from the page header or the row `⋮` menu.
 */
export function OrganizationScreen() {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const text = organizationDictionary(locale);
  const notify = useSuccessToast();

  const manageOrg = canAnywhere(account, 'MANAGE_ORGANIZATION');
  const manageAppointments = canAnywhere(account, 'MANAGE_ORG_ASSIGNMENTS');
  const allowed = canAnywhere(account, 'VIEW_ORGANIZATION') || manageOrg || manageAppointments;

  const snapshot = useResource(
    () =>
      allowed
        ? api.get<OrganizationSnapshotResponse>('/api/v1/organization')
        : Promise.resolve(null),
    [api, allowed],
  );
  const appointments = useResource(
    () =>
      allowed
        ? api.get<OrganizationAppointmentsResponse>('/api/v1/organization/appointments', {})
        : Promise.resolve(null),
    [api, allowed],
  );
  const [list, updateList] = useUrlState(ORG_LIST_DEFAULTS, {
    normalize: normalizeOrgList,
    resetOnChange: ORG_PAGE_KEYS,
  });
  const [overlay, setOverlay] = useState<Overlay | null>(null);

  if (!allowed) {
    return <Notice tone="warning">{text.noAccess}</Notice>;
  }

  /** After a successful save: refresh both resources, close the overlay and say what happened. */
  const finish = (message: string) => async () => {
    await Promise.all([snapshot.reload(), appointments.reload()]);
    setOverlay(null);
    notify(message);
  };
  const close = () => setOverlay(null);

  const tab = list.tab as OrgTab;
  const data = snapshot.data;
  const regions = data?.regions ?? [];
  const areas = data?.areas ?? [];
  const branches = data?.branches ?? [];
  const items = appointments.data?.items ?? [];

  const visibleRegions = filterRegions(regions, list);
  const visibleAreas = filterAreas(areas, regions, list);
  const visibleBranches = filterBranches(branches, areas, list);
  const visibleAppointments = data
    ? filterAppointments(items, data, text.levels, text.system, list)
    : [];

  const noActiveRegion = Boolean(data) && !regions.some((region) => region.isActive);

  function toolbar(
    searchLabel: string,
    total: number,
    shown: number,
    filter: { label: string; options: { value: string; label: string }[] } | null,
    reload: () => Promise<void>,
  ): ReactNode {
    if (total === 0) return null;
    return (
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={list.filter ? 1 : 0}
        resultCount={resultsText(t, shown)}
        onReset={() => updateList({ q: '', filter: '' })}
        reload={{ label: t.common.reload, onClick: () => void reload() }}
        search={
          <SearchInput
            id="org-q"
            value={list.q}
            label={searchLabel}
            placeholder={searchLabel}
            clearLabel={t.common.list.clearSearch}
            onSearch={(q) => updateList({ q }, { replace: true })}
          />
        }
        filters={
          filter ? (
            <FacetedFilter
              label={filter.label}
              clearLabel={t.common.list.clearChoice}
              options={filter.options}
              selected={list.filter ? [list.filter] : []}
              onChange={([value]) => updateList({ filter: value ?? '' })}
            />
          ) : undefined
        }
      />
    );
  }

  const statusFilter = {
    label: t.common.status,
    options: [
      { value: 'active', label: t.common.active },
      { value: 'inactive', label: t.common.inactive },
    ],
  };

  function table<Row>(
    name: string,
    columns: DataTableColumn<Row>[],
    rows: Row[],
    total: number,
    rowKey: (row: Row) => string,
    loading: boolean,
    error: unknown,
    reload: () => Promise<void>,
  ): ReactNode {
    return (
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: name })}
        columns={columns}
        rows={rows}
        rowKey={rowKey}
        defaultSort={
          columns.some((c) => c.key === 'code') ? { key: 'code', direction: 'asc' } : null
        }
        sortLabels={sortLabels(t)}
        loading={loading}
        loadingLabel={t.common.loading}
        error={error ? <ErrorState error={error} t={t} onRetry={() => void reload()} /> : undefined}
        empty={<Empty>{total === 0 ? text.noRows : text.noMatch}</Empty>}
        paging={{
          page: list.page,
          pageSize: list.pageSize,
          onPageChange: (page) => updateList({ page }),
          onPageSizeChange: (pageSize) => updateList({ pageSize }),
          labels: paginationLabels(t, name),
        }}
      />
    );
  }

  const statusBadge = (isActive: boolean) => (
    <Badge tone={isActive ? 'success' : 'neutral'}>
      {isActive ? t.common.active : text.inactive}
    </Badge>
  );

  const regionColumns: DataTableColumn<OrganizationRegion>[] = [
    {
      key: 'code',
      header: t.common.code,
      sortable: true,
      sortValue: (region) => region.code,
      cell: (region) => region.code,
    },
    {
      key: 'name',
      header: t.common.name,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      sortable: true,
      sortValue: (region) => region.name,
      cell: (region) => region.name,
    },
    {
      key: 'status',
      header: t.common.status,
      sortable: true,
      sortValue: (region) => (region.isActive ? 0 : 1),
      cell: (region) => statusBadge(region.isActive),
    },
    ...(manageOrg
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (region: OrganizationRegion) => (
              <RowActions
                menuLabel={fill(t.common.list.actionsFor, { name: region.name })}
                items={[
                  {
                    id: 'rename',
                    label: text.rename,
                    icon: 'edit',
                    onSelect: () => setOverlay({ kind: 'renameRegion', region }),
                  },
                  {
                    id: 'status',
                    label: region.isActive ? t.common.deactivate : t.common.activate,
                    tone: region.isActive ? 'danger' : 'default',
                    onSelect: () => setOverlay({ kind: 'regionStatus', region }),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  const areaColumns: DataTableColumn<OrganizationArea>[] = [
    {
      key: 'code',
      header: t.common.code,
      sortable: true,
      sortValue: (area) => area.code,
      cell: (area) => area.code,
    },
    {
      key: 'name',
      header: t.common.name,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      sortable: true,
      sortValue: (area) => area.name,
      cell: (area) => area.name,
    },
    {
      key: 'region',
      header: text.region,
      truncate: true,
      sortable: true,
      sortValue: (area) => regionName(regions, area.regionId),
      cell: (area) => regionName(regions, area.regionId),
    },
    {
      key: 'status',
      header: t.common.status,
      sortable: true,
      sortValue: (area) => (area.isActive ? 0 : 1),
      cell: (area) => statusBadge(area.isActive),
    },
    ...(manageOrg
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (area: OrganizationArea) => (
              <RowActions
                menuLabel={fill(t.common.list.actionsFor, { name: area.name })}
                items={[
                  {
                    id: 'edit',
                    label: t.common.edit,
                    icon: 'edit',
                    onSelect: () => setOverlay({ kind: 'editArea', area }),
                  },
                  {
                    id: 'status',
                    label: area.isActive ? t.common.deactivate : t.common.activate,
                    tone: area.isActive ? 'danger' : 'default',
                    onSelect: () => setOverlay({ kind: 'areaStatus', area }),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  const areaName = (branch: OrganizationBranch) =>
    areas.find((area) => area.id === branch.areaId)?.name ?? '';
  const branchColumns: DataTableColumn<OrganizationBranch>[] = [
    {
      key: 'code',
      header: t.common.code,
      sortable: true,
      sortValue: (branch) => branch.code,
      cell: (branch) => branch.code,
    },
    {
      key: 'name',
      header: t.common.name,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      sortable: true,
      sortValue: (branch) => branch.name,
      cell: (branch) => branch.name,
    },
    {
      key: 'area',
      header: text.area,
      truncate: true,
      sortable: true,
      sortValue: (branch) => areaName(branch),
      cell: (branch) => areaName(branch) || <span className="ls-hint">{text.unplaced}</span>,
    },
    ...(manageOrg
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (branch: OrganizationBranch) => (
              <RowActions
                menuLabel={fill(t.common.list.actionsFor, { name: branch.name })}
                items={[
                  {
                    id: 'placement',
                    label: text.placement,
                    icon: 'edit',
                    onSelect: () => setOverlay({ kind: 'placement', branch }),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  const appointmentColumns: DataTableColumn<OrganizationAppointment>[] = [
    {
      key: 'employee',
      header: text.employee,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      sortable: true,
      sortValue: (item) => item.fullName,
      cell: (item) => item.fullName,
    },
    {
      key: 'level',
      header: text.level,
      sortable: true,
      sortValue: (item) => ORG_LEVELS.indexOf(item.level),
      cell: (item) => <Badge tone="info">{text.levels[item.level]}</Badge>,
    },
    {
      key: 'scope',
      header: t.roles.scope,
      truncate: true,
      sortable: true,
      sortValue: (item) => (data ? formatScope(item.scope, data, text.system) : ''),
      cell: (item) => (data ? formatScope(item.scope, data, text.system) : ''),
    },
    {
      key: 'from',
      header: t.common.from,
      sortable: true,
      sortValue: (item) => item.startedAt,
      cell: (item) => item.startedAt.slice(0, 10),
    },
    ...(manageAppointments
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (item: OrganizationAppointment) =>
              // A team leader's appointment follows the team, so it is ended from the team.
              item.teamId ? (
                <span className="ls-hint">{text.teams}</span>
              ) : (
                <RowActions
                  menuLabel={fill(t.common.list.actionsFor, { name: item.fullName })}
                  items={[
                    {
                      id: 'end',
                      label: text.end,
                      tone: 'danger',
                      onSelect: () => setOverlay({ kind: 'endAppointment', item }),
                    },
                  ]}
                />
              ),
          },
        ]
      : []),
  ];

  const reloadSnapshot = () => snapshot.reload();
  const reloadAppointments = () => appointments.reload();

  const regionsPanel = (
    <>
      {toolbar(text.searchOrg, regions.length, visibleRegions.length, statusFilter, reloadSnapshot)}
      {table(
        text.regions,
        regionColumns,
        visibleRegions,
        regions.length,
        (region) => region.id,
        snapshot.loading,
        snapshot.error,
        reloadSnapshot,
      )}
    </>
  );
  const areasPanel = (
    <>
      {manageOrg && noActiveRegion ? <Notice tone="info">{text.needRegion}</Notice> : null}
      {toolbar(text.searchAreas, areas.length, visibleAreas.length, statusFilter, reloadSnapshot)}
      {table(
        text.areas,
        areaColumns,
        visibleAreas,
        areas.length,
        (area) => area.id,
        snapshot.loading,
        snapshot.error,
        reloadSnapshot,
      )}
    </>
  );
  const branchesPanel = (
    <>
      {toolbar(
        text.searchBranches,
        branches.length,
        visibleBranches.length,
        {
          label: text.placementFilter,
          options: [
            { value: 'placed', label: text.placed },
            { value: 'unplaced', label: text.unplaced },
          ],
        },
        reloadSnapshot,
      )}
      {table(
        text.branches,
        branchColumns,
        visibleBranches,
        branches.length,
        (branch) => branch.id,
        snapshot.loading,
        snapshot.error,
        reloadSnapshot,
      )}
    </>
  );
  const appointmentsPanel = (
    <>
      {toolbar(
        text.searchAppointments,
        items.length,
        visibleAppointments.length,
        {
          label: text.level,
          options: ORG_LEVELS.map((level) => ({ value: level, label: text.levels[level] })),
        },
        reloadAppointments,
      )}
      {table(
        text.appointments,
        appointmentColumns,
        visibleAppointments,
        items.length,
        (item) => item.id,
        appointments.loading || snapshot.loading,
        appointments.error ?? snapshot.error,
        reloadAppointments,
      )}
    </>
  );

  const headerAction =
    tab === 'regions' && manageOrg ? (
      <Button variant="primary" icon="plus" onClick={() => setOverlay({ kind: 'createRegion' })}>
        {text.createRegion}
      </Button>
    ) : tab === 'areas' && manageOrg && !noActiveRegion ? (
      <Button variant="primary" icon="plus" onClick={() => setOverlay({ kind: 'createArea' })}>
        {text.createArea}
      </Button>
    ) : tab === 'appointments' && manageAppointments ? (
      <Button variant="primary" icon="plus" onClick={() => setOverlay({ kind: 'appoint' })}>
        {text.appoint}
      </Button>
    ) : null;

  return (
    <>
      <PageHeader title={text.title}>{headerAction}</PageHeader>
      <Notice tone="info">{`${text.ownerNote} ${text.attendanceNote}`}</Notice>
      <Tabs
        label={text.title}
        value={tab}
        onChange={(next) => updateList({ tab: next, ...ORG_TAB_RESET })}
        tabs={[
          { id: 'regions', label: `${text.regions} (${regions.length})`, panel: regionsPanel },
          { id: 'areas', label: `${text.areas} (${areas.length})`, panel: areasPanel },
          { id: 'branches', label: `${text.branches} (${branches.length})`, panel: branchesPanel },
          {
            id: 'appointments',
            label: `${text.appointments} (${items.length})`,
            panel: appointmentsPanel,
          },
        ]}
      />
      {overlay?.kind === 'createRegion' ? (
        <RegionCreate onClose={close} onSaved={finish(text.regionCreated)} />
      ) : null}
      {overlay?.kind === 'renameRegion' ? (
        <RegionRename
          key={overlay.region.id}
          region={overlay.region}
          onClose={close}
          onSaved={finish(text.saved)}
        />
      ) : null}
      {overlay?.kind === 'regionStatus' ? (
        <OrgStatusConfirm
          key={overlay.region.id}
          kind="region"
          record={overlay.region}
          onClose={close}
          onChanged={finish(text.saved)}
        />
      ) : null}
      {overlay?.kind === 'createArea' ? (
        <AreaCreate regions={regions} onClose={close} onSaved={finish(text.areaCreated)} />
      ) : null}
      {overlay?.kind === 'editArea' ? (
        <AreaEdit
          key={overlay.area.id}
          area={overlay.area}
          regions={regions}
          onClose={close}
          onSaved={finish(text.saved)}
        />
      ) : null}
      {overlay?.kind === 'areaStatus' ? (
        <OrgStatusConfirm
          key={overlay.area.id}
          kind="area"
          record={overlay.area}
          onClose={close}
          onChanged={finish(text.saved)}
        />
      ) : null}
      {overlay?.kind === 'placement' ? (
        <BranchPlacement
          key={overlay.branch.id}
          branch={overlay.branch}
          areas={areas}
          onClose={close}
          onSaved={finish(text.saved)}
        />
      ) : null}
      {overlay?.kind === 'appoint' && data ? (
        <AppointmentCreate snapshot={data} onClose={close} onSaved={finish(text.appointed)} />
      ) : null}
      {overlay?.kind === 'endAppointment' && data ? (
        <AppointmentEnd
          key={overlay.item.id}
          item={overlay.item}
          snapshot={data}
          onClose={close}
          onChanged={finish(text.ended)}
        />
      ) : null}
    </>
  );
}
