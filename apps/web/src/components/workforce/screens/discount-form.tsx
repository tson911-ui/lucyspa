'use client';

import type { ServiceCategoryListResponse, ServiceListResponse } from '@lucy-spa/contracts';
import type { Dispatch, SetStateAction } from 'react';
import type { DiscountForm } from '../../../lib/workforce/discounts';
import { useWorkforce } from '../session';
import { Field, Loading, useResource } from '../ui';

/**
 * The configuration fields of one discount program version (create and "new version" share them). Amounts are
 * plain digits, the percentage is a decimal percent, the validity is entered in Vietnam time. Nothing is
 * calculated here: the API validates every field again and the database has its own CHECKs.
 */
export function DiscountFormFields({
  form,
  setForm,
  mode,
  idPrefix,
}: {
  form: DiscountForm;
  setForm: Dispatch<SetStateAction<DiscountForm>>;
  mode: 'create' | 'version';
  idPrefix: string;
}) {
  const { api, t, locale } = useWorkforce();
  const services = useResource(() => api.get<ServiceListResponse>('/api/v1/services'), [api]);
  const categories = useResource(
    () => api.get<ServiceCategoryListResponse>('/api/v1/service-categories'),
    [api],
  );
  const d = t.discounts;
  const change = (patch: Partial<DiscountForm>) => setForm((current) => ({ ...current, ...patch }));
  const toggle = (key: 'serviceIds' | 'categoryIds', id: string) =>
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(id)
        ? current[key].filter((entry) => entry !== id)
        : [...current[key], id],
    }));
  const name = (vi: string, en: string) => (locale === 'vi' ? vi : en);
  const id = (field: string) => `${idPrefix}-${field}`;

  return (
    <>
      {mode === 'create' ? (
        <>
          <Field id={id('code')} label={d.code} hint={d.codeHint} required>
            <input
              id={id('code')}
              required
              maxLength={64}
              autoComplete="off"
              value={form.code}
              onChange={(event) => change({ code: event.target.value.toUpperCase() })}
            />
          </Field>
          <div className="wf-field">
            <label htmlFor={id('requires')}>
              <input
                id={id('requires')}
                type="checkbox"
                checked={form.requiresCode}
                onChange={(event) => change({ requiresCode: event.target.checked })}
              />{' '}
              {d.requiresCode}
            </label>
            <p className="wf-hint">{d.requiresCodeHint}</p>
          </div>
        </>
      ) : null}
      <Field id={id('nameVi')} label={d.nameVi} required>
        <input
          id={id('nameVi')}
          required
          maxLength={200}
          value={form.nameVi}
          onChange={(event) => change({ nameVi: event.target.value })}
        />
      </Field>
      <Field id={id('nameEn')} label={d.nameEn} required>
        <input
          id={id('nameEn')}
          required
          maxLength={200}
          value={form.nameEn}
          onChange={(event) => change({ nameEn: event.target.value })}
        />
      </Field>
      <Field id={id('kind')} label={d.kind}>
        <select
          id={id('kind')}
          value={form.kind}
          onChange={(event) => change({ kind: event.target.value as DiscountForm['kind'] })}
        >
          <option value="PERCENT">{d.kinds.PERCENT}</option>
          <option value="FIXED_AMOUNT">{d.kinds.FIXED_AMOUNT}</option>
        </select>
      </Field>
      {form.kind === 'PERCENT' ? (
        <Field id={id('percent')} label={d.percent} hint={d.percentHint} required>
          <input
            id={id('percent')}
            inputMode="decimal"
            autoComplete="off"
            maxLength={6}
            value={form.percent}
            onChange={(event) => change({ percent: event.target.value.replace(',', '.') })}
          />
        </Field>
      ) : (
        <Field id={id('amount')} label={d.fixedAmount} required>
          <input
            id={id('amount')}
            inputMode="numeric"
            autoComplete="off"
            maxLength={18}
            value={form.fixedAmount}
            onChange={(event) => change({ fixedAmount: event.target.value })}
          />
        </Field>
      )}
      <Field id={id('from')} label={d.validFrom} hint={d.timeNote} required>
        <input
          id={id('from')}
          type="datetime-local"
          value={form.validFrom}
          onChange={(event) => change({ validFrom: event.target.value })}
        />
      </Field>
      <Field id={id('until')} label={d.validUntil} hint={d.timeNote} required>
        <input
          id={id('until')}
          type="datetime-local"
          value={form.validUntil}
          onChange={(event) => change({ validUntil: event.target.value })}
        />
      </Field>
      <Field id={id('min')} label={d.minSpend} hint={d.minSpendHint}>
        <input
          id={id('min')}
          inputMode="numeric"
          autoComplete="off"
          maxLength={18}
          value={form.minSpend}
          onChange={(event) => change({ minSpend: event.target.value })}
        />
      </Field>
      <Field id={id('scope')} label={d.scope}>
        <select
          id={id('scope')}
          value={form.scopeMode}
          onChange={(event) =>
            change({ scopeMode: event.target.value as DiscountForm['scopeMode'] })
          }
        >
          <option value="ALL_SERVICES">{d.scopes.ALL_SERVICES}</option>
          <option value="SELECTED">{d.scopes.SELECTED}</option>
        </select>
      </Field>
      {form.scopeMode === 'SELECTED' ? (
        <>
          {services.loading || categories.loading ? <Loading t={t} /> : null}
          <fieldset className="wf-fieldset">
            <legend>{d.categories}</legend>
            {categories.data?.categories.map((category) => (
              <label key={category.id} className="wf-check">
                <input
                  type="checkbox"
                  checked={form.categoryIds.includes(category.id)}
                  onChange={() => toggle('categoryIds', category.id)}
                />{' '}
                {name(category.nameVi, category.nameEn)}
              </label>
            ))}
          </fieldset>
          <fieldset className="wf-fieldset">
            <legend>{d.services}</legend>
            {services.data?.services.map((service) => (
              <label key={service.id} className="wf-check">
                <input
                  type="checkbox"
                  checked={form.serviceIds.includes(service.id)}
                  onChange={() => toggle('serviceIds', service.id)}
                />{' '}
                {name(service.nameVi, service.nameEn)}
              </label>
            ))}
          </fieldset>
        </>
      ) : null}
      <Field id={id('limitTotal')} label={d.limitTotal}>
        <input
          id={id('limitTotal')}
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          value={form.limitTotal}
          onChange={(event) => change({ limitTotal: event.target.value })}
        />
      </Field>
      <Field id={id('limitCustomer')} label={d.limitPerCustomer} hint={d.limitHint}>
        <input
          id={id('limitCustomer')}
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          value={form.limitPerCustomer}
          onChange={(event) => change({ limitPerCustomer: event.target.value })}
        />
      </Field>
    </>
  );
}
