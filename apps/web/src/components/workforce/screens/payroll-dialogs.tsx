'use client';

import type {
  PayManualItemKindName,
  PayRunDetailResponse,
  PayRunItemView,
  PayRunLineView,
  PayslipListResponse,
  SalariesResponse,
} from '@lucy-spa/contracts';
import { PAY_MANUAL_ITEM_KINDS } from '@lucy-spa/contracts';
import {
  Checkbox,
  DateTextInput,
  focusFirstInvalid,
  Field,
  FormDialog,
  FormDrawer,
  FormGrid,
  Select,
  Stack,
  Textarea,
  TextInput,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { payrollDictionary } from '../../../i18n/payroll';
import { fill } from '../../../i18n/workforce';
import { signedVnd, vndNumber } from '../../../lib/workforce/cash';
import { formatDate } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  closeBlockers,
  itemBody,
  itemProblems,
  monthLabel,
  paymentDayWindow,
  payTotal,
  reasonMissing,
  validPaymentDay,
  type ItemDraft,
} from '../../../lib/workforce/payroll';
import { useResource } from '../ui';
import { useWorkforce } from '../session';
import { Notice } from '../ui';
import { usePayrollCommand } from './payroll-command';

/** The dialogs and drawers of one payroll run (Phase 7 P7-15). Every refusal is shown inside the dialog; the API decides all of it again. */

/** After a refused submit, focus the first field marked invalid once React has drawn the errors (wig "focus first error"). */
function focusInvalidField(): void {
  if (typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    focusFirstInvalid(dialogs[dialogs.length - 1] ?? document);
  });
}

export function PaymentDayDialog({
  run,
  onDone,
  onClose,
}: {
  run: PayRunDetailResponse['run'];
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const p = payrollDictionary(locale);
  const window = paymentDayWindow(run.month);
  const [day, setDay] = useState(run.paymentDay ?? '');
  const [checked, setChecked] = useState(false);
  const command = usePayrollCommand();
  const invalid = checked && !validPaymentDay(day, run.month);
  async function submit() {
    setChecked(true);
    if (!validPaymentDay(day, run.month)) return focusInvalidField();
    await command.run(
      `/api/v1/pay/runs/${run.id}/payment-day`,
      { expectedVersion: run.version, paymentDay: day },
      onDone,
    );
  }
  return (
    <FormDialog
      title={p.run.dayTitle}
      description={p.run.dayDescription}
      labels={{ ...formOverlayLabels(t, p.run.daySubmit), submitting: p.run.daySubmitting }}
      busy={command.pending}
      dirty={day !== (run.paymentDay ?? '')}
      error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field
          label={p.common.paymentDay}
          error={invalid ? p.common.fieldErrors.day : undefined}
          required
          full
        >
          {(control) => (
            <DateTextInput
              {...control}
              name="day"
              min={window.min}
              max={window.max}
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

export function ItemDialog({
  run,
  lines,
  employeeId,
  onDone,
  onClose,
}: {
  run: PayRunDetailResponse['run'];
  lines: readonly PayRunLineView[];
  /** The person the dialog was opened for, or null to choose one. */
  employeeId: string | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const p = payrollDictionary(locale);
  const x = p.run;
  // Anyone who can be paid can be given a bonus: the people of the draft first, then the official employees.
  const people = useResource(() => api.get<SalariesResponse>('/api/v1/pay/salaries'), [api]);
  const options = new Map<string, string>();
  for (const line of lines) options.set(line.employee.id, line.employee.name);
  for (const person of people.data?.items ?? [])
    options.set(person.employee.id, person.employee.name);
  const [draft, setDraft] = useState<ItemDraft>({
    employeeUserId: employeeId ?? '',
    kind: 'BONUS',
    amount: '',
    reason: '',
  });
  const [checked, setChecked] = useState(false);
  const command = usePayrollCommand();
  const problems = itemProblems(draft);
  const invalid = (name: 'employee' | 'amount' | 'reason') =>
    checked && problems.includes(name) ? p.common.fieldErrors[name] : undefined;
  const name = options.get(draft.employeeUserId) ?? '';
  async function submit() {
    setChecked(true);
    const body = itemBody(draft, command.requestId);
    if (!body) return focusInvalidField();
    await command.run(`/api/v1/pay/runs/${run.id}/items`, body, onDone);
  }
  return (
    <FormDialog
      title={x.itemTitle}
      description={name ? fill(x.itemDescription, { name }) : undefined}
      labels={{ ...formOverlayLabels(t, x.itemSubmit), submitting: x.itemSubmitting }}
      busy={command.pending}
      dirty={draft.amount !== '' || draft.reason !== ''}
      error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label={x.itemEmployee} error={invalid('employee')} required full>
          {(control) => (
            <Select
              {...control}
              value={draft.employeeUserId}
              placeholder={p.common.placeholders.employee}
              options={[...options].map(([value, label]) => ({ value, label }))}
              onChange={(event) => setDraft({ ...draft, employeeUserId: event.target.value })}
            />
          )}
        </Field>
        <Field label={x.itemKind} required full>
          {(control) => (
            <Select
              {...control}
              value={draft.kind}
              options={PAY_MANUAL_ITEM_KINDS.map((kind) => ({
                value: kind,
                label: x.itemKinds[kind],
              }))}
              onChange={(event) =>
                setDraft({ ...draft, kind: event.target.value as PayManualItemKindName })
              }
            />
          )}
        </Field>
        <Field label={x.itemAmount} hint={x.itemAmountHint} error={invalid('amount')} required full>
          {(control) => (
            <TextInput
              {...control}
              name="amount"
              inputMode="numeric"
              autoComplete="off"
              maxLength={20}
              value={draft.amount}
              onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
            />
          )}
        </Field>
        <Field label={p.common.reason} error={invalid('reason')} required full>
          {(control) => (
            <Textarea
              {...control}
              name="reason"
              autoComplete="off"
              rows={3}
              maxLength={500}
              value={draft.reason}
              onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

export function VoidDialog({
  run,
  item,
  name,
  onDone,
  onClose,
}: {
  run: PayRunDetailResponse['run'];
  item: PayRunItemView;
  name: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const p = payrollDictionary(locale);
  const x = p.run;
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const command = usePayrollCommand();
  async function submit() {
    setChecked(true);
    if (reasonMissing(reason)) return focusInvalidField();
    await command.run(
      `/api/v1/pay/runs/${run.id}/items/${item.id}/void`,
      { expectedVersion: run.version, reason: reason.trim() },
      onDone,
    );
  }
  return (
    <FormDialog
      title={x.voidTitle}
      description={fill(x.voidDescription, {
        kind: p.kinds[item.kind].toLocaleLowerCase(locale),
        amount: signedVnd(vndNumber(item.amountVnd), locale),
        name,
      })}
      labels={{ ...formOverlayLabels(t, x.voidSubmit), submitting: x.voidSubmitting }}
      busy={command.pending}
      dirty={reason !== ''}
      error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field
          label={p.common.reason}
          error={checked && reasonMissing(reason) ? p.common.fieldErrors.reason : undefined}
          required
          full
        >
          {(control) => (
            <Textarea
              {...control}
              name="reason"
              autoComplete="off"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

export function CloseDialog({
  view,
  onDone,
  onClose,
}: {
  view: PayRunDetailResponse;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const p = payrollDictionary(locale);
  const x = p.run;
  const command = usePayrollCommand({ reauth: true });
  const blockers = closeBlockers(view);
  async function submit() {
    if (blockers.length > 0) return;
    await command.run(
      `/api/v1/pay/runs/${view.run.id}/close`,
      { expectedVersion: view.run.version },
      onDone,
    );
  }
  return (
    <>
      <FormDialog
        suspended={command.asking}
        title={fill(x.closeTitle, { month: monthLabel(view.run.month) })}
        description={x.closeDescription}
        labels={{ ...formOverlayLabels(t, x.closeSubmit), submitting: x.closeSubmitting }}
        busy={command.pending}
        dirty={false}
        submitDisabled={blockers.length > 0}
        error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
        onClose={onClose}
        onSubmit={submit}
      >
        <Stack gap="field">
          <p>
            {fill(x.closeFigures, {
              net: signedVnd(vndNumber(view.totals.payVnd), locale),
              tips: signedVnd(vndNumber(view.totals.tipsVnd), locale),
              people: view.totals.people,
              day: view.run.paymentDay ? formatDate(view.run.paymentDay, locale) : '—',
            })}
          </p>
          {blockers.length > 0 ? (
            <Notice tone="warning">
              {blockers.map((key) => (
                <span key={key}>{x.closeBlocked[key]} </span>
              ))}
            </Notice>
          ) : (
            <p className="ls-hint">{p.common.password}</p>
          )}
        </Stack>
      </FormDialog>
      {command.dialog}
    </>
  );
}

export function PayDrawer({
  view,
  slips,
  onDone,
  onClose,
}: {
  view: PayRunDetailResponse;
  slips: PayslipListResponse;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const p = payrollDictionary(locale);
  const x = p.run;
  const pending = slips.items.filter((slip) => slip.status === 'PENDING');
  // The first fund that holds all that is unpaid, else the first one.
  const unpaid = pending.reduce(
    (sum, slip) => sum + BigInt(slip.netVnd) + BigInt(slip.tipsVnd),
    0n,
  );
  const [fundId, setFundId] = useState(
    (slips.funds.find((fund) => BigInt(fund.balanceVnd) >= unpaid) ?? slips.funds[0])?.id ?? '',
  );
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set(pending.map((slip) => slip.id)),
  );
  const [checked, setChecked] = useState(false);
  const command = usePayrollCommand({ reauth: true });
  const everyone = selected.size === pending.length;
  const total = payTotal(slips.items, selected);
  const missing = checked && (fundId === '' || selected.size === 0);
  async function submit() {
    setChecked(true);
    if (fundId === '' || selected.size === 0) return focusInvalidField();
    if (!slips.payable) return;
    await command.run(
      `/api/v1/pay/runs/${view.run.id}/pay`,
      {
        expectedVersion: view.run.version,
        fundId,
        payslipIds: everyone ? null : [...selected],
        clientRequestId: command.requestId,
      },
      onDone,
    );
  }
  return (
    <>
      <FormDrawer
        suspended={command.asking}
        title={fill(x.payTitle, { month: monthLabel(view.run.month) })}
        labels={{ ...formOverlayLabels(t, x.paySubmit), submitting: x.paySubmitting }}
        busy={command.pending}
        dirty={false}
        error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
        onClose={onClose}
        onSubmit={submit}
      >
        <p className="ls-hint">{x.payDescription}</p>
        {!slips.payable ? (
          <Notice tone="warning">
            {fill(x.payNotYet, {
              day: view.run.paymentDay ? formatDate(view.run.paymentDay, locale) : '—',
            })}
          </Notice>
        ) : null}
        <FormGrid>
          <Field
            label={x.payFund}
            error={missing && fundId === '' ? p.common.fieldErrors.fund : undefined}
            required
            full
          >
            {(control) => (
              <Select
                {...control}
                value={fundId}
                placeholder={p.common.placeholders.fund}
                options={slips.funds.map((fund) => ({
                  value: fund.id,
                  label: fill(x.payFundOption, {
                    name: fund.name,
                    balance: signedVnd(vndNumber(fund.balanceVnd), locale),
                  }),
                }))}
                onChange={(event) => setFundId(event.target.value)}
              />
            )}
          </Field>
        </FormGrid>
        <Stack gap="field">
          <Checkbox
            label={x.payAll}
            checked={everyone}
            onChange={(event) =>
              setSelected(
                event.target.checked ? new Set(pending.map((slip) => slip.id)) : new Set(),
              )
            }
          />
          {pending.map((slip) => (
            <Checkbox
              key={slip.id}
              label={`${slip.employee.name}: ${signedVnd(vndNumber(slip.netVnd), locale)}${
                slip.tipsVnd !== '0'
                  ? ` + ${signedVnd(vndNumber(slip.tipsVnd), locale)} ${p.common.tips.toLocaleLowerCase(locale)}`
                  : ''
              }`}
              checked={selected.has(slip.id)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(slip.id);
                else next.delete(slip.id);
                setSelected(next);
              }}
            />
          ))}
        </Stack>
        <p>
          <strong>{fill(x.payTotal, { amount: signedVnd(Number(total), locale) })}</strong>
        </p>
        <p className="ls-hint">{p.common.password}</p>
      </FormDrawer>
      {command.dialog}
    </>
  );
}

export function ReverseDialog({
  slipId,
  name,
  version,
  onDone,
  onClose,
}: {
  slipId: string;
  name: string;
  version: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const p = payrollDictionary(locale);
  const x = p.run;
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const command = usePayrollCommand({ reauth: true });
  async function submit() {
    setChecked(true);
    if (reasonMissing(reason)) return focusInvalidField();
    await command.run(
      `/api/v1/pay/payslips/${slipId}/reverse`,
      { expectedVersion: version, reason: reason.trim() },
      onDone,
    );
  }
  return (
    <>
      <FormDialog
        suspended={command.asking}
        title={x.reverseTitle}
        description={`${name}. ${x.reverseDescription}`}
        labels={{ ...formOverlayLabels(t, x.reverseSubmit), submitting: x.reverseSubmitting }}
        busy={command.pending}
        dirty={reason !== ''}
        error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
        onClose={onClose}
        onSubmit={submit}
      >
        <FormGrid>
          <Field
            label={x.reverseReason}
            error={checked && reasonMissing(reason) ? p.common.fieldErrors.reason : undefined}
            required
            full
          >
            {(control) => (
              <Textarea
                {...control}
                name="reason"
                autoComplete="off"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
        </FormGrid>
      </FormDialog>
      {command.dialog}
    </>
  );
}
