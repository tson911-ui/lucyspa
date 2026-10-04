'use client';

import type { WebsitePopupListResponse, WebsitePopupResponse } from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  RowActions,
  scheduleLayout,
  ScheduleStrip,
  type ScheduleItem,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { formatVnInstant } from '../../../lib/workforce/discounts';
import { confirmError } from '../../../lib/workforce/form-labels';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { overlapId, popupName, popupTone } from '../../../lib/workforce/popups';
import { errorMessage, runMutation } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Badge, Empty, ErrorState, Notice, useResource, useSuccessToast } from '../ui';

const PAGE_SIZE = 20;

const stripTone = (status: WebsitePopupResponse['status']): ScheduleItem['tone'] =>
  status === 'ACTIVE' ? 'success' : status === 'SCHEDULED' ? 'info' : 'neutral';

/**
 * The popup tab of the website content page (design 16.5): every popup with its derived status, a one-lane
 * schedule strip of the enabled ones, and the row menu (edit, enable or disable, delete). Create and edit are
 * their own pages because the form is long and carries a live preview.
 */
export function PopupsPanel() {
  const { api, t, locale, base, navigate } = useWorkforce();
  const notify = useSuccessToast();
  const popups = useResource(
    () => api.get<WebsitePopupListResponse>('/api/v1/website/popups'),
    [api],
  );
  const [page, setPage] = useState(1);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<WebsitePopupResponse | null>(null);
  const items = popups.data?.items ?? [];
  const nameOf = (popup: WebsitePopupResponse) => popupName(popup, locale, t.popups.untitled);

  /** The message of a refused toggle: an overlap names the other popup, which the loaded list knows. */
  function refusal(error: unknown): string {
    const other = overlapId(error);
    const named = other ? items.find((popup) => popup.id === other) : undefined;
    return named ? fill(t.popups.overlap, { name: nameOf(named) }) : errorMessage(error, t);
  }

  async function toggle(popup: WebsitePopupResponse) {
    setProblem(null);
    const outcome = await runMutation(
      () =>
        api.post<WebsitePopupResponse>(`/api/v1/website/popups/${popup.id}/enabled`, {
          expectedVersion: popup.rowVersion,
          isEnabled: !popup.isEnabled,
        }),
      () => popups.reload(),
    );
    if (outcome.ok) {
      await popups.reload();
      notify(popup.isEnabled ? t.popups.disabled : t.popups.enabled);
    } else {
      setProblem(refusal(outcome.error));
    }
  }

  const columns: DataTableColumn<WebsitePopupResponse>[] = [
    {
      key: 'popup',
      header: t.popups.columns.popup,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (popup) => (
        <Link className="ls-link" href={`${base}/website/popups/${popup.id}`}>
          {nameOf(popup)}
        </Link>
      ),
    },
    {
      key: 'status',
      header: t.popups.columns.status,
      cell: (popup) => (
        <Badge tone={popupTone(popup.status)}>{t.popups.status[popup.status]}</Badge>
      ),
    },
    {
      key: 'window',
      header: t.popups.columns.window,
      cell: (popup) =>
        `${formatVnInstant(popup.startsAt, locale)} – ${formatVnInstant(popup.endsAt, locale)}`,
    },
    {
      key: 'image',
      header: t.popups.columns.image,
      hideBelow: 'lg',
      truncate: true,
      width: 'md',
      cell: (popup) => popup.media?.filename ?? t.popups.noImage,
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (popup) => (
        <RowActions
          menuLabel={fill(t.popups.actionsFor, { name: nameOf(popup) })}
          items={[
            {
              id: 'edit',
              label: t.popups.edit,
              icon: 'edit',
              onSelect: () => navigate?.(`${base}/website/popups/${popup.id}`),
            },
            {
              id: 'toggle',
              label: popup.isEnabled ? t.popups.disable : t.popups.enable,
              onSelect: () => void toggle(popup),
            },
            {
              id: 'delete',
              label: t.popups.remove.confirm,
              icon: 'trash',
              tone: 'danger',
              onSelect: () => {
                setProblem(null);
                setRemoving(popup);
              },
            },
          ]}
        />
      ),
    },
  ];

  const enabled = items.filter((popup) => popup.isEnabled);
  const now = popups.data ? Date.parse(popups.data.now) : Date.now();
  const strip: ScheduleItem[] = enabled.map((popup) => ({
    id: popup.id,
    start: Date.parse(popup.startsAt),
    end: Date.parse(popup.endsAt),
    tone: stripTone(popup.status),
    label: `${nameOf(popup)} · ${t.popups.status[popup.status]}`,
  }));
  const range = scheduleLayout(strip, now);

  return (
    <>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {popups.data && strip.length > 0 ? (
        <ScheduleStrip
          caption={t.popups.strip.label}
          items={strip}
          now={now}
          startLabel={formatVnInstant(new Date(range.min).toISOString(), locale)}
          endLabel={formatVnInstant(new Date(range.max).toISOString(), locale)}
          nowLabel={t.popups.strip.now}
        />
      ) : null}
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: t.popups.listLabel })}
        columns={columns}
        rows={items}
        rowKey={(popup) => popup.id}
        loading={popups.loading}
        loadingLabel={t.common.loading}
        error={
          popups.error ? (
            <ErrorState error={popups.error} t={t} onRetry={() => void popups.reload()} />
          ) : undefined
        }
        empty={popups.data ? <Empty>{t.popups.empty}</Empty> : undefined}
        paging={{
          page,
          pageSize: PAGE_SIZE,
          onPageChange: setPage,
          labels: paginationLabels(t, t.popups.listLabel),
        }}
      />
      {removing ? (
        <ConfirmDialog
          title={t.popups.remove.title}
          description={
            removing.status === 'ACTIVE'
              ? `${t.popups.remove.live} ${t.popups.remove.body}`
              : t.popups.remove.body
          }
          facts={[{ label: t.popups.remove.fact, value: nameOf(removing) }]}
          tone="danger"
          confirmLabel={t.popups.remove.confirm}
          busyLabel={t.common.saving}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          describeError={confirmError(t)}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const target = removing;
            const outcome = await runMutation(
              () => api.post(`/api/v1/website/popups/${target.id}/delete`, {}),
              () => popups.reload(),
            );
            if (!outcome.ok) throw outcome.error;
            await popups.reload();
            setRemoving(null);
            notify(t.popups.remove.deleted);
          }}
        />
      ) : null}
    </>
  );
}
