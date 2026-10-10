'use client';

import type {
  SupplierSourceItem,
  SupplierSourceListResponse,
  SupplierSourceResponse,
} from '@lucy-spa/contracts';
import { SUPPLIER_SOURCE_CADENCES, SUPPLIER_SOURCE_KINDS } from '@lucy-spa/contracts';
import {
  CheckField,
  ConfirmDialog,
  DataTable,
  DateTextInput,
  Field,
  FormDialog,
  FormDrawer,
  FormGrid,
  FormSection,
  RowActions,
  Select,
  Stack,
  TextInput,
  Textarea,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useEffect, useState } from 'react';
import { supplierSourcesDictionary } from '../../../i18n/supplier-sources';
import { fill } from '../../../i18n/workforce';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDateTime } from '../../../lib/workforce/format';
import { canGlobal } from '../../../lib/workforce/permissions';
import {
  editDraftOf,
  editRequest,
  emptySourceDraft,
  fieldOfSourceError,
  isSourceConflict,
  NEW_SUPPLIER,
  permissionDraftOf,
  permissionRequest,
  permissionState,
  shopToday,
  sourceActions,
  sourceCreateRequest,
  sourceErrorText,
  SUPPLIER_NAME_MAX,
  SUPPLIER_SOURCE_NAME_MAX,
  SUPPLIER_SOURCE_PERMISSION_FIELD_MAX,
  SUPPLIER_SOURCE_PERMISSION_NOTE_MAX,
  validateEdit,
  validatePermission,
  validateSource,
  type EditDraft,
  type PermissionDraft,
  type SourceDraft,
} from '../../../lib/workforce/supplier-sources';
import { useClientPaging } from '../../../lib/workforce/use-client-paging';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  useResource,
  useSuccessToast,
} from '../ui';

/**
 * "Nguồn nhà cung cấp": the places a supplier's catalog can be read from (Phase 9 P9-2). Reading needs MANAGE_SUPPLIER_SOURCES or
 * REVIEW_SUPPLIER_IMPORTS (a reviewer only reads); every change needs MANAGE_SUPPLIER_SOURCES. A source is switched on only after its
 * permission record is complete, covers text or images and has been confirmed (the server and the database repeat the rule). Every
 * command carries the row version the screen read.
 */
export function SupplierSourcesScreen() {
  const { locale } = useWorkforce();
  const { account } = useAccount();
  const text = supplierSourcesDictionary(locale);
  if (
    !canGlobal(account, 'MANAGE_SUPPLIER_SOURCES') &&
    !canGlobal(account, 'REVIEW_SUPPLIER_IMPORTS')
  ) {
    return (
      <>
        <PageHeader title={text.title} intro={text.intro} />
        <Empty>{text.noAccess}</Empty>
      </>
    );
  }
  return <SourcesPage />;
}

function SourcesPage() {
  const { api, t } = useWorkforce();
  const loaded = useResource(
    () => api.get<SupplierSourceListResponse>('/api/v1/supplier-sources'),
    [api],
  );
  const [list, setList] = useState<SupplierSourceListResponse | null>(null);
  useEffect(() => {
    if (loaded.data) setList(loaded.data);
  }, [loaded.data]);
  if (loaded.error && !list) {
    return <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />;
  }
  if (!list) return <Loading t={t} page />;
  return (
    <SourcesView
      list={list}
      onChange={setList}
      reload={async () => {
        await loaded.reload();
      }}
    />
  );
}

type Overlay =
  | { kind: 'create' }
  | { kind: 'edit'; item: SupplierSourceItem }
  | { kind: 'permission'; item: SupplierSourceItem }
  | { kind: 'confirm'; item: SupplierSourceItem }
  | { kind: 'enable'; item: SupplierSourceItem }
  | { kind: 'disable'; item: SupplierSourceItem }
  | null;

/** The list and its dialogs (a test renders it with data). */
export function SourcesView({
  list,
  onChange,
  reload,
}: {
  list: SupplierSourceListResponse;
  onChange: (list: SupplierSourceListResponse) => void;
  reload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = supplierSourcesDictionary(locale);
  const notify = useSuccessToast();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const paging = useClientPaging(t, text.title);

  /** The server answers with the one changed source: swap it into the list and close the overlay. */
  const finish = (message: string) => (response: SupplierSourceResponse) => {
    setOverlay(null);
    notify(message);
    onChange({
      ...list,
      items: list.items.some((item) => item.id === response.item.id)
        ? list.items.map((item) => (item.id === response.item.id ? response.item : item))
        : [response.item, ...list.items],
      suppliers: list.suppliers.some((s) => s.id === response.item.supplier.id)
        ? list.suppliers
        : [...list.suppliers, response.item.supplier].sort((a, b) =>
            a.name.localeCompare(b.name, locale),
          ),
    });
  };

  const columns: DataTableColumn<SupplierSourceItem>[] = [
    {
      key: 'name',
      header: text.columns.name,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      sortable: true,
      sortValue: (item) => item.name.toLocaleLowerCase(locale),
      cell: (item) => item.name,
    },
    {
      key: 'supplier',
      header: text.columns.supplier,
      truncate: true,
      width: 'md',
      hideBelow: 'lg',
      sortable: true,
      sortValue: (item) => item.supplier.name.toLocaleLowerCase(locale),
      cell: (item) => item.supplier.name,
    },
    {
      key: 'address',
      header: text.columns.address,
      truncate: true,
      width: 'lg',
      hideBelow: 'wide',
      cell: (item) => item.baseUrl ?? text.noAddress,
    },
    {
      key: 'permission',
      header: text.columns.permission,
      cell: (item) => {
        const state = permissionState(item);
        return (
          <Badge
            tone={state === 'confirmed' ? 'success' : state === 'pending' ? 'warning' : 'neutral'}
          >
            {text.permissionBadge[state]}
          </Badge>
        );
      },
    },
    {
      key: 'state',
      header: text.columns.state,
      cell: (item) => (
        <Badge tone={item.isEnabled ? 'success' : 'neutral'}>
          {item.isEnabled ? text.enabled : text.disabled}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (item) => (
        <RowActions
          menuLabel={fill(text.actionsFor, { name: item.name })}
          items={sourceActions(item, list.canManage).map((action) => ({
            id: action,
            label: text.menu[action],
            icon: action === 'edit' ? ('edit' as const) : undefined,
            tone: action === 'disable' ? ('danger' as const) : ('default' as const),
            onSelect: () => setOverlay({ kind: action, item }),
          }))}
        />
      ),
    },
  ];

  const command = (item: SupplierSourceItem, path: string, message: string) => async () => {
    try {
      const response = await api.post<SupplierSourceResponse>(
        `/api/v1/supplier-sources/${item.id}/${path}`,
        { expectedVersion: item.rowVersion },
      );
      finish(message)(response);
    } catch (failure) {
      if (isSourceConflict(failure)) await reload();
      throw failure;
    }
  };

  const confirmDialog = (
    item: SupplierSourceItem,
    copy: { title: string; body: string; confirm: string },
    path: string,
    message: string,
    tone: 'danger' | 'neutral',
  ) => (
    <ConfirmDialog
      title={copy.title}
      description={fill(copy.body, { name: item.name })}
      tone={tone}
      confirmLabel={copy.confirm}
      busyLabel={text.busy}
      cancelLabel={text.keep}
      referenceLabel={t.errors.reference}
      describeError={(failure) => ({
        ...confirmError(t)(failure),
        message: sourceErrorText(failure, locale, (cause) => errorMessage(cause, t)),
      })}
      onCancel={() => setOverlay(null)}
      onConfirm={command(item, path, message)}
    />
  );

  return (
    <>
      <PageHeader title={text.title} intro={text.intro}>
        {list.canManage ? (
          <Button variant="primary" icon="plus" onClick={() => setOverlay({ kind: 'create' })}>
            {text.add}
          </Button>
        ) : null}
      </PageHeader>
      {list.canManage ? null : <Notice tone="info">{text.readOnly}</Notice>}
      <DataTable
        caption={fill(t.common.list.table, { list: text.title })}
        columns={columns}
        rows={list.items}
        rowKey={(item) => `${item.id}:${item.rowVersion}`}
        loadingLabel={t.common.loading}
        defaultSort={{ key: 'name', direction: 'asc' }}
        empty={<Empty>{text.empty}</Empty>}
        paging={paging}
      />
      {overlay?.kind === 'create' ? (
        <CreateDialog
          suppliers={list.suppliers}
          onClose={() => setOverlay(null)}
          onDone={finish(text.created)}
          onConflict={reload}
        />
      ) : null}
      {overlay?.kind === 'edit' ? (
        <EditDialog
          item={overlay.item}
          onClose={() => setOverlay(null)}
          onDone={finish(text.saved)}
          onConflict={reload}
        />
      ) : null}
      {overlay?.kind === 'permission' ? (
        <PermissionDrawer
          item={overlay.item}
          onClose={() => setOverlay(null)}
          onDone={finish(text.permissionSaved)}
          onConflict={reload}
        />
      ) : null}
      {overlay?.kind === 'confirm'
        ? confirmDialog(
            overlay.item,
            text.confirmDialog,
            'confirm-permission',
            text.confirmed,
            'neutral',
          )
        : null}
      {overlay?.kind === 'enable'
        ? confirmDialog(overlay.item, text.enableDialog, 'enable', text.switchedOn, 'neutral')
        : null}
      {overlay?.kind === 'disable'
        ? confirmDialog(overlay.item, text.disableDialog, 'disable', text.switchedOff, 'danger')
        : null}
    </>
  );
}

/** A long source name in a title: the first 40 characters and an ellipsis. */
function shortName(name: string): string {
  const letters = [...name];
  return letters.length > 40 ? `${letters.slice(0, 40).join('')}…` : name;
}

function useForm(
  onDone: (response: SupplierSourceResponse) => void,
  onConflict: () => Promise<void>,
) {
  const { api, t, locale } = useWorkforce();
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  async function send(path: string, body: object) {
    setPending(true);
    try {
      onDone(await api.post<SupplierSourceResponse>(path, body));
    } catch (failure) {
      if (isSourceConflict(failure)) await onConflict();
      setField(fieldOfSourceError(failure));
      setError(sourceErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }
  return {
    checked,
    pending,
    error,
    field,
    begin: () => {
      setChecked(true);
      setError(null);
      setField(null);
    },
    fail: setError,
    send,
  };
}

function CreateDialog({
  suppliers,
  onClose,
  onDone,
  onConflict,
}: {
  suppliers: SupplierSourceListResponse['suppliers'];
  onClose: () => void;
  onDone: (response: SupplierSourceResponse) => void;
  onConflict: () => Promise<void>;
}) {
  const { t, locale } = useWorkforce();
  const text = supplierSourcesDictionary(locale);
  const copy = text.create;
  const [draft, setDraft] = useState<SourceDraft>(() => emptySourceDraft(suppliers[0]?.id ?? null));
  const form = useForm(onDone, onConflict);
  const problems = validateSource(draft);
  const set = (patch: Partial<SourceDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const dirty = draft.name !== '' || draft.baseUrl !== '' || draft.supplierName !== '';

  async function submit() {
    if (form.pending) return;
    form.begin();
    if (Object.keys(problems).length > 0) return;
    await form.send('/api/v1/supplier-sources', sourceCreateRequest(draft));
  }

  return (
    <FormDialog
      title={copy.title}
      description={copy.description}
      labels={{ ...formOverlayLabels(t, copy.submit), submitting: text.busy }}
      busy={form.pending}
      dirty={dirty}
      error={form.error ? <Notice tone="error">{form.error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <Stack gap="page">
        <FormGrid cols={1}>
          <Field
            label={copy.supplier}
            error={form.checked && problems.supplier ? text.problems.supplier : undefined}
            required
            full
          >
            {(control) => (
              <Select
                {...control}
                value={draft.supplierId}
                options={[
                  ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })),
                  { value: NEW_SUPPLIER, label: copy.newSupplier },
                ]}
                onChange={(event) => set({ supplierId: event.target.value })}
              />
            )}
          </Field>
          {draft.supplierId === NEW_SUPPLIER ? (
            <Field
              label={copy.supplierName}
              hint={copy.supplierNameHint}
              error={
                (form.checked && problems.supplierName) || form.field === 'supplierName'
                  ? text.problems.supplierName
                  : undefined
              }
              required
              full
            >
              {(control) => (
                <TextInput
                  {...control}
                  autoComplete="off"
                  maxLength={SUPPLIER_NAME_MAX}
                  value={draft.supplierName}
                  onChange={(event) => set({ supplierName: event.target.value })}
                />
              )}
            </Field>
          ) : null}
          <Field
            label={copy.name}
            hint={copy.nameHint}
            error={
              form.field === 'name'
                ? text.errors.SUPPLIER_SOURCE_NAME_TAKEN
                : form.checked && problems.name
                  ? text.problems.name
                  : undefined
            }
            required
            full
          >
            {(control) => (
              <TextInput
                {...control}
                autoComplete="off"
                maxLength={SUPPLIER_SOURCE_NAME_MAX}
                value={draft.name}
                onChange={(event) => set({ name: event.target.value })}
              />
            )}
          </Field>
          <Field label={copy.kind} required full>
            {(control) => (
              <Select
                {...control}
                value={draft.kind}
                options={SUPPLIER_SOURCE_KINDS.map((kind) => ({
                  value: kind,
                  label: text.kinds[kind],
                }))}
                onChange={(event) => set({ kind: event.target.value as SourceDraft['kind'] })}
              />
            )}
          </Field>
          {draft.kind === 'FILE' ? null : (
            <Field
              label={copy.address}
              hint={copy.addressHint}
              error={
                (form.checked && problems.baseUrl) || form.field === 'baseUrl'
                  ? form.field === 'baseUrl' && !problems.baseUrl
                    ? text.errors.SUPPLIER_SOURCE_URL_TAKEN
                    : text.problems.address
                  : undefined
              }
              required
              full
            >
              {(control) => (
                <TextInput
                  {...control}
                  autoComplete="off"
                  inputMode="url"
                  maxLength={500}
                  value={draft.baseUrl}
                  onChange={(event) => set({ baseUrl: event.target.value })}
                />
              )}
            </Field>
          )}
        </FormGrid>
      </Stack>
    </FormDialog>
  );
}

function EditDialog({
  item,
  onClose,
  onDone,
  onConflict,
}: {
  item: SupplierSourceItem;
  onClose: () => void;
  onDone: (response: SupplierSourceResponse) => void;
  onConflict: () => Promise<void>;
}) {
  const { t, locale } = useWorkforce();
  const text = supplierSourcesDictionary(locale);
  const copy = text.edit;
  const [draft, setDraft] = useState<EditDraft>(() => editDraftOf(item));
  const form = useForm(onDone, onConflict);
  const problems = validateEdit(draft, item);
  const set = (patch: Partial<EditDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const body = editRequest(draft, item);

  async function submit() {
    if (form.pending) return;
    form.begin();
    if (Object.keys(problems).length > 0) return;
    if (!body) {
      form.fail(text.nothing);
      return;
    }
    await form.send(`/api/v1/supplier-sources/${item.id}/edit`, body);
  }

  return (
    <FormDialog
      title={copy.title}
      description={copy.description}
      labels={{ ...formOverlayLabels(t, copy.submit), submitting: text.busy }}
      busy={form.pending}
      dirty={body !== null}
      error={form.error ? <Notice tone="error">{form.error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <Stack gap="page">
        <FormGrid cols={1}>
          <Field
            label={copy.name}
            error={
              form.field === 'name'
                ? text.errors.SUPPLIER_SOURCE_NAME_TAKEN
                : form.checked && problems.name
                  ? text.problems.name
                  : undefined
            }
            required
            full
          >
            {(control) => (
              <TextInput
                {...control}
                autoComplete="off"
                maxLength={SUPPLIER_SOURCE_NAME_MAX}
                value={draft.name}
                onChange={(event) => set({ name: event.target.value })}
              />
            )}
          </Field>
          {item.kind === 'FILE' ? null : (
            <Field
              label={copy.address}
              hint={item.isEnabled ? copy.addressLocked : undefined}
              error={
                (form.checked && problems.baseUrl) || form.field === 'baseUrl'
                  ? form.field === 'baseUrl' && !problems.baseUrl
                    ? text.errors.SUPPLIER_SOURCE_URL_TAKEN
                    : text.problems.address
                  : undefined
              }
              full
            >
              {(control) => (
                <TextInput
                  {...control}
                  autoComplete="off"
                  inputMode="url"
                  maxLength={500}
                  disabled={item.isEnabled}
                  value={draft.baseUrl}
                  onChange={(event) => set({ baseUrl: event.target.value })}
                />
              )}
            </Field>
          )}
          <Field label={copy.cadence} hint={copy.cadenceHint} full>
            {(control) => (
              <Select
                {...control}
                value={draft.scanCadence}
                options={SUPPLIER_SOURCE_CADENCES.map((cadence) => ({
                  value: cadence,
                  label: text.cadences[cadence],
                }))}
                onChange={(event) =>
                  set({ scanCadence: event.target.value as EditDraft['scanCadence'] })
                }
              />
            )}
          </Field>
        </FormGrid>
      </Stack>
    </FormDialog>
  );
}

function PermissionDrawer({
  item,
  onClose,
  onDone,
  onConflict,
}: {
  item: SupplierSourceItem;
  onClose: () => void;
  onDone: (response: SupplierSourceResponse) => void;
  onConflict: () => Promise<void>;
}) {
  const { t, locale } = useWorkforce();
  const text = supplierSourcesDictionary(locale);
  const copy = text.permission;
  const [draft, setDraft] = useState<PermissionDraft>(() => permissionDraftOf(item));
  const form = useForm(onDone, onConflict);
  const today = shopToday();
  const problems = validatePermission(draft, today);
  const set = (patch: Partial<PermissionDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const body = permissionRequest(draft, item);
  const state = permissionState(item);
  const noCoverage = !draft.permitsText && !draft.permitsImages;
  const status =
    state === 'confirmed'
      ? fill(item.permission.confirmedBy ? copy.status.confirmed : copy.status.confirmedNoName, {
          name: item.permission.confirmedBy?.name ?? '',
          time: formatDateTime(item.permission.confirmedAt ?? '', 'Asia/Ho_Chi_Minh', locale),
        })
      : copy.status[state];

  async function submit() {
    if (form.pending) return;
    form.begin();
    if (Object.keys(problems).length > 0) return;
    if (!body) {
      form.fail(text.nothing);
      return;
    }
    await form.send(`/api/v1/supplier-sources/${item.id}/permission`, body);
  }

  return (
    <FormDrawer
      title={`${copy.title}: ${shortName(item.name)}`}
      labels={{ ...formOverlayLabels(t, copy.submit), submitting: copy.saving }}
      busy={form.pending}
      dirty={body !== null}
      error={form.error ? <Notice tone="error">{form.error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <Stack gap="page">
        <Notice
          tone={state === 'confirmed' ? 'success' : 'info'}
        >{`${status} ${copy.intro}`}</Notice>
        <FormGrid cols={1}>
          <Field
            label={copy.givenBy}
            hint={copy.givenByHint}
            error={form.checked && problems.givenBy ? text.problems.givenBy : undefined}
            required
            full
          >
            {(control) => (
              <TextInput
                {...control}
                autoComplete="off"
                maxLength={SUPPLIER_SOURCE_PERMISSION_FIELD_MAX}
                value={draft.givenBy}
                onChange={(event) => set({ givenBy: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={copy.method}
            hint={copy.methodHint}
            error={form.checked && problems.method ? text.problems.method : undefined}
            required
            full
          >
            {(control) => (
              <TextInput
                {...control}
                autoComplete="off"
                maxLength={SUPPLIER_SOURCE_PERMISSION_FIELD_MAX}
                value={draft.method}
                onChange={(event) => set({ method: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={copy.date}
            error={
              (form.checked && problems.date) || form.field === 'date'
                ? text.problems.date
                : undefined
            }
            required
            full
          >
            {(control) => (
              <DateTextInput
                {...control}
                max={today}
                value={draft.date}
                onChange={(event) => set({ date: event.target.value })}
              />
            )}
          </Field>
          <Field label={copy.note} hint={copy.noteHint} full>
            {(control) => (
              <Textarea
                {...control}
                maxLength={SUPPLIER_SOURCE_PERMISSION_NOTE_MAX}
                value={draft.note}
                onChange={(event) => set({ note: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
        <FormSection title={copy.covers}>
          <Stack gap="field">
            <CheckField
              label={copy.text}
              checked={draft.permitsText}
              onChange={(event) => set({ permitsText: event.target.checked })}
            />
            <CheckField
              label={copy.images}
              checked={draft.permitsImages}
              onChange={(event) => set({ permitsImages: event.target.checked })}
            />
            <CheckField
              label={copy.prices}
              hint={copy.pricesHint}
              checked={draft.permitsPrices}
              onChange={(event) => set({ permitsPrices: event.target.checked })}
            />
            {noCoverage && (form.checked || state !== 'none') ? (
              <Notice tone="warning">{text.problems.coverage}</Notice>
            ) : null}
          </Stack>
        </FormSection>
        {state === 'none' ? null : <Notice tone="warning">{copy.warning}</Notice>}
      </Stack>
    </FormDrawer>
  );
}
