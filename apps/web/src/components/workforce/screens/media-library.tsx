'use client';

import type {
  MediaAssetDetail,
  MediaAssetSummary,
  MediaListResponse,
  MediaUsage,
} from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  type DataTableColumn,
  DescriptionList,
  Dialog,
  FileDropzone,
  Field,
  FormDrawer,
  FormGrid,
  IconButton,
  ListToolbar,
  MediaGrid,
  MediaPreview,
  MediaTile,
  Pagination,
  ProgressBar,
  RowActions,
  SearchInput,
  Spinner,
  Tabs,
  TextInput,
  useUrlState,
} from '@lucy-spa/ui';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { fill, type WorkforceDictionary } from '../../../i18n/workforce';
import { formatDateTime } from '../../../lib/workforce/format';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import {
  MEDIA_ALT_MAX,
  MEDIA_LIST_DEFAULTS,
  MEDIA_PAGE_KEYS,
  MEDIA_PAGE_SIZE,
  MEDIA_TYPES,
  mediaMeta,
  mediaVariantUrl,
  missingAlt,
  normalizeMediaList,
  PrecheckError,
  trimmedAlt,
  uploadMedia,
  uploadReducer,
  type UploadItem,
} from '../../../lib/workforce/media';
import { UploadQueue } from '../../../lib/workforce/media-upload';
import { canGlobal } from '../../../lib/workforce/permissions';
import { errorMessage, runMutation } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  PageHeader,
  Notice,
  useResource,
  useSubmit,
  useSuccessToast,
} from '../ui';
import { PopupsPanel } from './website-popups';
import { SeasonsPanel } from './website-seasons';
import { ShopInfoPanel } from './website-shop-info';
import { SlidesPanel, type SlideEditing } from './website-slides';

const QUEUE_PAGE_SIZE = 20;

const uploadTone = (status: UploadItem['status']) =>
  status === 'failed'
    ? 'error'
    : status === 'done'
      ? 'success'
      : status === 'duplicate'
        ? 'info'
        : 'neutral';

const WEBSITE_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const decimalSeparator = (locale: string) => (locale === 'vi' ? ',' : '.');

/** The message of one failed upload: a browser-side refusal or the API's typed code. */
function uploadErrorText(error: unknown, t: WorkforceDictionary): string {
  if (error instanceof PrecheckError) {
    return error.problem === 'type' ? t.errors.mediaType : t.errors.mediaTooLarge;
  }
  return errorMessage(error, t);
}

/**
 * Website content (design 16.7): the media library tab and the popup tab (the slider joins in Step 13).
 * The library (design 16.3) is paged by the API (24 per page, newest first) and searched by filename and
 * alt text, so the page, search and tab live in the address bar. Upload is multi-file (button, drop on the
 * empty state or anywhere on the library tab) with a progress queue that keeps running while the other tab
 * is open; each tile opens a detail drawer for the alt text, and its menu deletes an unused image.
 */
export function MediaLibraryScreen() {
  const { t } = useWorkforce();
  const { account } = useAccount();
  // GLOBAL_ONLY: a branch grant never opens it (the API decides again on every call).
  if (!canGlobal(account, 'MANAGE_WEBSITE_CONTENT')) {
    return (
      <>
        <PageHeader title={t.website.title} />
        <Empty>{t.media.noAccess}</Empty>
      </>
    );
  }
  return <MediaLibrary />;
}

function MediaLibrary() {
  const { api, t, locale, base, navigate } = useWorkforce();
  const notify = useSuccessToast();
  const [list, updateList] = useUrlState(MEDIA_LIST_DEFAULTS, {
    normalize: normalizeMediaList,
    resetOnChange: MEDIA_PAGE_KEYS,
  });
  // Files are only taken on the library tab: a drop on the popup or slider tab is not an upload.
  const onLibrary = useRef(list.tab === 'media');
  onLibrary.current = list.tab === 'media';
  // The slider tab's drawer (add or edit one slide); the add button is in the page header.
  const [slideEditing, setSlideEditing] = useState<SlideEditing>(null);
  const library = useResource(
    () => api.get<MediaListResponse>('/api/v1/website/media', { search: list.q, page: list.page }),
    [api, list.q, list.page],
  );
  type Overlay = { kind: 'detail'; id: string } | { kind: 'remove'; asset: MediaAssetSummary };
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [queue, dispatch] = useReducer(uploadReducer, []);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);

  // ---------------------------------------------------------------- upload queue
  // The rules (precheck, three at a time, cancel) live in `UploadQueue`; the latest callbacks are read
  // through a ref so the queue is created once per client.
  const latest = useRef({ reload: library.reload, page: list.page, updateList, notify, t });
  latest.current = { reload: library.reload, page: list.page, updateList, notify, t };
  const uploads = useMemo(
    () =>
      new UploadQueue<File>({
        upload: (file, control) => uploadMedia(api, file, control),
        emit: dispatch,
        onIdle: (count) => {
          const { reload, page, updateList: update, notify: say, t: text } = latest.current;
          if (page !== 1) update({ page: 1 });
          void reload().then(() => say(fill(text.media.uploaded, { count })));
        },
      }),
    [api],
  );
  useEffect(() => () => uploads.dispose(), [uploads]);
  const enqueue = (files: readonly File[]) => uploads.add(files);

  // Drop images anywhere on the page. The listeners live on the window (not on a wrapper element), so the
  // page keeps its own layout rhythm, and a file dropped outside the page is never opened by the browser.
  const enqueueRef = useRef(enqueue);
  enqueueRef.current = enqueue;
  useEffect(() => {
    const carriesFiles = (event: globalThis.DragEvent) =>
      event.dataTransfer?.types.includes('Files') ?? false;
    const over = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(onLibrary.current);
    };
    const leave = (event: globalThis.DragEvent) => {
      if (event.relatedTarget === null) setDragging(false);
    };
    const drop = (event: globalThis.DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDragging(false);
      // Never opened by the browser anywhere, but only the library tab takes it as an upload.
      if (onLibrary.current) enqueueRef.current(Array.from(event.dataTransfer?.files ?? []));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);
  const finished = queue.some((item) => item.status !== 'queued' && item.status !== 'uploading');

  const [queuePage, setQueuePage] = useState(1);
  const queueColumns: DataTableColumn<UploadItem>[] = [
    {
      key: 'name',
      header: t.media.detail.file,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (item) => item.name,
    },
    {
      key: 'status',
      header: t.common.status,
      cell: (item) =>
        item.status === 'uploading' ? (
          <ProgressBar
            label={fill(t.media.status.uploading, { name: item.name })}
            value={item.progress === null ? undefined : item.progress}
          />
        ) : (
          <span className="ls-cell-stack">
            <span className="ls-cell-main">
              <Badge tone={uploadTone(item.status)}>{t.media.status[item.status]}</Badge>
            </span>
            {item.status === 'failed' ? (
              <span className="ls-cell-sub" role="alert">
                {uploadErrorText(item.error, t)}
              </span>
            ) : null}
          </span>
        ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (item) => {
        const busy = item.status === 'queued' || item.status === 'uploading';
        return (
          <IconButton
            icon="close"
            label={fill(busy ? t.media.cancelUpload : t.media.dismiss, { name: item.name })}
            onClick={() =>
              busy ? uploads.cancel(item.key) : dispatch({ type: 'dismiss', key: item.key })
            }
          />
        );
      },
    },
  ];

  // ---------------------------------------------------------------- render
  const items = library.data?.items ?? [];
  const total = library.data?.total ?? 0;
  const searching = list.q !== '';
  const separator = decimalSeparator(locale);

  const onPopups = list.tab === 'popup';
  const onSlider = list.tab === 'slider';
  const onSeasons = list.tab === 'season';
  const onShop = list.tab === 'shop';
  const mediaPanel = (
    <>
      {dragging ? <Notice tone="info">{t.media.dropOverlay}</Notice> : null}
      {queue.length > 0 ? (
        <DataTable
          mode="client"
          caption={t.media.queueTitle}
          columns={queueColumns}
          rows={queue}
          rowKey={(item) => item.key}
          paging={{
            page: queuePage,
            pageSize: QUEUE_PAGE_SIZE,
            onPageChange: setQueuePage,
            labels: paginationLabels(t, t.media.queueTitle),
          }}
        />
      ) : null}
      {library.data && (total > 0 || searching) ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={0}
          resultCount={resultsText(t, total)}
          reload={{ label: t.common.reload, onClick: () => void library.reload() }}
          search={
            <SearchInput
              id="media-q"
              value={list.q}
              label={t.media.search}
              placeholder={t.media.search}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => updateList({ q }, { replace: true })}
            />
          }
        />
      ) : null}
      {library.error ? (
        <ErrorState error={library.error} t={t} onRetry={() => void library.reload()} />
      ) : library.loading && !library.data ? (
        <Spinner label={t.common.loading} />
      ) : items.length === 0 ? (
        searching ? (
          <Empty>{t.media.noMatch}</Empty>
        ) : (
          <>
            <Empty>{t.media.empty}</Empty>
            <FileDropzone multiple accept={MEDIA_TYPES} onFiles={enqueue}>
              <span>{t.media.dropTitle}</span>
              <span>{t.media.dropSub}</span>
              <span>{t.media.dropHint}</span>
            </FileDropzone>
          </>
        )
      ) : (
        <MediaGrid label={t.media.gridLabel}>
          {items.map((asset) => (
            <MediaTile
              key={asset.id}
              src={mediaVariantUrl(asset.id, 'thumb')}
              title={asset.originalFilename}
              meta={mediaMeta(asset, separator)}
              badge={
                missingAlt(asset) ? <Badge tone="warning">{t.media.missingAlt}</Badge> : undefined
              }
              actionLabel={fill(t.media.open, { name: asset.originalFilename })}
              onSelect={() => setOverlay({ kind: 'detail', id: asset.id })}
              actions={
                <RowActions
                  menuLabel={fill(t.media.actionsFor, { name: asset.originalFilename })}
                  items={[
                    {
                      id: 'edit',
                      label: t.media.editAlt,
                      icon: 'edit',
                      onSelect: () => setOverlay({ kind: 'detail', id: asset.id }),
                    },
                    {
                      id: 'remove',
                      label: t.media.remove.action,
                      icon: 'trash',
                      tone: 'danger',
                      onSelect: () => setOverlay({ kind: 'remove', asset }),
                    },
                  ]}
                />
              }
            />
          ))}
        </MediaGrid>
      )}
      {total > MEDIA_PAGE_SIZE ? (
        <Pagination
          page={list.page}
          pageSize={MEDIA_PAGE_SIZE}
          total={total}
          onPageChange={(page) => updateList({ page })}
          labels={paginationLabels(t, t.media.title)}
        />
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        title={t.website.title}
        intro={
          onPopups
            ? t.popups.intro
            : onSlider
              ? t.slides.intro
              : onSeasons
                ? t.seasons.intro
                : onShop
                  ? t.shopInfo.intro
                  : t.media.intro
        }
      >
        {onSeasons ? (
          <Button
            variant="primary"
            icon="plus"
            onClick={() => navigate?.(`${base}/website/seasons/new`)}
          >
            {t.seasons.create}
          </Button>
        ) : onSlider ? (
          <Button variant="primary" icon="plus" onClick={() => setSlideEditing({ id: null })}>
            {t.slides.create}
          </Button>
        ) : onPopups ? (
          <Button
            variant="primary"
            icon="plus"
            onClick={() => navigate?.(`${base}/website/popups/new`)}
          >
            {t.popups.create}
          </Button>
        ) : onShop ? null : (
          <>
            {finished ? (
              <Button variant="secondary" onClick={() => dispatch({ type: 'clear-finished' })}>
                {t.media.clearFinished}
              </Button>
            ) : null}
            <Button variant="primary" icon="upload" onClick={() => picker.current?.click()}>
              {t.media.upload}
            </Button>
          </>
        )}
      </PageHeader>
      <input
        ref={picker}
        type="file"
        hidden
        multiple
        tabIndex={-1}
        accept={MEDIA_TYPES.join(',')}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) enqueue(files);
        }}
      />
      <Tabs
        label={t.website.title}
        value={list.tab}
        onChange={(tab) => updateList({ tab })}
        tabs={[
          { id: 'media', label: t.website.media, panel: mediaPanel },
          { id: 'popup', label: t.website.popup, panel: <PopupsPanel /> },
          {
            id: 'slider',
            label: t.website.slider,
            panel: <SlidesPanel editing={slideEditing} onEditing={setSlideEditing} />,
          },
          { id: 'season', label: t.website.season, panel: <SeasonsPanel /> },
          { id: 'shop', label: t.website.shop, panel: <ShopInfoPanel /> },
        ]}
      />
      {overlay?.kind === 'detail' ? (
        <MediaDetail
          key={overlay.id}
          id={overlay.id}
          separator={separator}
          onClose={() => setOverlay(null)}
          onSaved={async () => {
            await library.reload();
            setOverlay(null);
            notify(t.common.saved);
          }}
        />
      ) : null}
      {overlay?.kind === 'remove' ? (
        <RemoveMedia
          key={overlay.asset.id}
          asset={overlay.asset}
          onClose={() => setOverlay(null)}
          onRemoved={async () => {
            await library.reload();
            setOverlay(null);
            notify(t.media.remove.deleted);
          }}
        />
      ) : null}
    </>
  );
}

/** The place a usage names: a popup, a slider slide or a season's decoration slot. */
const usageKindLabel = (t: ReturnType<typeof useWorkforce>['t'], kind: MediaUsage['kind']) =>
  kind === 'POPUP'
    ? t.media.detail.usagePopup
    : kind === 'SLIDE'
      ? t.media.detail.usageSlide
      : kind === 'SHOP_INFO'
        ? t.media.detail.usageShop
        : kind === 'PRODUCT'
          ? t.media.detail.usageProduct
          : kind === 'CAMPAIGN'
            ? t.media.detail.usageCampaign
            : kind === 'IMPORT_CANDIDATE'
              ? t.media.detail.usageImport
              : t.media.detail.usageSeason;

/**
 * Delete one image (design 16.8). Where the image is used is looked up first: an image a popup or slide
 * shows cannot be deleted, so the dialog lists those places and offers nothing destructive. An unused image
 * gets the usual confirmation.
 */
function RemoveMedia({
  asset,
  onClose,
  onRemoved,
}: {
  asset: MediaAssetSummary;
  onClose: () => void;
  onRemoved: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const detail = useResource(
    () => api.get<MediaAssetDetail>(`/api/v1/website/media/${asset.id}`),
    [api, asset.id],
  );
  const usedIn = detail.data?.usedIn ?? [];
  const place = (usage: MediaUsage) => ({
    label: usageKindLabel(t, usage.kind),
    value: usage.title === '' ? t.popups.untitled : usage.title,
  });

  if (detail.data && usedIn.length === 0) {
    return (
      <ConfirmDialog
        title={t.media.remove.title}
        description={t.media.remove.body}
        facts={[{ label: t.media.remove.fileFact, value: asset.originalFilename }]}
        tone="danger"
        confirmLabel={t.media.remove.confirm}
        busyLabel={t.common.saving}
        cancelLabel={t.common.cancel}
        referenceLabel={t.errors.reference}
        describeError={confirmError(t)}
        onCancel={onClose}
        onConfirm={async () => {
          const outcome = await runMutation(
            () => api.post(`/api/v1/website/media/${asset.id}/delete`, {}),
            () => undefined,
          );
          if (!outcome.ok) throw outcome.error;
          await onRemoved();
        }}
      />
    );
  }
  return (
    <Dialog
      open
      title={usedIn.length > 0 ? t.media.remove.inUseTitle : t.media.remove.title}
      description={usedIn.length > 0 ? t.media.remove.inUseBody : undefined}
      closeLabel={t.common.close}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {usedIn.length > 0 ? t.media.remove.inUseClose : t.common.cancel}
        </Button>
      }
    >
      {detail.error ? (
        <ErrorState error={detail.error} t={t} onRetry={() => void detail.reload()} />
      ) : usedIn.length > 0 ? (
        <DescriptionList
          columns={1}
          items={[
            { label: t.media.remove.fileFact, value: asset.originalFilename },
            ...usedIn.map(place),
          ]}
        />
      ) : (
        <Spinner label={t.media.remove.checking} />
      )}
    </Dialog>
  );
}

/** Image details: preview, facts, where it is used, and the alt text (the only editable data). */
function MediaDetail({
  id,
  separator,
  onClose,
  onSaved,
}: {
  id: string;
  separator: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const detail = useResource(
    () => api.get<MediaAssetDetail>(`/api/v1/website/media/${id}`),
    [api, id],
  );
  const asset = detail.data;
  const [form, setForm] = useState<{ altVi: string; altEn: string } | null>(null);
  const submit = useSubmit();
  useEffect(() => {
    if (asset) setForm({ altVi: asset.altVi ?? '', altEn: asset.altEn ?? '' });
  }, [asset]);
  const dirty =
    asset !== null &&
    form !== null &&
    (trimmedAlt(form.altVi) !== asset.altVi || trimmedAlt(form.altEn) !== asset.altEn);

  async function save() {
    if (!asset || !form) return;
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/website/media/${asset.id}/alt`, {
              expectedVersion: asset.rowVersion,
              altVi: trimmedAlt(form.altVi),
              altEn: trimmedAlt(form.altEn),
            }),
          () => detail.reload(),
        ),
      '',
    );
    if (ok) await onSaved();
  }

  const usageLabel = (usage: MediaUsage) =>
    `${usageKindLabel(t, usage.kind)}: ${usage.title === '' ? t.popups.untitled : usage.title}`;

  return (
    <FormDrawer
      title={t.media.detail.title}
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={dirty}
      submitDisabled={!asset || !dirty}
      error={
        submit.error ? (
          <ErrorState error={submit.error} t={t} />
        ) : detail.error ? (
          <ErrorState error={detail.error} t={t} onRetry={() => void detail.reload()} />
        ) : undefined
      }
      onClose={onClose}
      onSubmit={save}
    >
      {asset && form ? (
        <FormGrid>
          <MediaPreview
            src={mediaVariantUrl(asset.id, 'md')}
            alt={fill(t.media.detail.preview, { name: asset.originalFilename })}
          />
          <DescriptionList
            columns={2}
            items={[
              { label: t.media.detail.file, value: asset.originalFilename },
              { label: t.media.detail.size, value: mediaMeta(asset, separator) },
              {
                label: t.media.detail.uploadedAt,
                value: formatDateTime(asset.createdAt, WEBSITE_TIME_ZONE, locale),
              },
              {
                label: t.media.detail.usedIn,
                value:
                  asset.usedIn.length === 0
                    ? t.media.detail.notUsed
                    : asset.usedIn.map(usageLabel).join(', '),
              },
            ]}
          />
          <Field label={t.media.detail.altVi} hint={t.media.detail.altViHint}>
            {(control) => (
              <TextInput
                {...control}
                maxLength={MEDIA_ALT_MAX}
                value={form.altVi}
                onChange={(event) => setForm({ ...form, altVi: event.target.value })}
              />
            )}
          </Field>
          <Field label={t.media.detail.altEn} hint={t.media.detail.altEnHint}>
            {(control) => (
              <TextInput
                {...control}
                maxLength={MEDIA_ALT_MAX}
                value={form.altEn}
                onChange={(event) => setForm({ ...form, altEn: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
      ) : detail.error ? null : (
        <Spinner label={t.common.loading} />
      )}
    </FormDrawer>
  );
}
