'use client';

import {
  VIETNAM_PROVINCES,
  type OnlineStaffLine,
  type OnlineStaffOrderResponse,
  type OnlineStaffReturnCase,
} from '@lucy-spa/contracts';
import {
  DateInput,
  DescriptionList,
  Field,
  FormDialog,
  FormDrawer,
  FormGrid,
  MoneyInput,
  RadioGroup,
  Select,
  Stack,
  Textarea,
  TextInput,
} from '@lucy-spa/ui';
import { useRef, useState, type ReactNode } from 'react';
import { onlineFulfilmentDictionary } from '../../../i18n/online-fulfilment';
import { productOrdersDictionary } from '../../../i18n/product-orders';
import { fill } from '../../../i18n/workforce';
import { formatVnd } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  addressDraft,
  addressRequest,
  BANK_REFERENCE_MAX,
  correctShipmentDraft,
  correctShipmentRequest,
  deliveredRequest,
  deliveryDayOk,
  emptyLogDraft,
  emptyShipDraft,
  emptySettleDraft,
  FAIL_REASONS,
  fieldOfError,
  isOnlineConflict,
  latestDeliveryDay,
  logKindsFor,
  logRequest,
  NOTE_MAX,
  onlineErrorText,
  returnCostRequest,
  settleFigures,
  settleRequest,
  shipRequest,
  validateAddress,
  validateCorrectShipment,
  validateLog,
  validateSettle,
  validateShip,
  type AddressDraft,
  type CorrectShipmentDraft,
  type LogDraft,
  type SettleDraft,
  type ShipDraft,
} from '../../../lib/workforce/online-orders';
import {
  CANCEL_METHODS,
  cancelRequest,
  emptyCancelDraft,
  validAmount,
  validateCancel,
  type CancelDraft,
} from '../../../lib/workforce/product-orders';
import { productTitle } from '../../../lib/workforce/product-sale';
import { withReauthentication } from '../../../lib/workforce/reauth';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useReauthentication } from '../reauth-dialog';
import { useWorkforce } from '../session';
import { Notice } from '../ui';

type Order = OnlineStaffOrderResponse;

/** What a dialog's body is told about the last attempt: whether the person tried to save, and the field the server refused. */
interface View {
  checked: boolean;
  field: string | null;
}

/**
 * One command on the order: the dialog (or drawer) around its fields. `run` returns the request to send, or null while the draft has a
 * problem (then every missing field shows its message). The command answers with the whole order, which the page shows at once. A
 * refused command shows its words; a conflict or a state change reloads the page behind. Cancelling the password confirmation saves nothing and
 * is not an error.
 */
function CommandDialog({
  title,
  description,
  submit,
  submitting,
  drawer = false,
  dirty,
  run,
  onClose,
  onDone,
  onConflict,
  nameOf,
  extra,
  children,
}: {
  title: string;
  description?: string;
  submit: string;
  submitting: string;
  drawer?: boolean;
  dirty: boolean;
  run: () => Promise<Order> | null;
  onClose: () => void;
  onDone: (order: Order) => Promise<void> | void;
  onConflict: () => Promise<void> | void;
  nameOf?: (id: string) => string | null;
  /** Rendered beside the form (the password confirmation). */
  extra?: ReactNode;
  children: (view: View) => ReactNode;
}) {
  const { t, locale } = useWorkforce();
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState<string | null>(null);

  async function onSubmit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    setField(null);
    const call = run();
    if (!call) return;
    setPending(true);
    try {
      const next = await call;
      await onDone(next);
    } catch (failure) {
      // Cancelling the password confirmation is not an error: nothing was saved.
      if (!(failure instanceof Error && failure.name === 'ReauthenticationCancelled')) {
        if (isOnlineConflict(failure)) await onConflict();
        setField(fieldOfError(failure));
        setError(
          onlineErrorText(
            failure,
            locale,
            (cause) => errorMessage(cause, t),
            nameOf ?? (() => null),
          ),
        );
      }
      setPending(false);
    }
  }

  const labels = { ...formOverlayLabels(t, submit), submitting };
  const body = (
    <Stack gap="page">
      {drawer && description ? <p className="ls-hint">{description}</p> : null}
      {children({ checked, field })}
    </Stack>
  );
  const notice = error ? <Notice tone="error">{error}</Notice> : undefined;
  return (
    <>
      {drawer ? (
        <FormDrawer
          title={title}
          labels={labels}
          busy={pending}
          dirty={dirty}
          error={notice}
          onClose={onClose}
          onSubmit={onSubmit}
        >
          {body}
        </FormDrawer>
      ) : (
        <FormDialog
          title={title}
          {...(description ? { description } : {})}
          labels={labels}
          busy={pending}
          dirty={dirty}
          error={notice}
          onClose={onClose}
          onSubmit={onSubmit}
        >
          {body}
        </FormDialog>
      )}
      {extra}
    </>
  );
}

interface DialogProps {
  order: Order;
  onClose: () => void;
  onDone: (order: Order) => Promise<void> | void;
  onConflict: () => Promise<void> | void;
}

const useMoneySeparator = () => (useWorkforce().locale === 'vi' ? '.' : ',');

/** The name of an order line by its id, for the message about lines that are not ready. */
function useNameOf(order: Order) {
  const { locale } = useWorkforce();
  return (id: string) => {
    const line = order.lines.find((entry) => entry.id === id);
    return line ? productTitle(line, locale) : null;
  };
}

const url = (order: Order, path: string) => `/api/v1/online-orders/${order.id}/${path}`;

// -------------------------------------------------------------------------------------------------------- ship

export function ShipDialog({ order, onClose, onDone, onConflict }: DialogProps) {
  const { api, locale } = useWorkforce();
  const d = onlineFulfilmentDictionary(locale).ship;
  const separator = useMoneySeparator();
  const nameOf = useNameOf(order);
  const [draft, setDraft] = useState<ShipDraft>(() => emptyShipDraft(order.carriers));
  const problems = validateShip(draft);
  const set = (patch: Partial<ShipDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const parcel = order.lines.filter((line) => line.status !== 'CANCELLED');
  return (
    <CommandDialog
      drawer
      title={d.title}
      description={d.description}
      submit={d.submit}
      submitting={d.submitting}
      dirty={draft.trackingCode !== '' || draft.fee !== null || draft.carrierId !== ''}
      run={() => {
        const body = shipRequest(draft, order);
        return body ? api.post<Order>(url(order, 'ship'), body) : null;
      }}
      onClose={onClose}
      onDone={onDone}
      onConflict={onConflict}
      nameOf={nameOf}
    >
      {({ checked, field }) => (
        <>
          <DescriptionList
            layout="totals"
            items={parcel.map((line) => ({
              label: `${line.sequence}. ${productTitle(line, locale)}`,
              value: `× ${line.quantity}`,
            }))}
          />
          {order.carriers.length === 0 ? <Notice tone="warning">{d.noCarriers}</Notice> : null}
          <FormGrid cols={1}>
            <Field
              label={d.carrier}
              error={
                (checked && problems.carrierId) || field === 'carrierId' ? d.badCarrier : undefined
              }
              required
              full
            >
              {(control) => (
                <Select
                  {...control}
                  value={draft.carrierId}
                  placeholder={d.carrierPlaceholder}
                  options={order.carriers.map((carrier) => ({
                    value: carrier.id,
                    label: carrier.name,
                  }))}
                  onChange={(event) => set({ carrierId: event.target.value })}
                />
              )}
            </Field>
            <Field
              label={d.tracking}
              hint={d.trackingHint}
              error={
                (checked && problems.trackingCode) || field === 'trackingCode'
                  ? d.badTracking
                  : undefined
              }
              required
              full
            >
              {(control) => (
                <TextInput
                  {...control}
                  autoComplete="off"
                  maxLength={80}
                  value={draft.trackingCode}
                  onChange={(event) => set({ trackingCode: event.target.value })}
                />
              )}
            </Field>
            <Field
              label={d.fee}
              hint={d.feeHint}
              error={(checked && problems.fee) || field === 'carrierFeeVnd' ? d.badFee : undefined}
              required
              full
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  unit="₫"
                  separator={separator}
                  value={draft.fee}
                  onValueChange={(value) => set({ fee: value })}
                />
              )}
            </Field>
          </FormGrid>
        </>
      )}
    </CommandDialog>
  );
}

// ------------------------------------------------------------------------------------------ correct shipment

export function CorrectShipmentDialog({ order, onClose, onDone, onConflict }: DialogProps) {
  const { api, locale } = useWorkforce();
  const d = onlineFulfilmentDictionary(locale).correctShipment;
  const ship = onlineFulfilmentDictionary(locale).ship;
  const separator = useMoneySeparator();
  const shipment = order.shipment;
  const [draft, setDraft] = useState<CorrectShipmentDraft | null>(() =>
    shipment ? correctShipmentDraft(shipment) : null,
  );
  if (!shipment || !draft) return null;
  const mayFee = shipment.carrierFeeOutVnd !== null;
  const problems = validateCorrectShipment(draft, shipment, mayFee);
  const set = (patch: Partial<CorrectShipmentDraft>) =>
    setDraft((state) => (state ? { ...state, ...patch } : state));
  return (
    <CommandDialog
      title={d.title}
      description={d.description}
      submit={d.submit}
      submitting={d.submitting}
      dirty={
        draft.trackingCode !== shipment.trackingCode ||
        draft.reason !== '' ||
        (mayFee && String(draft.fee) !== shipment.carrierFeeOutVnd)
      }
      run={() => {
        const body = correctShipmentRequest(draft, shipment, mayFee);
        return body ? api.post<Order>(url(order, 'shipment'), body) : null;
      }}
      onClose={onClose}
      onDone={onDone}
      onConflict={onConflict}
    >
      {({ checked, field }) => (
        <>
          {checked && problems.nothing ? <Notice tone="warning">{d.nothing}</Notice> : null}
          <FormGrid cols={1}>
            <Field
              label={d.tracking}
              error={
                (checked && problems.trackingCode) || field === 'trackingCode'
                  ? ship.badTracking
                  : undefined
              }
              required
              full
            >
              {(control) => (
                <TextInput
                  {...control}
                  autoComplete="off"
                  maxLength={80}
                  value={draft.trackingCode}
                  onChange={(event) => set({ trackingCode: event.target.value })}
                />
              )}
            </Field>
            {mayFee ? (
              <Field
                label={d.fee}
                error={
                  (checked && problems.fee) || field === 'carrierFeeVnd' ? ship.badFee : undefined
                }
                required
                full
              >
                {(control) => (
                  <MoneyInput
                    {...control}
                    unit="₫"
                    separator={separator}
                    value={draft.fee}
                    onValueChange={(value) => set({ fee: value })}
                  />
                )}
              </Field>
            ) : null}
            <Field
              label={d.reason}
              hint={d.reasonHint}
              error={(checked && problems.reason) || field === 'reason' ? ship.required : undefined}
              required
              full
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxLength={NOTE_MAX}
                  value={draft.reason}
                  onChange={(event) => set({ reason: event.target.value })}
                />
              )}
            </Field>
          </FormGrid>
        </>
      )}
    </CommandDialog>
  );
}

// ---------------------------------------------------------------------------------------------- delivered

export function DeliveredDialog({ order, onClose, onDone, onConflict }: DialogProps) {
  const { api, locale } = useWorkforce();
  const d = onlineFulfilmentDictionary(locale).delivered;
  const [day, setDay] = useState('');
  const bad = !deliveryDayOk(day);
  return (
    <CommandDialog
      title={d.title}
      description={d.description}
      submit={d.submit}
      submitting={d.submitting}
      dirty={day !== ''}
      run={() => (bad ? null : api.post<Order>(url(order, 'delivered'), deliveredRequest(day)))}
      onClose={onClose}
      onDone={onDone}
      onConflict={onConflict}
    >
      {({ checked, field }) => (
        <FormGrid cols={1}>
          <Field
            label={d.day}
            hint={d.dayHint}
            error={(checked && bad) || field === 'deliveredOn' ? d.badDay : undefined}
            full
          >
            {(control) => (
              <DateInput
                {...control}
                max={latestDeliveryDay()}
                value={day}
                onChange={(event) => setDay(event.target.value)}
              />
            )}
          </Field>
        </FormGrid>
      )}
    </CommandDialog>
  );
}

// -------------------------------------------------------------------------------------------------------- log

export function LogDialog({ order, onClose, onDone, onConflict }: DialogProps) {
  const { api, locale } = useWorkforce();
  const d = onlineFulfilmentDictionary(locale).log;
  const kinds = logKindsFor(order);
  const [draft, setDraft] = useState<LogDraft>(() => emptyLogDraft(kinds));
  const problems = validateLog(draft);
  const set = (patch: Partial<LogDraft>) => setDraft((state) => ({ ...state, ...patch }));
  return (
    <CommandDialog
      title={d.title}
      description={d.description}
      submit={d.submit}
      submitting={d.submitting}
      dirty={draft.note !== '' || draft.reasonCode !== ''}
      run={() => {
        const body = logRequest(draft);
        return body ? api.post<Order>(url(order, 'log'), body) : null;
      }}
      onClose={onClose}
      onDone={onDone}
      onConflict={onConflict}
    >
      {({ checked, field }) => (
        <>
          {kinds.length === 0 ? <Notice tone="warning">{d.none}</Notice> : null}
          <FormGrid cols={1}>
            <Field
              label={d.kind}
              error={(checked && problems.kind) || field === 'kind' ? d.required : undefined}
              required
              full
            >
              {(control) => (
                <Select
                  {...control}
                  value={draft.kind}
                  placeholder={d.kindPlaceholder}
                  options={kinds.map((kind) => ({ value: kind, label: d.kinds[kind] }))}
                  onChange={(event) =>
                    set({
                      kind: event.target.value as LogDraft['kind'],
                      reasonCode: '',
                    })
                  }
                />
              )}
            </Field>
            {draft.kind === 'DELIVERY_FAILED' ? (
              <Field
                label={d.reason}
                error={
                  (checked && problems.reasonCode) || field === 'reasonCode'
                    ? d.required
                    : undefined
                }
                required
                full
              >
                {(control) => (
                  <Select
                    {...control}
                    value={draft.reasonCode}
                    placeholder={d.reasonPlaceholder}
                    options={FAIL_REASONS.map((reason) => ({
                      value: reason,
                      label: d.reasons[reason],
                    }))}
                    onChange={(event) =>
                      set({ reasonCode: event.target.value as LogDraft['reasonCode'] })
                    }
                  />
                )}
              </Field>
            ) : null}
            <Field
              label={draft.kind === 'REDELIVERY' ? d.noteOptional : d.note}
              hint={d.noteHint}
              error={(checked && problems.note) || field === 'note' ? d.required : undefined}
              required={draft.kind !== 'REDELIVERY'}
              full
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxLength={NOTE_MAX}
                  value={draft.note}
                  onChange={(event) => set({ note: event.target.value })}
                />
              )}
            </Field>
          </FormGrid>
        </>
      )}
    </CommandDialog>
  );
}

// ---------------------------------------------------------------------------------------------- returned

export function ReturnedDialog({ order, onClose, onDone, onConflict }: DialogProps) {
  const { api, locale } = useWorkforce();
  const d = onlineFulfilmentDictionary(locale).returned;
  const [note, setNote] = useState('');
  const bad = note.trim() === '';
  return (
    <CommandDialog
      title={d.title}
      description={d.description}
      submit={d.submit}
      submitting={d.submitting}
      dirty={note !== ''}
      run={() => (bad ? null : api.post<Order>(url(order, 'returned'), { note: note.trim() }))}
      onClose={onClose}
      onDone={onDone}
      onConflict={onConflict}
    >
      {({ checked, field }) => (
        <FormGrid cols={1}>
          <Field
            label={d.note}
            hint={d.noteHint}
            error={(checked && bad) || field === 'note' ? d.required : undefined}
            required
            full
          >
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={NOTE_MAX}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
        </FormGrid>
      )}
    </CommandDialog>
  );
}

// ---------------------------------------------------------------------------------------------- address

export function AddressDialog({ order, onClose, onDone, onConflict }: DialogProps) {
  const { api, locale } = useWorkforce();
  const d = onlineFulfilmentDictionary(locale).address;
  const [draft, setDraft] = useState<AddressDraft>(() => addressDraft(order.recipient));
  const problems = validateAddress(draft, order.recipient);
  const set = (patch: Partial<AddressDraft>) => setDraft((state) => ({ ...state, ...patch }));
  return (
    <CommandDialog
      drawer
      title={d.title}
      description={d.description}
      submit={d.submit}
      submitting={d.submitting}
      dirty={JSON.stringify(draft) !== JSON.stringify(addressDraft(order.recipient))}
      run={() => {
        const body = addressRequest(draft, order.recipient);
        return body ? api.post<Order>(url(order, 'address'), body) : null;
      }}
      onClose={onClose}
      onDone={onDone}
      onConflict={onConflict}
    >
      {({ checked, field }) => {
        const shown = <K extends keyof AddressDraft>(key: K) =>
          (checked && problems[key]) || field === `address.${key}` || field === key;
        return (
          <>
            {checked && problems.nothing ? <Notice tone="warning">{d.nothing}</Notice> : null}
            <FormGrid cols={1}>
              <Field
                label={d.recipient}
                error={shown('recipientName') ? d.required : undefined}
                required
                full
              >
                {(control) => (
                  <TextInput
                    {...control}
                    maxLength={120}
                    autoComplete="off"
                    value={draft.recipientName}
                    onChange={(event) => set({ recipientName: event.target.value })}
                  />
                )}
              </Field>
              <Field
                label={d.phone}
                error={shown('recipientPhone') ? d.badPhone : undefined}
                required
                full
              >
                {(control) => (
                  <TextInput
                    {...control}
                    inputMode="tel"
                    maxLength={40}
                    autoComplete="off"
                    value={draft.recipientPhone}
                    onChange={(event) => set({ recipientPhone: event.target.value })}
                  />
                )}
              </Field>
              <Field
                label={d.province}
                error={shown('provinceCode') ? d.required : undefined}
                required
                full
              >
                {(control) => (
                  <Select
                    {...control}
                    value={draft.provinceCode}
                    placeholder={d.provincePlaceholder}
                    options={VIETNAM_PROVINCES.map((province) => ({
                      value: province.code,
                      label: locale === 'vi' ? province.nameVi : province.nameEn,
                    }))}
                    onChange={(event) => set({ provinceCode: event.target.value })}
                  />
                )}
              </Field>
              <Field label={d.ward} error={shown('ward') ? d.required : undefined} required full>
                {(control) => (
                  <TextInput
                    {...control}
                    maxLength={120}
                    autoComplete="off"
                    value={draft.ward}
                    onChange={(event) => set({ ward: event.target.value })}
                  />
                )}
              </Field>
              <Field
                label={d.street}
                error={shown('street') ? d.required : undefined}
                required
                full
              >
                {(control) => (
                  <TextInput
                    {...control}
                    maxLength={200}
                    autoComplete="off"
                    value={draft.street}
                    onChange={(event) => set({ street: event.target.value })}
                  />
                )}
              </Field>
              <Field
                label={d.reason}
                hint={d.reasonHint}
                error={shown('reason') ? d.required : undefined}
                required
                full
              >
                {(control) => (
                  <Textarea
                    {...control}
                    rows={3}
                    maxLength={NOTE_MAX}
                    value={draft.reason}
                    onChange={(event) => set({ reason: event.target.value })}
                  />
                )}
              </Field>
            </FormGrid>
          </>
        );
      }}
    </CommandDialog>
  );
}

// ---------------------------------------------------------------------------------------- cancel + refund

export function OnlineCancelDialog({
  line,
  onClose,
  onDone,
  onConflict,
}: Omit<DialogProps, 'order'> & { line: OnlineStaffLine }) {
  const { api, locale } = useWorkforce();
  const text = productOrdersDictionary(locale);
  const c = text.cancel;
  const own = onlineFulfilmentDictionary(locale).cancel;
  const { confirm, dialog } = useReauthentication();
  const separator = useMoneySeparator();
  const causes = line.cancelCauses.filter((cause) => cause !== 'INVOICE_CANCELLED');
  const share = line.refundShareVnd;
  const [draft, setDraft] = useState<CancelDraft>(() => ({
    ...emptyCancelDraft(),
    cause: causes.length === 1 ? (causes[0] as CancelDraft['cause']) : '',
    // A change of mind starts at the whole share; the Owner or a manager lowers it when they decide so.
    amount: causes.length === 1 && causes[0] === 'CUSTOMER_CHANGED_MIND' ? share : '',
  }));
  const requestId = useRef(globalThis.crypto.randomUUID());
  const problems = validateCancel(draft, share);
  const set = (patch: Partial<CancelDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const money = share !== '0';
  const partial =
    money &&
    draft.cause === 'CUSTOMER_CHANGED_MIND' &&
    validAmount(draft.amount, share) &&
    draft.amount.trim() !== share;
  return (
    <CommandDialog
      title={own.title}
      description={own.description}
      submit={c.submit}
      submitting={c.submitting}
      dirty={draft.note !== '' || draft.bankReference !== '' || partial}
      run={() => {
        const body = cancelRequest(draft, line.rowVersion, requestId.current, share);
        if (!body) return null;
        return withReauthentication(
          () => api.post<Order>(`/api/v1/online-orders/lines/${line.id}/cancel`, body),
          confirm,
        );
      }}
      onClose={onClose}
      onDone={onDone}
      onConflict={onConflict}
      extra={dialog}
    >
      {({ checked }) => (
        <>
          <Notice tone="info">{`${line.quantity} × ${productTitle(line, locale)}`}</Notice>
          {causes.length === 0 ? <Notice tone="warning">{c.noCause}</Notice> : null}
          <FormGrid>
            <Field
              label={c.cause}
              hint={c.causeHint}
              error={checked && problems.cause ? c.required : undefined}
              required
              full
            >
              {(control) => (
                <Select
                  {...control}
                  value={draft.cause}
                  placeholder={c.causePlaceholder}
                  options={causes.map((value) => ({
                    value,
                    label: text.card.cancelCause[value],
                  }))}
                  onChange={(event) => {
                    const cause = event.target.value as CancelDraft['cause'];
                    set({ cause, amount: cause === 'CUSTOMER_CHANGED_MIND' ? share : '' });
                  }}
                />
              )}
            </Field>
            {money && draft.cause === 'CUSTOMER_CHANGED_MIND' ? (
              <Field
                label={c.amountField}
                hint={c.amountHint}
                error={
                  checked && problems.amount
                    ? fill(c.badAmount, { share: formatVnd(share, locale) })
                    : undefined
                }
                required
                full
              >
                {(control) => (
                  <MoneyInput
                    {...control}
                    unit="₫"
                    separator={separator}
                    value={draft.amount === '' ? null : Number(draft.amount)}
                    onValueChange={(value) => set({ amount: value === null ? '' : String(value) })}
                  />
                )}
              </Field>
            ) : null}
            {money ? (
              <Field label={c.method} required>
                {(control) => (
                  <Select
                    {...control}
                    value={draft.method}
                    options={CANCEL_METHODS.map((value) => ({
                      value,
                      label: c.methodOptions[value],
                    }))}
                    onChange={(event) =>
                      set({
                        method: event.target.value as CancelDraft['method'],
                        bankReference: '',
                      })
                    }
                  />
                )}
              </Field>
            ) : null}
            {money && draft.method === 'BANK_TRANSFER_MANUAL' ? (
              <Field
                label={c.reference}
                hint={c.referenceHint}
                error={checked && problems.bankReference ? c.badReference : undefined}
                required
              >
                {(control) => (
                  <TextInput
                    {...control}
                    autoComplete="off"
                    maxLength={BANK_REFERENCE_MAX}
                    value={draft.bankReference}
                    onChange={(event) => set({ bankReference: event.target.value })}
                  />
                )}
              </Field>
            ) : null}
          </FormGrid>
          <FormGrid cols={1}>
            <Field
              label={c.note}
              hint={c.noteHint}
              error={checked && problems.note ? c.required : undefined}
              required
              full
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxLength={NOTE_MAX}
                  value={draft.note}
                  onChange={(event) => set({ note: event.target.value })}
                />
              )}
            </Field>
          </FormGrid>
          <Notice tone="info">
            {!money
              ? c.noAmount
              : partial
                ? fill(c.partial, {
                    amount: formatVnd(draft.amount.trim(), locale),
                    share: formatVnd(share, locale),
                  })
                : fill(c.amount, { amount: formatVnd(share, locale) })}
          </Notice>
          {line.mode === 'PRE_ORDER' && line.status === 'ARRIVED' ? (
            <p className="ls-hint">{c.goods}</p>
          ) : null}
          {money ? <Notice tone="warning">{c.warning}</Notice> : null}
          {money ? <p className="ls-hint">{c.owner}</p> : null}
        </>
      )}
    </CommandDialog>
  );
}

// ------------------------------------------------------------------------------------------------ settle

export function SettleDialog({ order, onClose, onDone, onConflict }: DialogProps) {
  const { api, locale } = useWorkforce();
  const d = onlineFulfilmentDictionary(locale).settle;
  const { confirm, dialog } = useReauthentication();
  const separator = useMoneySeparator();
  const [draft, setDraft] = useState<SettleDraft>(emptySettleDraft);
  const requestId = useRef(globalThis.crypto.randomUUID());
  const figures = settleFigures(order, draft.back);
  const problems = validateSettle(draft, figures);
  const set = (patch: Partial<SettleDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const refunded = figures.refund !== null && figures.refund > 0n;
  const money = (value: bigint) => formatVnd(value.toString(), locale);
  return (
    <CommandDialog
      drawer
      title={d.title}
      description={d.description}
      submit={d.submit}
      submitting={d.submitting}
      dirty={draft.back !== null || draft.reason !== '' || draft.bankReference !== ''}
      run={() => {
        const body = settleRequest(draft, order, requestId.current);
        if (!body) return null;
        return withReauthentication(() => api.post<Order>(url(order, 'settlement'), body), confirm);
      }}
      onClose={onClose}
      onDone={onDone}
      onConflict={onConflict}
      extra={dialog}
    >
      {({ checked, field }) => (
        <>
          {figures.refund === null ? <Notice tone="warning">{d.noPreview}</Notice> : null}
          <FormGrid cols={1}>
            <Field
              label={d.back}
              hint={d.backHint}
              error={
                (checked && problems.back) || field === 'carrierFeeBackVnd' ? d.badBack : undefined
              }
              required
              full
            >
              {(control) => (
                <MoneyInput
                  {...control}
                  unit="₫"
                  separator={separator}
                  value={draft.back}
                  onValueChange={(value) => set({ back: value })}
                />
              )}
            </Field>
          </FormGrid>
          <Stack gap="field">
            <DescriptionList
              layout="totals"
              items={[
                { label: d.goods, value: money(figures.goods) },
                {
                  label: d.out,
                  value: figures.out === null ? null : `−${money(figures.out)}`,
                },
                {
                  label: d.back,
                  value: figures.back > 0n ? `−${money(figures.back)}` : money(figures.back),
                },
                {
                  label: d.refund,
                  value: figures.refund === null ? null : money(figures.refund),
                  strong: true,
                },
              ]}
            />
            <p className="ls-hint">{d.formula}</p>
          </Stack>
          {figures.refund !== null && !refunded ? <Notice tone="info">{d.noRefund}</Notice> : null}
          {refunded ? (
            <FormGrid>
              <Field label={d.method} required>
                {(control) => (
                  <Select
                    {...control}
                    value={draft.method}
                    options={CANCEL_METHODS.map((value) => ({
                      value,
                      label: d.methodOptions[value],
                    }))}
                    onChange={(event) =>
                      set({
                        method: event.target.value as SettleDraft['method'],
                        bankReference: '',
                      })
                    }
                  />
                )}
              </Field>
              {draft.method === 'BANK_TRANSFER_MANUAL' ? (
                <Field
                  label={d.reference}
                  hint={d.referenceHint}
                  error={
                    (checked && problems.bankReference) || field === 'bankReference'
                      ? d.badReference
                      : undefined
                  }
                  required
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      autoComplete="off"
                      maxLength={BANK_REFERENCE_MAX}
                      value={draft.bankReference}
                      onChange={(event) => set({ bankReference: event.target.value })}
                    />
                  )}
                </Field>
              ) : null}
            </FormGrid>
          ) : null}
          {refunded ? (
            <RadioGroup
              legend={d.restock}
              name="settle-restock"
              value={draft.restock}
              onValueChange={(value) => set({ restock: value as SettleDraft['restock'] })}
              options={(['NOT_SELLABLE', 'SELLABLE'] as const).map((value) => ({
                value,
                label: d.restockOptions[value],
              }))}
            />
          ) : (
            <p className="ls-hint">{d.restockLocked}</p>
          )}
          <FormGrid cols={1}>
            <Field
              label={d.reason}
              hint={d.reasonHint}
              error={(checked && problems.reason) || field === 'reason' ? d.required : undefined}
              required
              full
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxLength={NOTE_MAX}
                  value={draft.reason}
                  onChange={(event) => set({ reason: event.target.value })}
                />
              )}
            </Field>
          </FormGrid>
          <Notice tone="warning">{d.warning}</Notice>
          {refunded ? <p className="ls-hint">{d.owner}</p> : null}
        </>
      )}
    </CommandDialog>
  );
}

// ------------------------------------------------------------------------------------------- return cost

export function ReturnCostDialog({
  returnCase,
  onClose,
  onDone,
  onConflict,
}: Omit<DialogProps, 'order'> & { returnCase: OnlineStaffReturnCase }) {
  const { api, locale } = useWorkforce();
  const d = onlineFulfilmentDictionary(locale).returnCost;
  const separator = useMoneySeparator();
  const [cost, setCost] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const body = returnCostRequest(cost, note);
  return (
    <CommandDialog
      title={d.title}
      description={d.description}
      submit={d.submit}
      submitting={d.submitting}
      dirty={cost !== null || note !== ''}
      run={() =>
        body
          ? api.post<Order>(`/api/v1/online-orders/return-cases/${returnCase.id}/cost`, body)
          : null
      }
      onClose={onClose}
      onDone={onDone}
      onConflict={onConflict}
    >
      {({ checked, field }) => (
        <FormGrid cols={1}>
          <Field
            label={`${d.cost} (${returnCase.code})`}
            error={(checked && body === null) || field === 'costVnd' ? d.badCost : undefined}
            required
            full
          >
            {(control) => (
              <MoneyInput
                {...control}
                unit="₫"
                separator={separator}
                value={cost}
                onValueChange={setCost}
              />
            )}
          </Field>
          <Field label={d.note} full>
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                maxLength={NOTE_MAX}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
        </FormGrid>
      )}
    </CommandDialog>
  );
}
