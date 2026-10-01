'use client';

import type {
  MediaAssetDetail,
  MediaAssetSummary,
  MediaListResponse,
  MediaUploadResponse,
} from '@lucy-spa/contracts';
import {
  Dialog,
  Field,
  ListToolbar,
  MediaGrid,
  MediaPreview,
  MediaTile,
  Pagination,
  SearchInput,
  Spinner,
  TextInput,
} from '@lucy-spa/ui';
import { useRef, useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { paginationLabels, toolbarLabels, resultsText } from '../../../lib/workforce/list-view';
import {
  MEDIA_ALT_MAX,
  MEDIA_PAGE_SIZE,
  MEDIA_TYPES,
  mediaMeta,
  mediaVariantUrl,
  missingAlt,
  precheckMediaFile,
  trimmedAlt,
  uploadMedia,
} from '../../../lib/workforce/media';
import { errorMessage, runMutation } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Badge, Button, Empty, ErrorState, Notice, useResource, useSubmit } from '../ui';

type Step = { kind: 'list' } | { kind: 'describe'; asset: MediaAssetSummary };

/**
 * Choose a library image for a popup (design 16.4 `MediaPicker`). An image without Vietnamese alt text
 * cannot be used (Q-CM10): picking one asks for the description first, in the same dialog, and only then
 * hands the image back. A new image can be uploaded from here; it goes through the same steps.
 */
export function MediaPicker({
  onPick,
  onClose,
}: {
  onPick: (asset: MediaAssetSummary) => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const [step, setStep] = useState<Step>({ kind: 'list' });
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const library = useResource(
    () => api.get<MediaListResponse>('/api/v1/website/media', { search: q, page }),
    [api, q, page],
  );
  const text = t.popups.picker;
  const separator = locale === 'vi' ? ',' : '.';
  const items = library.data?.items ?? [];
  const total = library.data?.total ?? 0;

  /** An image with a Vietnamese description is used straight away; otherwise it is described first. */
  const choose = (asset: MediaAssetSummary) => {
    if (missingAlt(asset)) setStep({ kind: 'describe', asset });
    else onPick(asset);
  };

  async function upload(file: File) {
    setNotice(null);
    if (precheckMediaFile(file)) {
      setNotice(precheckMediaFile(file) === 'type' ? t.errors.mediaType : t.errors.mediaTooLarge);
      return;
    }
    setUploading(true);
    try {
      const result: MediaUploadResponse = await uploadMedia(api, file);
      await library.reload();
      choose(result.asset);
    } catch (error) {
      setNotice(errorMessage(error, t));
    } finally {
      setUploading(false);
    }
  }

  if (step.kind === 'describe') {
    return (
      <Describe
        asset={step.asset}
        onBack={() => setStep({ kind: 'list' })}
        onClose={onClose}
        onDone={onPick}
      />
    );
  }

  return (
    <Dialog
      open
      size="lg"
      title={text.title}
      closeLabel={t.common.close}
      busy={uploading}
      onClose={onClose}
    >
      <input
        ref={input}
        type="file"
        hidden
        tabIndex={-1}
        accept={MEDIA_TYPES.join(',')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />
      {notice ? <Notice tone="error">{notice}</Notice> : null}
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={0}
        {...(library.data ? { resultCount: resultsText(t, total) } : {})}
        search={
          <SearchInput
            id="picker-q"
            value={q}
            label={text.search}
            placeholder={text.search}
            clearLabel={t.common.list.clearSearch}
            onSearch={(value) => {
              setQ(value);
              setPage(1);
            }}
          />
        }
        actions={
          <Button
            variant="secondary"
            icon="upload"
            loading={uploading}
            onClick={() => input.current?.click()}
          >
            {uploading ? text.uploading : text.upload}
          </Button>
        }
      />
      {library.error ? (
        <ErrorState error={library.error} t={t} onRetry={() => void library.reload()} />
      ) : library.loading && !library.data ? (
        <Spinner label={t.common.loading} />
      ) : items.length === 0 ? (
        <Empty>{q === '' ? text.empty : text.noMatch}</Empty>
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
              actionLabel={fill(text.use, { name: asset.originalFilename })}
              onSelect={() => choose(asset)}
            />
          ))}
        </MediaGrid>
      )}
      {total > MEDIA_PAGE_SIZE ? (
        <Pagination
          page={page}
          pageSize={MEDIA_PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          labels={paginationLabels(t, text.title)}
        />
      ) : null}
    </Dialog>
  );
}

/** The one question before an undescribed image can be used: its Vietnamese description. */
function Describe({
  asset,
  onBack,
  onClose,
  onDone,
}: {
  asset: MediaAssetSummary;
  onBack: () => void;
  onClose: () => void;
  onDone: (asset: MediaAssetSummary) => void;
}) {
  const { api, t } = useWorkforce();
  const text = t.popups.picker;
  const [altVi, setAltVi] = useState('');
  const [missing, setMissing] = useState(false);
  const submit = useSubmit();

  async function save() {
    const description = trimmedAlt(altVi);
    if (description === null) {
      setMissing(true);
      return;
    }
    setMissing(false);
    let saved: MediaAssetDetail | null = null;
    const ok = await submit.run(
      () =>
        runMutation(
          async () => {
            saved = await api.post<MediaAssetDetail>(`/api/v1/website/media/${asset.id}/alt`, {
              expectedVersion: asset.rowVersion,
              altVi: description,
              altEn: asset.altEn,
            });
          },
          () => undefined,
        ),
      '',
    );
    if (ok && saved) onDone(saved);
  }

  return (
    <Dialog
      open
      size="md"
      title={text.altTitle}
      description={text.altBody}
      closeLabel={t.common.close}
      busy={submit.pending}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onBack} disabled={submit.pending}>
            {text.back}
          </Button>
          <Button variant="primary" loading={submit.pending} onClick={() => void save()}>
            {text.altSave}
          </Button>
        </>
      }
    >
      {submit.error ? <ErrorState error={submit.error} t={t} /> : null}
      <MediaPreview
        src={mediaVariantUrl(asset.id, 'md')}
        alt={fill(t.media.detail.preview, { name: asset.originalFilename })}
      />
      <Field
        label={t.media.detail.altVi}
        hint={t.media.detail.altViHint}
        required
        requiredLabel={t.common.required}
        error={missing ? text.altRequired : undefined}
      >
        {(control) => (
          <TextInput
            {...control}
            maxLength={MEDIA_ALT_MAX}
            value={altVi}
            onChange={(event) => setAltVi(event.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}
