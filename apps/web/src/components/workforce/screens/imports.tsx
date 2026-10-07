'use client';

import type {
  ProductImportDetailResponse,
  ProductImportJobResponse,
  ProductImportKindName,
  ProductImportListResponse,
} from '@lucy-spa/contracts';
import {
  ButtonLink,
  Cluster,
  DataTable,
  Field,
  FileDropzone,
  FormDialog,
  FormGrid,
  RowActions,
  Select,
  formatBytes,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { importDictionary } from '../../../i18n/imports';
import { fill } from '../../../i18n/workforce';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDateTime } from '../../../lib/workforce/format';
import {
  emptyUploadDraft,
  IMPORT_KINDS,
  megabytes,
  importErrorText,
  precheckImportFile,
  statusTone,
  templateUrl,
  uploadForm,
  validateUpload,
  type ImportUploadDraft,
} from '../../../lib/workforce/imports';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { errorMessage } from '../../../lib/workforce/workflows';
import { PrefetchLink as Link } from '../link';
import { useWorkforce } from '../session';
import { Badge, Button, Empty, ErrorState, Loading, Notice, PageHeader, useResource } from '../ui';

const ZONE = 'Asia/Ho_Chi_Minh';

/** "Nhập dữ liệu": the import jobs, newest first, and the one primary action "Tải tệp lên". */
export function ImportsScreen() {
  const { api, t } = useWorkforce();
  const jobs = useResource(
    () => api.get<ProductImportListResponse>('/api/v1/product-imports'),
    [api],
  );
  if (jobs.error && !jobs.data) {
    return <ErrorState error={jobs.error} t={t} onRetry={() => void jobs.reload()} />;
  }
  if (!jobs.data) return <Loading t={t} page />;
  return <ImportsView data={jobs.data} />;
}

/** The page's content (also rendered on its own by the tests). */
export function ImportsView({ data }: { data: ProductImportListResponse }) {
  const { t, locale, base, navigate } = useWorkforce();
  const text = importDictionary(locale);
  const [uploading, setUploading] = useState(false);
  const [page, setPage] = useState({ page: 1, pageSize: 20 });
  const open = (job: ProductImportJobResponse) => `${base}/import/${job.id}`;

  const columns: DataTableColumn<ProductImportJobResponse>[] = [
    {
      key: 'file',
      header: text.list.columns.file,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (job) => (
        <Link className="ls-link" href={open(job)}>
          {job.filename}
        </Link>
      ),
    },
    { key: 'kind', header: text.list.columns.kind, cell: (job) => text.kinds[job.kind] },
    {
      key: 'branch',
      header: text.list.columns.branch,
      truncate: true,
      width: 'sm',
      hideBelow: 'lg',
      cell: (job) => job.branchName ?? text.none,
    },
    {
      key: 'rows',
      header: text.list.columns.rows,
      numeric: true,
      hideBelow: 'md',
      cell: (job) => fill(text.list.rowsOf, { valid: job.validCount, total: job.rowCount }),
    },
    {
      key: 'status',
      header: text.list.columns.status,
      cell: (job) => <Badge tone={statusTone(job.status)}>{text.statuses[job.status]}</Badge>,
    },
    {
      key: 'createdBy',
      header: text.list.columns.createdBy,
      truncate: true,
      width: 'sm',
      hideBelow: 'xl',
      cell: (job) => job.createdByName,
    },
    {
      key: 'createdAt',
      header: text.list.columns.createdAt,
      hideBelow: 'lg',
      cell: (job) => formatDateTime(job.createdAt, ZONE, locale),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (job) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: job.filename })}
          items={[
            {
              id: 'open',
              label: text.list.open,
              icon: 'eye',
              onSelect: () => navigate?.(open(job)),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader title={text.title}>
        <Button variant="primary" icon="upload" onClick={() => setUploading(true)}>
          {text.upload}
        </Button>
      </PageHeader>
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: text.list.table })}
        columns={columns}
        rows={data.jobs}
        rowKey={(job) => `${job.id}:${job.rowVersion}`}
        empty={<Empty>{text.list.empty}</Empty>}
        paging={{
          ...page,
          onPageChange: (next) => setPage((state) => ({ ...state, page: next })),
          onPageSizeChange: (pageSize) => setPage({ page: 1, pageSize }),
          labels: paginationLabels(t, text.list.table),
        }}
      />
      {uploading ? (
        <UploadDialog
          data={data}
          onClose={() => setUploading(false)}
          onPreviewed={(job) => {
            setUploading(false);
            navigate?.(`${base}/import/${job.id}`);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * "Tải tệp lên": the kind of data (a branch for opening stock), the template downloads and the file. Sending it only PREVIEWS: the
 * preview page shows every row and asks for the confirmation, so nothing is saved here.
 */
export function UploadDialog({
  data,
  onClose,
  onPreviewed,
}: {
  data: ProductImportListResponse;
  onClose: () => void;
  onPreviewed: (job: ProductImportDetailResponse) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const text = importDictionary(locale);
  const d = text.dialog;
  const [draft, setDraft] = useState<ImportUploadDraft>(() => {
    const only = data.branches.length === 1 ? data.branches[0]!.id : '';
    return { ...emptyUploadDraft(), branchId: only };
  });
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const errors = validateUpload(draft);
  const separator = locale === 'vi' ? ',' : '.';
  const size = megabytes(data.limits.maxBytes);
  const rows = data.limits.maxRows.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US');
  const set = (patch: Partial<ImportUploadDraft>) => {
    setDraft((state) => ({ ...state, ...patch }));
    setFailure(null);
  };

  function choose(files: File[]) {
    const file = files[0];
    if (!file) return;
    const problem = precheckImportFile(file, data.limits.maxBytes);
    if (problem) {
      set({ file: null });
      setFailure(
        problem === 'size'
          ? fill(text.fileProblems.tooLarge, { size })
          : text.fileProblems.unsupported,
      );
      return;
    }
    set({ file });
  }

  async function submit() {
    setChecked(true);
    if (Object.keys(errors).length > 0 || pending) return;
    setPending(true);
    setFailure(null);
    try {
      const job = await api.upload<ProductImportDetailResponse>(
        '/api/v1/product-imports',
        uploadForm(draft),
      );
      onPreviewed(job);
    } catch (error) {
      setFailure(importErrorText(error, locale, (cause) => errorMessage(cause, t), data.limits));
    } finally {
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={d.title}
      description={d.hint}
      labels={{ ...formOverlayLabels(t, d.submit), submitting: d.submitting }}
      busy={pending}
      dirty={draft.file !== null}
      error={failure ? <Notice tone="error">{failure}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid cols={1}>
        <Field label={d.kind} full>
          {(control) => (
            <Select
              {...control}
              value={draft.kind}
              options={IMPORT_KINDS.map((kind) => ({ value: kind, label: d.kindOptions[kind] }))}
              onChange={(event) => set({ kind: event.target.value as ProductImportKindName })}
            />
          )}
        </Field>
        {draft.kind === 'OPENING_STOCK' ? (
          <Field
            label={d.branch}
            required
            full
            error={checked && errors.branchId ? d.branchRequired : undefined}
          >
            {(control) => (
              <Select
                {...control}
                value={draft.branchId}
                placeholder={d.branchPlaceholder}
                options={data.branches.map((branch) => ({ value: branch.id, label: branch.name }))}
                onChange={(event) => set({ branchId: event.target.value })}
              />
            )}
          </Field>
        ) : null}
        <Field label={d.template} hint={d.templateHint} full>
          {() => (
            <Cluster>
              <ButtonLink
                variant="secondary"
                icon="download"
                href={templateUrl(draft.kind, 'xlsx', locale)}
                download
              >
                {d.templateXlsx}
              </ButtonLink>
              <ButtonLink
                variant="secondary"
                icon="download"
                href={templateUrl(draft.kind, 'csv', locale)}
                download
              >
                {d.templateCsv}
              </ButtonLink>
            </Cluster>
          )}
        </Field>
        <Field
          label={d.file}
          required
          full
          error={checked && errors.file ? d.fileRequired : undefined}
        >
          {() => (
            <FileDropzone
              accept={[
                '.xlsx',
                '.csv',
                'text/csv',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              ]}
              disabled={pending}
              onFiles={choose}
            >
              {draft.file ? (
                <>
                  <span className="ls-dropzone-title">{draft.file.name}</span>
                  <span className="ls-dropzone-sub">
                    {formatBytes(draft.file.size, separator)} · {d.change}
                  </span>
                </>
              ) : (
                <>
                  <span className="ls-dropzone-title">{d.drop}</span>
                  <span className="ls-dropzone-sub">{fill(d.dropHint, { size, rows })}</span>
                </>
              )}
            </FileDropzone>
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}
