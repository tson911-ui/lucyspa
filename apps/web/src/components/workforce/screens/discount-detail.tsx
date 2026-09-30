'use client';

import type { DiscountDetailResponse } from '@lucy-spa/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  benefitLabel,
  discountErrorMessage,
  emptyDiscountForm,
  formFromProgram,
  formatVnInstant,
  statusTone,
  versionRequestOf,
  type DiscountForm,
} from '../../../lib/workforce/discounts';
import { formatVnd } from '../../../lib/workforce/format';
import { useWorkforce } from '../session';
import { Badge, Empty, Field, Loading, Notice, PageHeader, Section, SubmitButton } from '../ui';
import { DiscountFormFields } from './discount-form';

type Feedback = { tone: 'success' | 'error'; text: string } | null;

/**
 * One discount program (Phase 4 Step 6): what is in force now, its immutable version history, pause/resume,
 * permanent early termination and its voucher codes. Every command carries the program `version`; the
 * server's answer replaces the page and a failure reloads it.
 */
export function DiscountDetailScreen({ id }: { id: string }) {
  const { api, t, locale, base } = useWorkforce();
  const d = t.discounts;
  const [program, setProgram] = useState<DiscountDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [working, setWorking] = useState<string | null>(null);
  const busy = useRef(false);
  const [form, setForm] = useState<DiscountForm>(emptyDiscountForm);
  const [showVersion, setShowVersion] = useState(false);
  const [reason, setReason] = useState('');
  const [voucherCode, setVoucherCode] = useState('');

  useEffect(() => {
    let active = true;
    api
      .get<DiscountDetailResponse>(`/api/v1/discounts/${id}`)
      .then((data) => {
        if (!active) return;
        setProgram(data);
        setForm(formFromProgram(data));
      })
      .catch((error: unknown) => active && setLoadError(error));
    return () => {
      active = false;
    };
  }, [api, id]);

  async function command(
    name: string,
    work: () => Promise<DiscountDetailResponse>,
    success: string,
  ): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setWorking(name);
    setFeedback(null);
    try {
      const result = await work();
      setProgram(result);
      setForm(formFromProgram(result));
      setFeedback({ tone: 'success', text: success });
      return true;
    } catch (error) {
      setFeedback({ tone: 'error', text: discountErrorMessage(error, t) });
      try {
        const fresh = await api.get<DiscountDetailResponse>(`/api/v1/discounts/${id}`);
        setProgram(fresh);
      } catch {
        // The failure above is already shown.
      }
      return false;
    } finally {
      busy.current = false;
      setWorking(null);
    }
  }

  if (loadError && !program) {
    return (
      <>
        <PageHeader title={d.title} />
        <Notice tone="error">{discountErrorMessage(loadError, t)}</Notice>
        <Link className="wf-button" href={`${base}/discounts`}>
          {d.back}
        </Link>
      </>
    );
  }
  if (!program) return <Loading t={t} />;

  const terminated = program.status === 'TERMINATED';
  const manage = program.permissions.manage && !terminated;
  const vouchers = program.permissions.createVouchers && program.requiresCode && !terminated;
  const current = program.current;
  const title = locale === 'vi' ? program.nameVi : program.nameEn;
  const limits = [
    current.usageLimitTotal === null ? null : fill(d.totalShort, { n: current.usageLimitTotal }),
    current.usageLimitPerCustomer === null
      ? null
      : fill(d.perCustomerShort, { n: current.usageLimitPerCustomer }),
  ].filter((entry): entry is string => entry !== null);

  function saveVersion(event: FormEvent) {
    event.preventDefault();
    const request = versionRequestOf(form, program!.version);
    if ('problem' in request) {
      setFeedback({ tone: 'error', text: d.problems[request.problem] });
      return;
    }
    void command(
      'version',
      () => api.post<DiscountDetailResponse>(`/api/v1/discounts/${id}/versions`, request.body),
      d.versionSaved,
    ).then((done) => done && setShowVersion(false));
  }

  function terminate(event: FormEvent) {
    event.preventDefault();
    const text = reason.normalize('NFC').trim();
    if (!text || [...text].length > 500) {
      setFeedback({ tone: 'error', text: d.terminateHint });
      return;
    }
    void command(
      'terminate',
      () =>
        api.post<DiscountDetailResponse>(`/api/v1/discounts/${id}/terminate`, {
          expectedVersion: program!.version,
          reason: text,
        }),
      d.terminated,
    ).then((done) => done && setReason(''));
  }

  function addVoucher(event: FormEvent) {
    event.preventDefault();
    const code = voucherCode.trim();
    void command(
      'voucher',
      () =>
        api.post<DiscountDetailResponse>(`/api/v1/discounts/${id}/vouchers`, code ? { code } : {}),
      d.voucherAdded,
    ).then((done) => done && setVoucherCode(''));
  }

  return (
    <>
      <PageHeader title={title}>
        <Badge tone={statusTone(program.status)}>{d.statuses[program.status]}</Badge>
      </PageHeader>
      <p className="wf-muted">
        {program.code} · {program.requiresCode ? d.codeProgram : d.autoProgram}
      </p>
      <p>
        <Link href={`${base}/discounts`}>{d.back}</Link>
      </p>
      {feedback ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null}
      {terminated ? (
        <Notice tone="info">
          {fill(d.terminatedInfo, { reason: program.terminatedReason ?? '—' })}
        </Notice>
      ) : null}

      <Section title={fill(d.current, { n: current.versionNo })}>
        <dl className="wf-summary">
          <div>
            <dt>{d.colBenefit}</dt>
            <dd>{benefitLabel(current, locale)}</dd>
          </div>
          <div>
            <dt>{d.colWindow}</dt>
            <dd>
              {formatVnInstant(current.validFrom, locale)} →{' '}
              {formatVnInstant(current.validUntil, locale)}
            </dd>
          </div>
          <div>
            <dt>{d.minSpend}</dt>
            <dd>{formatVnd(current.minSpendVnd, locale)}</dd>
          </div>
          <div>
            <dt>{d.scope}</dt>
            <dd>
              {d.scopes[current.scopeMode]}
              {current.scopeMode === 'SELECTED'
                ? ` (${current.serviceIds.length} ${d.services.toLowerCase()}, ${current.categoryIds.length} ${d.categories.toLowerCase()})`
                : ''}
            </dd>
          </div>
          <div>
            <dt>{d.limits}</dt>
            <dd>{limits.length > 0 ? limits.join(' · ') : d.unlimited}</dd>
          </div>
          <div>
            <dt>{d.colUsed}</dt>
            <dd>{program.redemptions}</dd>
          </div>
        </dl>
        {manage ? (
          <div className="wf-row-actions">
            <button
              type="button"
              className="wf-button"
              disabled={working !== null}
              onClick={() => setShowVersion(!showVersion)}
            >
              {d.newVersion}
            </button>
            <button
              type="button"
              className="wf-button"
              disabled={working !== null}
              onClick={() =>
                void command(
                  'active',
                  () =>
                    api.post<DiscountDetailResponse>(`/api/v1/discounts/${id}/active`, {
                      expectedVersion: program.version,
                      isActive: !program.isActive,
                    }),
                  program.isActive ? d.paused : d.resumed,
                )
              }
            >
              {program.isActive ? d.pause : d.resume}
            </button>
          </div>
        ) : null}
      </Section>

      {manage && showVersion ? (
        <Section title={d.newVersion}>
          <p className="wf-small">{d.newVersionHint}</p>
          <form onSubmit={saveVersion}>
            <DiscountFormFields form={form} setForm={setForm} mode="version" idPrefix="version" />
            <SubmitButton
              pending={working === 'version'}
              label={d.save}
              pendingLabel={d.saving}
              disabled={working !== null}
            />
          </form>
        </Section>
      ) : null}

      <Section title={d.vouchersTitle}>
        {!program.requiresCode ? <Empty>{d.noVoucherProgram}</Empty> : null}
        {program.requiresCode && program.vouchers.length === 0 ? (
          <Empty>{d.noVouchers}</Empty>
        ) : null}
        {program.vouchers.length > 0 ? (
          <table className="wf-table">
            <thead>
              <tr>
                <th>{d.vouchersTitle}</th>
                <th>{d.colStatus}</th>
                <th>{d.colUsed}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {program.vouchers.map((voucher) => (
                <tr key={voucher.id}>
                  <td data-label={d.vouchersTitle}>
                    <code>{voucher.code}</code>
                  </td>
                  <td data-label={d.colStatus}>
                    <Badge tone={voucher.isActive ? 'success' : 'neutral'}>
                      {voucher.isActive ? d.voucherOn : d.voucherOff}
                    </Badge>
                  </td>
                  <td data-label={d.colUsed}>{voucher.redemptions}</td>
                  <td>
                    {vouchers ? (
                      <button
                        type="button"
                        className="wf-button wf-button-quiet"
                        disabled={working !== null}
                        onClick={() =>
                          void command(
                            `voucher-${voucher.id}`,
                            () =>
                              api.post<DiscountDetailResponse>(
                                `/api/v1/discounts/${id}/vouchers/${voucher.id}/active`,
                                { expectedVersion: voucher.version, isActive: !voucher.isActive },
                              ),
                            d.voucherSaved,
                          )
                        }
                      >
                        {voucher.isActive ? d.deactivate : d.activate}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {vouchers ? (
          <form className="wf-inline-form" onSubmit={addVoucher}>
            <Field id="voucher-code" label={d.voucherCodeLabel}>
              <input
                id="voucher-code"
                maxLength={64}
                autoComplete="off"
                value={voucherCode}
                onChange={(event) => setVoucherCode(event.target.value.toUpperCase())}
              />
            </Field>
            <SubmitButton
              pending={working === 'voucher'}
              label={d.addVoucher}
              pendingLabel={d.saving}
              tone="quiet"
              disabled={working !== null}
            />
          </form>
        ) : null}
      </Section>

      <Section title={d.history}>
        <ol className="wf-plain-list">
          {program.versions.map((version) => (
            <li key={version.id}>
              <strong>{fill(d.versionN, { n: version.versionNo })}</strong> ·{' '}
              {benefitLabel(version, locale)} · {formatVnInstant(version.validFrom, locale)} →{' '}
              {formatVnInstant(version.validUntil, locale)} ·{' '}
              {formatVnd(version.minSpendVnd, locale)}
            </li>
          ))}
        </ol>
      </Section>

      {manage ? (
        <Section title={d.terminate}>
          <form onSubmit={terminate}>
            <Field id="terminate-reason" label={d.terminateReason} hint={d.terminateHint} required>
              <textarea
                id="terminate-reason"
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <SubmitButton
              pending={working === 'terminate'}
              label={d.terminate}
              pendingLabel={d.saving}
              tone="danger"
              disabled={working !== null}
            />
          </form>
        </Section>
      ) : null}
    </>
  );
}
