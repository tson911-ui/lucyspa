'use client';

import type {
  DiscountScopeName,
  ServiceCategoryListResponse,
  ServiceListResponse,
} from '@lucy-spa/contracts';
import { CheckField, Field, FormGrid, FormSection, Select, Stack, TextInput } from '@lucy-spa/ui';
import type { Dispatch, SetStateAction } from 'react';
import {
  scopeHasProducts,
  scopeHasServices,
  type DiscountForm,
} from '../../../lib/workforce/discounts';
import { useWorkforce } from '../session';
import { Loading, useResource } from '../ui';
import { PickerGroup, ProductTargetsFields, useProductCatalog } from './discount-targets';

/**
 * The configuration fields of one discount program version, grouped in sections (program, discount,
 * validity, scope, limits). Create (its own page, `columns={2}`) and "new version" (a drawer,
 * `columns={1}`) share them. Amounts are plain digits, the percentage is a decimal percent, the validity
 * is entered in Vietnam time. Nothing is calculated here: the API validates every field again and the
 * database has its own CHECKs.
 */
export function DiscountFormFields({
  form,
  setForm,
  mode,
  columns = 1,
}: {
  form: DiscountForm;
  setForm: Dispatch<SetStateAction<DiscountForm>>;
  mode: 'create' | 'version';
  columns?: 1 | 2;
}) {
  const { api, t, locale } = useWorkforce();
  const withServices = scopeHasServices(form.scope);
  const withProducts = scopeHasProducts(form.scope);
  const selected = form.scopeMode === 'SELECTED';
  // The lists are read only for the kinds of target the form shows.
  const services = useResource(
    () =>
      withServices && selected
        ? api.get<ServiceListResponse>('/api/v1/services')
        : Promise.resolve(null),
    [api, withServices && selected],
  );
  const categories = useResource(
    () =>
      withServices && selected
        ? api.get<ServiceCategoryListResponse>('/api/v1/service-categories')
        : Promise.resolve(null),
    [api, withServices && selected],
  );
  const catalog = useProductCatalog(withProducts && selected);
  const d = t.discounts;
  const change = (patch: Partial<DiscountForm>) => setForm((current) => ({ ...current, ...patch }));
  const toggle = (
    key: 'serviceIds' | 'categoryIds' | 'brandIds' | 'productCategoryIds',
    id: string,
  ) =>
    setForm((current) => ({
      ...current,
      [key]: current[key].includes(id)
        ? current[key].filter((entry) => entry !== id)
        : [...current[key], id],
    }));
  const name = (vi: string, en: string) => (locale === 'vi' ? vi : en);

  return (
    <Stack gap="page">
      <FormSection title={d.sectionProgram}>
        <FormGrid cols={columns}>
          {mode === 'create' ? (
            <>
              <Field label={d.code} hint={d.codeHint} required width="lg" full>
                {(control) => (
                  <TextInput
                    {...control}
                    maxLength={64}
                    autoComplete="off"
                    value={form.code}
                    onChange={(event) => change({ code: event.target.value.toUpperCase() })}
                  />
                )}
              </Field>
              <div className="ls-field-full">
                <CheckField
                  checked={form.requiresCode}
                  onChange={(event) => change({ requiresCode: event.target.checked })}
                  label={d.requiresCode}
                  hint={d.requiresCodeHint}
                />
              </div>
            </>
          ) : null}
          <Field label={d.nameVi} required>
            {(control) => (
              <TextInput
                {...control}
                maxLength={200}
                value={form.nameVi}
                onChange={(event) => change({ nameVi: event.target.value })}
              />
            )}
          </Field>
          <Field label={d.nameEn} required>
            {(control) => (
              <TextInput
                {...control}
                maxLength={200}
                value={form.nameEn}
                onChange={(event) => change({ nameEn: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
      </FormSection>

      <FormSection title={d.sectionBenefit}>
        <FormGrid cols={columns}>
          <Field label={d.kind}>
            {(control) => (
              <Select
                {...control}
                value={form.kind}
                options={[
                  { value: 'PERCENT', label: d.kinds.PERCENT },
                  { value: 'FIXED_AMOUNT', label: d.kinds.FIXED_AMOUNT },
                ]}
                onChange={(event) => change({ kind: event.target.value as DiscountForm['kind'] })}
              />
            )}
          </Field>
          {form.kind === 'PERCENT' ? (
            <Field label={d.percent} hint={d.percentHint} required>
              {(control) => (
                <TextInput
                  {...control}
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={6}
                  value={form.percent}
                  onChange={(event) => change({ percent: event.target.value.replace(',', '.') })}
                />
              )}
            </Field>
          ) : (
            <Field label={d.fixedAmount} required>
              {(control) => (
                <TextInput
                  {...control}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={18}
                  value={form.fixedAmount}
                  onChange={(event) => change({ fixedAmount: event.target.value })}
                />
              )}
            </Field>
          )}
          <Field label={d.minSpend} hint={d.minSpendHint}>
            {(control) => (
              <TextInput
                {...control}
                inputMode="numeric"
                autoComplete="off"
                maxLength={18}
                value={form.minSpend}
                onChange={(event) => change({ minSpend: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
      </FormSection>

      <FormSection title={d.sectionWindow} description={d.timeNote}>
        <FormGrid cols={columns}>
          <Field label={d.validFrom} required>
            {(control) => (
              <TextInput
                {...control}
                type="datetime-local"
                value={form.validFrom}
                onChange={(event) => change({ validFrom: event.target.value })}
              />
            )}
          </Field>
          <Field label={d.validUntil} required>
            {(control) => (
              <TextInput
                {...control}
                type="datetime-local"
                value={form.validUntil}
                onChange={(event) => change({ validUntil: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
      </FormSection>

      <FormSection title={d.sectionScope}>
        <FormGrid cols={columns}>
          <Field label={d.scope}>
            {(control) => (
              <Select
                {...control}
                value={form.scope}
                options={(['SERVICES', 'PRODUCTS', 'BOTH'] as const).map((value) => ({
                  value,
                  label: d.scopeKinds[value],
                }))}
                onChange={(event) => change({ scope: event.target.value as DiscountScopeName })}
              />
            )}
          </Field>
          <Field label={d.selection}>
            {(control) => (
              <Select
                {...control}
                value={form.scopeMode}
                options={[
                  { value: 'ALL_SERVICES', label: d.allOf[form.scope] },
                  { value: 'SELECTED', label: d.selectedOnly },
                ]}
                onChange={(event) =>
                  change({ scopeMode: event.target.value as DiscountForm['scopeMode'] })
                }
              />
            )}
          </Field>
        </FormGrid>
        {selected && withServices ? (
          services.loading || categories.loading ? (
            <Loading t={t} />
          ) : (
            <FormGrid cols={columns}>
              <PickerGroup
                title={d.categories}
                empty={d.pickerNone}
                options={(categories.data?.categories ?? []).map((category) => ({
                  id: category.id,
                  label: name(category.nameVi, category.nameEn),
                }))}
                selected={form.categoryIds}
                onToggle={(id) => toggle('categoryIds', id)}
              />
              <PickerGroup
                title={d.services}
                empty={d.pickerNone}
                options={(services.data?.services ?? []).map((service) => ({
                  id: service.id,
                  label: name(service.nameVi, service.nameEn),
                }))}
                selected={form.serviceIds}
                onToggle={(id) => toggle('serviceIds', id)}
              />
            </FormGrid>
          )
        ) : null}
        {selected && withProducts ? (
          <ProductTargetsFields
            form={form}
            catalog={catalog}
            columns={columns}
            toggle={toggle}
            setProducts={(productIds) => change({ productIds })}
          />
        ) : null}
      </FormSection>

      <FormSection title={d.sectionLimits} description={d.limitHint}>
        <FormGrid cols={columns}>
          <Field label={d.limitTotal}>
            {(control) => (
              <TextInput
                {...control}
                inputMode="numeric"
                autoComplete="off"
                maxLength={10}
                value={form.limitTotal}
                onChange={(event) => change({ limitTotal: event.target.value })}
              />
            )}
          </Field>
          <Field label={d.limitPerCustomer}>
            {(control) => (
              <TextInput
                {...control}
                inputMode="numeric"
                autoComplete="off"
                maxLength={10}
                value={form.limitPerCustomer}
                onChange={(event) => change({ limitPerCustomer: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
      </FormSection>
    </Stack>
  );
}
