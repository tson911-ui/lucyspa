'use client';

import type { ServicePricingUnit } from '@lucy-spa/contracts';
import { Field, FormGrid, Select, TextInput } from '@lucy-spa/ui';
import type { Locale } from '../../../i18n/locales';
import type { WorkforceDictionary } from '../../../i18n/workforce';
import {
  formatServicePrice,
  priceProblem,
  PRICING_UNITS,
  quantityProblem,
  type PriceForm,
} from '../../../lib/workforce/pricing';
import { Notice } from '../ui';

/**
 * Minimum price, maximum price and pricing unit, shared by the create form and the price
 * command. An exact price uses the same amount twice. Renders its own `FormGrid`, so it can sit
 * directly in a form.
 */
export function PriceFields({
  idPrefix,
  value,
  onChange,
  t,
  locale,
}: {
  idPrefix: string;
  value: PriceForm;
  onChange: (next: PriceForm) => void;
  t: WorkforceDictionary;
  locale: Locale;
}) {
  const problem = priceProblem(value);
  // An untouched form is not an error: the fields turn red only once something was typed.
  const typed = value.priceVnd !== '' || value.priceMaxVnd !== '';
  const amount = (key: 'priceVnd' | 'priceMaxVnd', label: string, hint: string) => (
    <Field id={`${idPrefix}-${key}`} label={label} required hint={hint}>
      {(control) => (
        <TextInput
          {...control}
          inputMode="numeric"
          pattern="0|[1-9][0-9]{0,17}"
          invalid={problem !== null && typed}
          value={value[key]}
          onChange={(event) => onChange({ ...value, [key]: event.target.value.trim() })}
        />
      )}
    </Field>
  );
  return (
    <>
      <FormGrid cols={2}>
        {amount('priceVnd', t.services.priceMin, t.services.priceHint)}
        {amount('priceMaxVnd', t.services.priceMax, t.services.priceRangeHint)}
        <Field id={`${idPrefix}-unit`} label={t.services.pricingUnit} required>
          {(control) => (
            <Select
              {...control}
              value={value.pricingUnit}
              options={PRICING_UNITS.map((unit) => ({
                value: unit,
                label: t.services.pricingUnits[unit],
              }))}
              onChange={(event) =>
                onChange({ ...value, pricingUnit: event.target.value as ServicePricingUnit })
              }
            />
          )}
        </Field>
        {value.pricingUnit === 'PER_NAIL' ? (
          <Field
            id={`${idPrefix}-maxQuantity`}
            label={t.services.maxQuantity}
            hint={t.services.maxQuantityHint}
            required
            full
          >
            {(control) => (
              <TextInput
                {...control}
                inputMode="numeric"
                pattern="[1-9][0-9]{0,9}"
                invalid={quantityProblem(value) !== null}
                value={value.maxQuantity}
                onChange={(event) => onChange({ ...value, maxQuantity: event.target.value.trim() })}
              />
            )}
          </Field>
        ) : null}
      </FormGrid>
      {problem === null ? (
        <p className="ls-hint">{formatServicePrice(value, t, locale)}</p>
      ) : typed ? (
        <Notice tone="error">
          {problem === 'maxBeforeMin' ? t.services.priceMaxBeforeMin : t.services.priceInvalid}
        </Notice>
      ) : null}
    </>
  );
}
