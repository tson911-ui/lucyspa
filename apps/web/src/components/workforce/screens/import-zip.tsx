'use client';

import type { ProductImageZipItem, ProductImageZipResponse } from '@lucy-spa/contracts';
import {
  CheckField,
  DataTable,
  Field,
  FileDropzone,
  FormDialog,
  FormGrid,
  Stack,
  formatBytes,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { importDictionary } from '../../../i18n/imports';
import { fill } from '../../../i18n/workforce';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { megabytes } from '../../../lib/workforce/imports';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { errorMessage } from '../../../lib/workforce/workflows';
import { ApiError } from '../../../lib/workforce/api';
import { useWorkforce } from '../session';
import { Badge, Empty, Notice } from '../ui';

const BASE = '/api/v1/product-image-imports';
const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 400;

/**
 * "Nhập ảnh từ ZIP" (Phase 9 P9-8, PRD 31.3): choose a ZIP of pictures named after the SKU, read what would be added, then confirm with
 * the same file. Pictures are only added. A picture for a product that is on sale changes the shop at once, so it is added only after
 * the person ticks that.
 */
export function ImageZipDialog({ onClose }: { onClose: () => void }) {
  const { api, t, locale } = useWorkforce();
  const text = importDictionary(locale).zip;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ProductImageZipResponse | null>(null);
  const [allowPublished, setAllowPublished] = useState(false);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [page, setPage] = useState({ page: 1, pageSize: 20 });
  const separator = locale === 'vi' ? ',' : '.';
  const size = megabytes(MAX_ZIP_BYTES);

  const problem = (error: unknown): string => {
    if (error instanceof ApiError && error.code === 'IMPORT_FILE_INVALID' && error.field) {
      const template = (text.problems as Record<string, string>)[error.field];
      if (template) return fill(template, { size, files: String(MAX_FILES) });
    }
    return errorMessage(error, t);
  };

  function choose(files: File[]) {
    const picked = files[0];
    if (!picked) return;
    setPreview(null);
    setDone(null);
    setFailure(null);
    if (!picked.name.toLowerCase().endsWith('.zip')) {
      setFile(null);
      setFailure(text.problems.corrupt);
      return;
    }
    if (picked.size > MAX_ZIP_BYTES) {
      setFile(null);
      setFailure(fill(text.problems.tooLarge, { size }));
      return;
    }
    setFile(picked);
  }

  async function submit() {
    setChecked(true);
    if (!file || pending) return;
    setPending(true);
    setFailure(null);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      if (preview === null) {
        setPreview(await api.upload<ProductImageZipResponse>(`${BASE}/preview`, form));
        setPage({ page: 1, pageSize: 20 });
      } else {
        form.append('sha256', preview.sha256);
        form.append('allowPublished', allowPublished ? 'true' : 'false');
        const result = await api.upload<ProductImageZipResponse>(`${BASE}/apply`, form);
        setPreview(result);
        setDone(result.added);
      }
    } catch (error) {
      setFailure(problem(error));
    } finally {
      setPending(false);
    }
  }

  const columns: DataTableColumn<ProductImageZipItem>[] = [
    {
      key: 'file',
      header: text.columns.file,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (item) => item.fileName,
    },
    {
      key: 'product',
      header: text.columns.product,
      truncate: true,
      width: 'md',
      hideBelow: 'md',
      cell: (item) => item.product?.name ?? '—',
    },
    {
      key: 'position',
      header: text.columns.position,
      numeric: true,
      hideBelow: 'md',
      cell: (item) => (item.position === null ? '—' : String(item.position)),
    },
    {
      key: 'result',
      header: text.columns.result,
      wrap: true,
      cell: (item) =>
        item.reason ? (
          <Badge tone="warning">{text.reasons[item.reason]}</Badge>
        ) : (
          <Badge tone={item.status === 'ADDED' ? 'success' : 'info'}>
            {text.results[item.status]}
          </Badge>
        ),
    },
  ];

  const count =
    preview === null
      ? 0
      : done === null
        ? preview.ready - (allowPublished ? 0 : preview.publishedPictures)
        : done;

  return (
    <FormDialog
      title={text.title}
      description={text.hint}
      labels={{
        ...formOverlayLabels(
          t,
          done !== null
            ? t.common.close
            : preview === null
              ? text.preview
              : fill(text.apply, { count }),
        ),
        submitting: preview === null ? text.previewing : text.applying,
      }}
      busy={pending}
      dirty={file !== null && done === null}
      error={failure ? <Notice tone="error">{failure}</Notice> : undefined}
      onClose={onClose}
      onSubmit={async () => {
        if (done !== null) onClose();
        else await submit();
      }}
    >
      <Stack gap="block">
        <FormGrid cols={1}>
          <Field
            label={text.file}
            required
            full
            error={checked && !file ? text.fileRequired : undefined}
          >
            {() => (
              <FileDropzone
                accept={['.zip', 'application/zip', 'application/x-zip-compressed']}
                disabled={pending || done !== null}
                onFiles={choose}
              >
                {file ? (
                  <>
                    <span className="ls-dropzone-title">{file.name}</span>
                    <span className="ls-dropzone-sub">
                      {formatBytes(file.size, separator)} · {text.change}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="ls-dropzone-title">{text.drop}</span>
                    <span className="ls-dropzone-sub">
                      {fill(text.dropHint, { size, files: String(MAX_FILES) })}
                    </span>
                  </>
                )}
              </FileDropzone>
            )}
          </Field>
        </FormGrid>
        {done !== null ? <Notice tone="success">{fill(text.done, { count: done })}</Notice> : null}
        {preview !== null ? (
          <>
            <Notice tone={preview.ready === 0 ? 'warning' : 'info'}>
              {preview.ready === 0
                ? text.nothing
                : fill(text.summary, {
                    ready: preview.ready,
                    products: preview.products,
                    skipped: preview.skipped,
                  })}
            </Notice>
            {done === null && preview.publishedPictures > 0 ? (
              <>
                <Notice tone="warning">
                  {fill(text.published, { count: preview.publishedPictures })}
                </Notice>
                <CheckField
                  label={text.allowPublished}
                  checked={allowPublished}
                  onChange={(event) => setAllowPublished(event.target.checked)}
                />
              </>
            ) : null}
            <DataTable
              mode="client"
              caption={text.table}
              columns={columns}
              rows={preview.items}
              rowKey={(item) => `${item.fileName}:${item.status}`}
              empty={<Empty>{text.nothing}</Empty>}
              paging={{
                ...page,
                onPageChange: (next) => setPage((state) => ({ ...state, page: next })),
                onPageSizeChange: (pageSize) => setPage({ page: 1, pageSize }),
                labels: paginationLabels(t, text.table),
              }}
            />
          </>
        ) : null}
      </Stack>
    </FormDialog>
  );
}
