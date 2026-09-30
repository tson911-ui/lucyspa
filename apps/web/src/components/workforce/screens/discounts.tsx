'use client';

import type { DiscountDetailResponse, DiscountListResponse } from '@lucy-spa/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  benefitLabel,
  createRequestOf,
  discountErrorMessage,
  emptyDiscountForm,
  formatVnInstant,
  statusTone,
  type DiscountForm,
} from '../../../lib/workforce/discounts';
import { canGlobal } from '../../../lib/workforce/permissions';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  Section,
  SubmitButton,
  useResource,
} from '../ui';
import { DiscountFormFields } from './discount-form';

/**
 * "Ưu đãi" (Phase 4 Step 6): the Owner's discount programs. Programs are never deleted; "editing" appends an
 * immutable version and early termination is permanent. The POS never types a percentage or an amount.
 */
export function DiscountsScreen() {
  const { api, t, locale, base } = useWorkforce();
  const { account } = useAccount();
  const router = useRouter();
  const d = t.discounts;
  const allowed = canGlobal(account, 'MANAGE_DISCOUNTS') || canGlobal(account, 'CREATE_VOUCHERS');
  const list = useResource(
    () => (allowed ? api.get<DiscountListResponse>('/api/v1/discounts') : Promise.resolve(null)),
    [api, allowed],
  );
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<DiscountForm>(emptyDiscountForm);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  if (!allowed) {
    return (
      <>
        <PageHeader title={d.title} intro={d.intro} />
        <Empty>{d.noAccess}</Empty>
      </>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const request = createRequestOf(form);
    if ('problem' in request) {
      setMessage({ tone: 'error', text: d.problems[request.problem] });
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const created = await api.post<DiscountDetailResponse>('/api/v1/discounts', request.body);
      setMessage({ tone: 'success', text: d.created });
      setCreating(false);
      setForm(emptyDiscountForm());
      router.push(`${base}/discounts/${created.id}`);
    } catch (error) {
      setMessage({ tone: 'error', text: discountErrorMessage(error, t) });
    } finally {
      setPending(false);
    }
  }

  const canManage = list.data?.permissions.manage ?? false;
  return (
    <>
      <PageHeader title={d.title} intro={d.intro}>
        {canManage ? (
          <button
            type="button"
            className="wf-button wf-button-primary"
            onClick={() => setCreating(!creating)}
          >
            {d.create}
          </button>
        ) : null}
      </PageHeader>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {creating && canManage ? (
        <Section title={d.createTitle}>
          <form onSubmit={(event) => void submit(event)}>
            <DiscountFormFields form={form} setForm={setForm} mode="create" idPrefix="new" />
            <SubmitButton pending={pending} label={d.save} pendingLabel={d.saving} />
          </form>
        </Section>
      ) : null}
      {list.loading && !list.data ? <Loading t={t} /> : null}
      {list.error ? (
        <ErrorState t={t} error={list.error} onRetry={() => void list.reload()} />
      ) : null}
      {list.data && list.data.discounts.length === 0 ? <Empty>{d.none}</Empty> : null}
      {list.data && list.data.discounts.length > 0 ? (
        <table className="wf-table">
          <thead>
            <tr>
              <th>{d.colProgram}</th>
              <th>{d.colBenefit}</th>
              <th>{d.colWindow}</th>
              <th>{d.colStatus}</th>
              <th>{d.colUsed}</th>
            </tr>
          </thead>
          <tbody>
            {list.data.discounts.map((program) => (
              <tr key={program.id}>
                <td data-label={d.colProgram}>
                  <Link href={`${base}/discounts/${program.id}`}>
                    {locale === 'vi' ? program.nameVi : program.nameEn}
                  </Link>
                  <br />
                  <span className="wf-small">
                    {program.code} · {program.requiresCode ? d.codeProgram : d.autoProgram}
                  </span>
                </td>
                <td data-label={d.colBenefit}>{benefitLabel(program.current, locale)}</td>
                <td data-label={d.colWindow}>
                  {formatVnInstant(program.current.validFrom, locale)} →{' '}
                  {formatVnInstant(program.current.validUntil, locale)}
                </td>
                <td data-label={d.colStatus}>
                  <Badge tone={statusTone(program.status)}>{d.statuses[program.status]}</Badge>
                </td>
                <td data-label={d.colUsed}>
                  {program.redemptions}
                  {program.requiresCode
                    ? ` · ${fill(d.codeCount, { n: program.voucherCount })}`
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
