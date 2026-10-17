'use client';

import type {
  WebsitePageListResponse,
  WebsitePageResponse,
  WebsitePageSummary,
} from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  RowActions,
  type DataTableColumn,
  type MenuLinkComponent,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { formatVnInstant } from '../../../lib/workforce/discounts';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { useUrlPage } from '../../../lib/workforce/use-url-paging';
import { pagePublicPath, pageTone, roleHolderId } from '../../../lib/workforce/pages';
import { confirmError } from '../../../lib/workforce/form-labels';
import { errorMessage, runMutation } from '../../../lib/workforce/workflows';
import { PrefetchLink as Link } from '../link';
import { useWorkforce } from '../session';
import { Badge, Empty, ErrorState, Notice, useResource, useSuccessToast } from '../ui';

const PAGE_SIZE = 20;

/**
 * The row menu's links: a staff page moves client-side (router link); the public page opens in a new tab (wig: a real link, so
 * Ctrl/Cmd/middle-click work, instead of `window.open` from a menu item). The label says it opens a new tab.
 */
const PagesMenuLink: MenuLinkComponent = ({ href, ...props }) =>
  href.includes('/workforce/') ? (
    <Link href={href} {...props} />
  ) : (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props} />
  );

/**
 * The "Trang thông tin" tab of the website content page (session 7b): every page with its type and status, and the row menu (edit,
 * view on the website, publish or unpublish). Create and edit are their own pages because the text is long and has a preview.
 */
export function PagesPanel() {
  const { api, t, locale, base } = useWorkforce();
  const notify = useSuccessToast();
  const pages = useResource(() => api.get<WebsitePageListResponse>('/api/v1/website/pages'), [api]);
  // The page number lives in the address bar (Back/Forward and a shared link keep it); `pp` cannot clash with the media page's keys.
  const [page, setPage] = useUrlPage('pp');
  const [unpublishing, setUnpublishing] = useState<WebsitePageSummary | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const items = pages.data?.items ?? [];
  const nameOf = (row: WebsitePageSummary) =>
    locale === 'en' ? (row.titleEn ?? row.titleVi) : row.titleVi;

  /** A refused publish names the page that holds the terms or privacy role, which the loaded list knows. */
  function refusal(error: unknown, row: WebsitePageSummary): string {
    const holder = roleHolderId(error);
    if (holder === null) return errorMessage(error, t);
    const named = items.find((other) => other.id === holder);
    return named
      ? fill(t.pages.roleTaken, { name: nameOf(named), role: t.pages.role[row.role] })
      : t.pages.roleTakenUnknown;
  }

  async function toggle(row: WebsitePageSummary) {
    setProblem(null);
    const outcome = await runMutation(
      () =>
        api.post<WebsitePageResponse>(`/api/v1/website/pages/${row.id}/publish`, {
          expectedVersion: row.version,
          isPublished: !row.isPublished,
        }),
      () => pages.reload(),
    );
    if (outcome.ok) {
      await pages.reload();
      notify(row.isPublished ? t.pages.unpublished : t.pages.published);
    } else {
      setProblem(refusal(outcome.error, row));
    }
  }

  const columns: DataTableColumn<WebsitePageSummary>[] = [
    {
      key: 'page',
      header: t.pages.columns.page,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      cell: (row) => (
        <Link className="ls-link" href={`${base}/website/pages/${row.id}`}>
          {nameOf(row)}
        </Link>
      ),
    },
    {
      key: 'address',
      header: t.pages.columns.address,
      hideBelow: 'lg',
      wrap: true,
      width: 'md',
      cell: (row) => pagePublicPath(locale, row.slug),
    },
    {
      key: 'role',
      header: t.pages.columns.role,
      cell: (row) => t.pages.role[row.role],
    },
    {
      key: 'status',
      header: t.pages.columns.status,
      cell: (row) => (
        <Badge tone={pageTone(row.isPublished)}>
          {row.isPublished ? t.pages.status.PUBLISHED : t.pages.status.DRAFT}
        </Badge>
      ),
    },
    {
      key: 'updated',
      header: t.pages.columns.updated,
      hideBelow: 'lg',
      cell: (row) => formatVnInstant(row.updatedAt, locale),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => (
        <RowActions
          menuLabel={fill(t.pages.actionsFor, { name: nameOf(row) })}
          LinkComponent={PagesMenuLink}
          items={[
            {
              id: 'edit',
              label: t.pages.edit,
              icon: 'edit',
              href: `${base}/website/pages/${row.id}`,
            },
            ...(row.isPublished
              ? [{ id: 'view', label: t.pages.view, href: pagePublicPath(locale, row.slug) }]
              : []),
            {
              id: 'toggle',
              label: row.isPublished ? t.pages.unpublish : t.pages.publish,
              // Taking a live page off the website asks first; publishing a draft does not.
              onSelect: () => (row.isPublished ? setUnpublishing(row) : void toggle(row)),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      <DataTable
        drillDown
        mode="client"
        caption={fill(t.common.list.table, { list: t.pages.listLabel })}
        columns={columns}
        rows={items}
        rowKey={(row) => row.id}
        loading={pages.loading}
        loadingLabel={t.common.loading}
        error={
          pages.error ? (
            <ErrorState error={pages.error} t={t} onRetry={() => void pages.reload()} />
          ) : undefined
        }
        empty={pages.data ? <Empty>{t.pages.empty}</Empty> : undefined}
        paging={{
          page,
          pageSize: PAGE_SIZE,
          onPageChange: setPage,
          labels: paginationLabels(t, t.pages.listLabel),
        }}
      />
      {unpublishing ? (
        <ConfirmDialog
          title={t.pages.unpublishConfirm.title}
          description={fill(t.pages.unpublishConfirm.body, { name: nameOf(unpublishing) })}
          tone="warning"
          confirmLabel={t.pages.unpublish}
          busyLabel={t.pages.unpublishConfirm.busy}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          describeError={confirmError(t)}
          onCancel={() => setUnpublishing(null)}
          onConfirm={async () => {
            const target = unpublishing;
            setUnpublishing(null);
            await toggle(target);
          }}
        />
      ) : null}
    </>
  );
}
