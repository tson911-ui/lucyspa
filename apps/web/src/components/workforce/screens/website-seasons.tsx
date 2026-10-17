'use client';

import type { WebsiteSeasonListResponse, WebsiteSeasonResponse } from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  FacetedFilter,
  ListToolbar,
  RowActions,
  scheduleLayout,
  ScheduleStrip,
  useUrlState,
  type DataTableColumn,
  type MenuLinkComponent,
  type ScheduleItem,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { formatVnInstant } from '../../../lib/workforce/discounts';
import { confirmError } from '../../../lib/workforce/form-labels';
import {
  normalizePage,
  paginationLabels,
  resultsText,
  toolbarLabels,
} from '../../../lib/workforce/list-view';
import {
  filterSeasons,
  presetName,
  SEASON_PAGE_SIZE,
  SEASON_STATUSES,
  seasonOverlapId,
  seasonTone,
  seasonWindowText,
  seasonYears,
} from '../../../lib/workforce/seasons';
import { errorMessage, runMutation } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Badge, Empty, ErrorState, Notice, useResource, useSuccessToast } from '../ui';

const stripTone = (status: WebsiteSeasonResponse['status']): ScheduleItem['tone'] =>
  status === 'ACTIVE' ? 'success' : status === 'SCHEDULED' ? 'info' : 'neutral';

/**
 * The seasons tab of the website content page (design 20.7): every season with its derived status, a one-lane
 * schedule strip of the enabled ones, status and year filters, and the row menu (edit, enable or disable,
 * delete). Create and edit are their own pages because the form is long and carries a live preview.
 */
/** The row menu's "Sửa" is a router link (Ctrl/Cmd/middle-click work, wig: links use <a>). */
const RouterMenuLink: MenuLinkComponent = (props) => <Link {...props} />;

/**
 * Page, status and year of the seasons tab live in the address bar (Back/Forward and a shared link keep them); short keys that do
 * not clash with the media page's `q`, `page`, `tab`. A filter change returns to page 1.
 */
const SEASON_LIST_DEFAULTS = { sp: 1, sst: '', sy: '' };
const SEASON_LIST_OPTIONS = {
  normalize: (state: typeof SEASON_LIST_DEFAULTS) => ({
    sp: normalizePage(state.sp),
    sst: state.sst.slice(0, 20),
    sy: /^\d{4}$/.test(state.sy) ? state.sy : '',
  }),
  resetOnChange: ['sp'] as readonly string[],
};

export function SeasonsPanel() {
  const { api, t, locale, base } = useWorkforce();
  const notify = useSuccessToast();
  const text = t.seasons;
  const seasons = useResource(
    () => api.get<WebsiteSeasonListResponse>('/api/v1/website/seasons'),
    [api],
  );
  const [list, updateList] = useUrlState(SEASON_LIST_DEFAULTS, SEASON_LIST_OPTIONS);
  const page = list.sp;
  const status = list.sst;
  const year = list.sy;
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<WebsiteSeasonResponse | null>(null);
  const all = seasons.data?.items ?? [];
  const rows = filterSeasons(all, { status, year });
  const years = seasonYears(all);
  const activeFilters = (status ? 1 : 0) + (year ? 1 : 0);

  /** The message of a refused toggle: an overlap names the other season, which the loaded list knows. */
  function refusal(error: unknown): string {
    const other = seasonOverlapId(error);
    const named = other ? all.find((season) => season.id === other) : undefined;
    return named ? fill(text.overlap, { name: named.label }) : errorMessage(error, t);
  }

  async function toggle(season: WebsiteSeasonResponse) {
    setProblem(null);
    const outcome = await runMutation(
      () =>
        api.post<WebsiteSeasonResponse>(`/api/v1/website/seasons/${season.id}/enabled`, {
          expectedVersion: season.rowVersion,
          isEnabled: !season.isEnabled,
        }),
      () => seasons.reload(),
    );
    if (outcome.ok) {
      await seasons.reload();
      notify(season.isEnabled ? text.disabled : text.enabled);
    } else {
      setProblem(refusal(outcome.error));
    }
  }

  const effects = (season: WebsiteSeasonResponse) => {
    const parts = [
      season.applyCustomer ? text.effects.customer : null,
      season.applyAdmin ? text.effects.admin : null,
      season.applyCustomer && season.particlesEnabled ? text.effects.particles : null,
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(', ') : text.effects.none;
  };

  const columns: DataTableColumn<WebsiteSeasonResponse>[] = [
    {
      key: 'season',
      header: text.columns.season,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      cell: (season) => (
        <Link className="ls-link" href={`${base}/website/seasons/${season.id}`}>
          {season.label}
        </Link>
      ),
    },
    {
      key: 'preset',
      header: text.form.presetLabel,
      hideBelow: 'lg',
      wrap: true,
      width: 'md',
      cell: (season) => presetName(season.presetKey, locale),
    },
    {
      key: 'status',
      header: text.columns.status,
      cell: (season) => (
        <Badge tone={seasonTone(season.status)}>{text.status[season.status]}</Badge>
      ),
    },
    {
      key: 'window',
      header: text.columns.window,
      cell: (season) => seasonWindowText(season, locale),
    },
    {
      key: 'effects',
      header: text.columns.effects,
      hideBelow: 'lg',
      wrap: true,
      width: 'md',
      cell: effects,
    },
    {
      key: 'content',
      header: text.columns.content,
      hideBelow: 'lg',
      cell: (season) =>
        season.popupIds.length + season.slideIds.length === 0
          ? text.noContent
          : fill(text.content, { popups: season.popupIds.length, slides: season.slideIds.length }),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (season) => (
        <RowActions
          menuLabel={fill(text.actionsFor, { name: season.label })}
          LinkComponent={RouterMenuLink}
          items={[
            {
              id: 'edit',
              label: text.edit,
              icon: 'edit',
              href: `${base}/website/seasons/${season.id}`,
            },
            {
              id: 'toggle',
              label: season.isEnabled ? text.disable : text.enable,
              onSelect: () => void toggle(season),
            },
            {
              id: 'delete',
              label: text.remove.confirm,
              icon: 'trash',
              tone: 'danger',
              onSelect: () => {
                setProblem(null);
                setRemoving(season);
              },
            },
          ]}
        />
      ),
    },
  ];

  const enabled = all.filter((season) => season.isEnabled);
  const now = seasons.data ? Date.parse(seasons.data.now) : Date.now();
  const strip: ScheduleItem[] = enabled.map((season) => ({
    id: season.id,
    start: Date.parse(season.startsAt),
    end: Date.parse(season.endsAt),
    tone: stripTone(season.status),
    label: `${season.label} (${text.status[season.status]})`,
  }));
  const range = scheduleLayout(strip, now);

  return (
    <>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {seasons.data && strip.length > 0 ? (
        <ScheduleStrip
          caption={text.strip.label}
          items={strip}
          now={now}
          startLabel={formatVnInstant(new Date(range.min).toISOString(), locale)}
          endLabel={formatVnInstant(new Date(range.max).toISOString(), locale)}
          nowLabel={text.strip.now}
        />
      ) : null}
      {seasons.data && all.length > 0 ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={activeFilters}
          resultCount={resultsText(t, rows.length)}
          onReset={() => updateList({ sst: '', sy: '' })}
          reload={{ label: t.common.reload, onClick: () => void seasons.reload() }}
          filters={
            <>
              <FacetedFilter
                label={t.common.status}
                clearLabel={t.common.list.clearChoice}
                options={SEASON_STATUSES.map((value) => ({
                  value,
                  label: text.status[value],
                }))}
                selected={status ? [status] : []}
                onChange={([value]) => updateList({ sst: value ?? '' })}
              />
              <FacetedFilter
                label={text.filterYear}
                clearLabel={t.common.list.clearChoice}
                options={years.map((value) => ({ value: String(value), label: String(value) }))}
                selected={year ? [year] : []}
                onChange={([value]) => updateList({ sy: value ?? '' })}
              />
            </>
          }
        />
      ) : null}
      <DataTable
        drillDown
        mode="client"
        caption={fill(t.common.list.table, { list: text.listLabel })}
        columns={columns}
        rows={rows}
        rowKey={(season) => season.id}
        loading={seasons.loading && !seasons.data}
        loadingLabel={t.common.loading}
        error={
          seasons.error ? (
            <ErrorState error={seasons.error} t={t} onRetry={() => void seasons.reload()} />
          ) : undefined
        }
        empty={seasons.data ? <Empty>{text.empty}</Empty> : undefined}
        paging={{
          page,
          pageSize: SEASON_PAGE_SIZE,
          onPageChange: (next) => updateList({ sp: next }),
          labels: paginationLabels(t, text.listLabel),
        }}
      />
      {removing ? (
        <ConfirmDialog
          title={text.remove.title}
          description={[
            removing.status === 'ACTIVE' ? text.remove.live : null,
            removing.popupIds.length + removing.slideIds.length > 0
              ? fill(text.remove.items, {
                  popups: removing.popupIds.length,
                  slides: removing.slideIds.length,
                })
              : null,
            text.remove.body,
          ]
            .filter((line): line is string => line !== null)
            .join(' ')}
          facts={[{ label: text.remove.fact, value: removing.label }]}
          tone="danger"
          confirmLabel={text.remove.confirm}
          busyLabel={text.remove.busy}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          describeError={confirmError(t)}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const target = removing;
            const outcome = await runMutation(
              () => api.post(`/api/v1/website/seasons/${target.id}/delete`, {}),
              () => seasons.reload(),
            );
            if (!outcome.ok) throw outcome.error;
            await seasons.reload();
            setRemoving(null);
            notify(text.remove.deleted);
          }}
        />
      ) : null}
    </>
  );
}
