'use client';

import type { ShippingCarrierListResponse, ShippingCarrierResponse } from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  Field,
  FormDialog,
  FormGrid,
  RowActions,
  Stack,
  TextInput,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useEffect, useState } from 'react';
import { onlineFulfilmentDictionary } from '../../../i18n/online-fulfilment';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/workforce/api';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  CARRIER_NAME_MAX,
  CARRIER_TEMPLATE_MAX,
  carrierCreateRequest,
  carrierDraftOf,
  carrierEditRequest,
  carrierSwitchRequest,
  emptyCarrierDraft,
  fieldOfError,
  isOnlineConflict,
  onlineErrorText,
  validateCarrier,
  type CarrierDraft,
} from '../../../lib/workforce/online-orders';
import { canGlobal } from '../../../lib/workforce/permissions';
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
 * "Đơn vị vận chuyển": the carriers the shop ships online orders with (Phase 6 P6-20, `MANAGE_PRODUCTS`). The list starts empty: no
 * carrier is invented. A used carrier is switched off, never deleted. Every edit carries the row version it was read at.
 */
export function ShippingCarriersScreen() {
  const { locale } = useWorkforce();
  const { account } = useAccount();
  const text = onlineFulfilmentDictionary(locale).carriers;
  if (!canGlobal(account, 'MANAGE_PRODUCTS')) {
    return (
      <>
        <PageHeader title={text.title} intro={text.intro} />
        <Empty>{text.noAccess}</Empty>
      </>
    );
  }
  return <CarriersPage />;
}

function CarriersPage() {
  const { api, t } = useWorkforce();
  const loaded = useResource(
    () => api.get<ShippingCarrierListResponse>('/api/v1/shipping-carriers'),
    [api],
  );
  const [carriers, setCarriers] = useState<ShippingCarrierResponse[] | null>(null);
  useEffect(() => {
    if (loaded.data) setCarriers(loaded.data.carriers);
  }, [loaded.data]);
  if (loaded.error && !carriers) {
    return <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />;
  }
  if (!carriers) return <Loading t={t} page />;
  return (
    <CarriersView
      carriers={carriers}
      onChange={(list) => setCarriers(list.carriers)}
      reload={async () => {
        await loaded.reload();
      }}
    />
  );
}

type Overlay =
  | { kind: 'create' }
  | { kind: 'edit'; carrier: ShippingCarrierResponse }
  | { kind: 'switch'; carrier: ShippingCarrierResponse }
  | null;

/** The list and its dialogs (a test renders it with data). */
export function CarriersView({
  carriers,
  onChange,
  reload,
}: {
  carriers: ShippingCarrierResponse[];
  onChange: (list: ShippingCarrierListResponse) => void;
  reload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = onlineFulfilmentDictionary(locale).carriers;
  const notify = useSuccessToast();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const paging = useClientPaging(t, text.title);

  const columns: DataTableColumn<ShippingCarrierResponse>[] = [
    {
      key: 'name',
      header: text.columns.name,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      sortable: true,
      sortValue: (carrier) => carrier.name.toLocaleLowerCase(locale),
      cell: (carrier) => carrier.name,
    },
    {
      key: 'template',
      header: text.columns.template,
      truncate: true,
      width: 'lg',
      hideBelow: 'md',
      cell: (carrier) => carrier.trackingUrlTemplate ?? text.noTemplate,
    },
    {
      key: 'status',
      header: text.columns.status,
      cell: (carrier) => (
        <Badge tone={carrier.isActive ? 'success' : 'neutral'}>
          {carrier.isActive ? text.active : text.inactive}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (carrier) => (
        <RowActions
          menuLabel={fill(text.actionsFor, { name: carrier.name })}
          items={[
            {
              id: 'edit',
              label: text.edit,
              icon: 'edit',
              onSelect: () => setOverlay({ kind: 'edit', carrier }),
            },
            {
              id: 'switch',
              label: carrier.isActive ? text.deactivate : text.activate,
              tone: carrier.isActive ? ('danger' as const) : ('default' as const),
              onSelect: () => setOverlay({ kind: 'switch', carrier }),
            },
          ]}
        />
      ),
    },
  ];

  const finish = (message: string) => (list: ShippingCarrierListResponse) => {
    setOverlay(null);
    notify(message);
    onChange(list);
  };

  return (
    <>
      <PageHeader title={text.title} intro={text.intro}>
        <Button variant="primary" icon="plus" onClick={() => setOverlay({ kind: 'create' })}>
          {text.add}
        </Button>
      </PageHeader>
      <DataTable
        caption={fill(t.common.list.table, { list: text.title })}
        columns={columns}
        rows={carriers}
        rowKey={(carrier) => `${carrier.id}:${carrier.rowVersion}`}
        loadingLabel={t.common.loading}
        defaultSort={{ key: 'name', direction: 'asc' }}
        empty={<Empty>{text.empty}</Empty>}
        paging={paging}
      />
      {overlay?.kind === 'create' ? (
        <CarrierDialog
          onClose={() => setOverlay(null)}
          onDone={finish(text.created)}
          onConflict={reload}
        />
      ) : null}
      {overlay?.kind === 'edit' ? (
        <CarrierDialog
          carrier={overlay.carrier}
          onClose={() => setOverlay(null)}
          onDone={finish(text.saved)}
          onConflict={reload}
        />
      ) : null}
      {overlay?.kind === 'switch' ? (
        <ConfirmDialog
          title={overlay.carrier.isActive ? text.deactivateTitle : text.activateTitle}
          description={fill(overlay.carrier.isActive ? text.deactivateBody : text.activateBody, {
            name: overlay.carrier.name,
          })}
          tone={overlay.carrier.isActive ? 'danger' : 'neutral'}
          confirmLabel={overlay.carrier.isActive ? text.deactivateConfirm : text.activateConfirm}
          busyLabel={text.busy}
          cancelLabel={text.keep}
          referenceLabel={t.errors.reference}
          describeError={(failure) => ({
            ...confirmError(t)(failure),
            message: onlineErrorText(failure, locale, (cause) => errorMessage(cause, t)),
          })}
          onCancel={() => setOverlay(null)}
          onConfirm={async () => {
            const carrier = overlay.carrier;
            try {
              const list = await api.post<ShippingCarrierListResponse>(
                `/api/v1/shipping-carriers/${carrier.id}/edit`,
                carrierSwitchRequest(carrier, !carrier.isActive),
              );
              finish(text.switched)(list);
            } catch (failure) {
              if (isOnlineConflict(failure)) await reload();
              throw failure;
            }
          }}
        />
      ) : null}
    </>
  );
}

function CarrierDialog({
  carrier,
  onClose,
  onDone,
  onConflict,
}: {
  carrier?: ShippingCarrierResponse;
  onClose: () => void;
  onDone: (list: ShippingCarrierListResponse) => void;
  onConflict: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = onlineFulfilmentDictionary(locale).carriers;
  const [draft, setDraft] = useState<CarrierDraft>(() =>
    carrier ? carrierDraftOf(carrier) : emptyCarrierDraft(),
  );
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);
  const problems = validateCarrier(draft);
  const set = (patch: Partial<CarrierDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const original = carrier ? carrierDraftOf(carrier) : emptyCarrierDraft();
  const dirty = draft.name !== original.name || draft.template !== original.template;
  const nameClash = field === 'name';

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    setField(null);
    const body = carrier ? carrierEditRequest(draft, carrier) : carrierCreateRequest(draft);
    if (Object.keys(problems).length > 0) return;
    if (!body) {
      setError(text.nothing);
      return;
    }
    setPending(true);
    try {
      const list = await api.post<ShippingCarrierListResponse>(
        carrier ? `/api/v1/shipping-carriers/${carrier.id}/edit` : '/api/v1/shipping-carriers',
        body,
      );
      onDone(list);
    } catch (failure) {
      if (isOnlineConflict(failure) && !(failure instanceof ApiError && failure.field === 'name')) {
        await onConflict();
      }
      setField(fieldOfError(failure) ?? (failure instanceof ApiError ? failure.field : null));
      setError(onlineErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={carrier ? text.editTitle : text.createTitle}
      description={carrier ? text.editDescription : text.createDescription}
      labels={{
        ...formOverlayLabels(t, carrier ? text.save : text.create),
        submitting: text.saving,
      }}
      busy={pending}
      dirty={dirty}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <Stack gap="page">
        <FormGrid cols={1}>
          <Field
            label={text.name}
            hint={text.nameHint}
            error={
              nameClash
                ? onlineFulfilmentDictionary(locale).errors.CARRIER_NAME_TAKEN
                : checked && problems.name
                  ? text.badName
                  : undefined
            }
            required
            full
          >
            {(control) => (
              <TextInput
                {...control}
                autoComplete="off"
                maxLength={CARRIER_NAME_MAX}
                value={draft.name}
                onChange={(event) => set({ name: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={text.template}
            hint={text.templateHint}
            error={
              (checked && problems.template) || field === 'trackingUrlTemplate'
                ? text.badTemplate
                : undefined
            }
            full
          >
            {(control) => (
              <TextInput
                {...control}
                autoComplete="off"
                inputMode="url"
                maxLength={CARRIER_TEMPLATE_MAX}
                value={draft.template}
                onChange={(event) => set({ template: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
      </Stack>
    </FormDialog>
  );
}
