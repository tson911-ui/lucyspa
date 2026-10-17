'use client';

import type { ServicePricingUnit } from '@lucy-spa/contracts';
import { Field, FormGrid, Select, TextInput, focusFirstInvalid } from '@lucy-spa/ui';
import type { Locale } from '../../../i18n/locales';
import type { WorkforceDictionary } from '../../../i18n/workforce';
import { isVndInput } from '../../../lib/workforce/format';
import {
  formatServicePrice,
  priceProblem,
  PRICING_UNITS,
  quantityProblem,
  type PriceForm,
} from '../../../lib/workforce/pricing';

type PriceField = 'priceVnd' | 'priceMaxVnd' | 'maxQuantity';

/**
 * After a refused submit the errors render on the next frame; then the first invalid field of the open dialog or drawer (else of
 * the page) takes focus (validate on submit, the button never disabled to signal "incomplete").
 */
export function focusFirstInvalidSoon(): void {
  requestAnimationFrame(() => {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    focusFirstInvalid(dialogs[dialogs.length - 1] ?? document);
  });
}

/**
 * The message each price field shows: a malformed amount at its own field, "max before min" at the maximum, a bad nail limit at
 * the limit (the API checks the same rules again).
 */
export function priceErrors(
  value: PriceForm,
  t: WorkforceDictionary,
): Partial<Record<PriceField, string>> {
  const errors: Partial<Record<PriceField, string>> = {};
  const problem = priceProblem(value);
  if (problem === 'maxBeforeMin') errors.priceMaxVnd = t.services.priceMaxBeforeMin;
  if (problem === 'invalid') {
    if (!isVndInput(value.priceVnd)) errors.priceVnd = t.services.priceInvalid;
    if (!isVndInput(value.priceMaxVnd)) errors.priceMaxVnd = t.services.priceInvalid;
  }
  if (quantityProblem(value) !== null) errors.maxQuantity = t.services.maxQuantityInvalid;
  return errors;
}

/**
 * Minimum price, maximum price and pricing unit, shared by the create form and the price
 * command. An exact price uses the same amount twice. Renders its own `FormGrid`, so it can sit
 * directly in a form. A problem shows at the field it belongs to (`showErrors` after a submit; a
 * value that is already wrong shows at once).
 */
export function PriceFields({
  idPrefix,
  value,
  onChange,
  t,
  locale,
  showErrors = false,
}: {
  idPrefix: string;
  value: PriceForm;
  onChange: (next: PriceForm) => void;
  t: WorkforceDictionary;
  locale: Locale;
  showErrors?: boolean | undefined;
}) {
  const errors = priceErrors(value, t);
  // An empty field is reported only after a submit; a typed but wrong value is reported while typing.
  const shown = (key: PriceField) =>
    showErrors || value[key].trim() !== '' ? errors[key] : undefined;
  const amount = (key: 'priceVnd' | 'priceMaxVnd', label: string, hint: string) => (
    <Field id={`${idPrefix}-${key}`} label={label} required hint={hint} error={shown(key)}>
      {(control) => (
        <TextInput
          {...control}
          name={key}
          inputMode="numeric"
          pattern="0|[1-9][0-9]{0,17}"
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
            error={shown('maxQuantity')}
          >
            {(control) => (
              <TextInput
                {...control}
                name="maxQuantity"
                inputMode="numeric"
                pattern="[1-9][0-9]{0,9}"
                value={value.maxQuantity}
                onChange={(event) => onChange({ ...value, maxQuantity: event.target.value.trim() })}
              />
            )}
          </Field>
        ) : null}
      </FormGrid>
      {priceProblem(value) === null ? (
        <p className="ls-hint">{formatServicePrice(value, t, locale)}</p>
      ) : null}
    </>
  );
}
