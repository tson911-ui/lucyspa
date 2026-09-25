'use client';

import type { ServicePricingUnit } from '@lucy-spa/contracts';
import type { Locale } from '../../../i18n/locales';
import type { WorkforceDictionary } from '../../../i18n/workforce';
import {
  formatServicePrice,
  priceProblem,
  PRICING_UNITS,
  type PriceForm,
} from '../../../lib/workforce/pricing';
import { Field, Notice } from '../ui';

/**
 * Minimum price, maximum price and pricing unit, shared by the create form and the price
 * command. An exact price uses the same amount twice.
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
  const amount = (key: 'priceVnd' | 'priceMaxVnd', label: string, hint?: string) => (
    <Field id={`${idPrefix}-${key}`} label={label} required {...(hint ? { hint } : {})}>
      <input
        id={`${idPrefix}-${key}`}
        required
        inputMode="numeric"
        pattern="0|[1-9][0-9]{0,17}"
        aria-invalid={problem !== null}
        value={value[key]}
        onChange={(event) => onChange({ ...value, [key]: event.target.value.trim() })}
      />
    </Field>
  );
  return (
    <>
      <div className="wf-row">
        {amount('priceVnd', t.services.priceMin, t.services.priceHint)}
        {amount('priceMaxVnd', t.services.priceMax, t.services.priceRangeHint)}
        <Field id={`${idPrefix}-unit`} label={t.services.pricingUnit} required>
          <select
            id={`${idPrefix}-unit`}
            required
            value={value.pricingUnit}
            onChange={(event) =>
              onChange({ ...value, pricingUnit: event.target.value as ServicePricingUnit })
            }
          >
            {PRICING_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {t.services.pricingUnits[unit]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {problem === null ? (
        <p className="wf-muted">{formatServicePrice(value, t, locale)}</p>
      ) : value.priceVnd !== '' || value.priceMaxVnd !== '' ? (
        <Notice tone="error">
          {problem === 'maxBeforeMin' ? t.services.priceMaxBeforeMin : t.services.priceInvalid}
        </Notice>
      ) : null}
    </>
  );
}
