'use client';

import { IconButton, NumberInput } from '@lucy-spa/ui';
import { useEffect, useState } from 'react';
import { clampQuantity } from '../../lib/shop/online';

/**
 * A quantity as minus, a number and plus (each 44 px on touch). A typed number is kept as typed until the field is left or
 * Enter is pressed; the buttons act at once. The value is always a whole number from 1 to `max`.
 */
export function QuantityStepper({
  value,
  max,
  onChange,
  label,
  decreaseLabel,
  increaseLabel,
  disabled = false,
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  decreaseLabel: string;
  increaseLabel: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  function commit(raw: string) {
    const next = clampQuantity(Number(raw), max);
    setDraft(String(next));
    if (next !== value) onChange(next);
  }

  return (
    <div className="ls-qty" role="group" aria-label={label}>
      <IconButton
        icon="minus"
        variant="secondary"
        label={decreaseLabel}
        disabled={disabled || value <= 1}
        onClick={() => onChange(clampQuantity(value - 1, max))}
      />
      <NumberInput
        className="ls-qty-input"
        aria-label={label}
        inputMode="numeric"
        min={1}
        max={max}
        step={1}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(event.currentTarget.value);
          }
        }}
      />
      <IconButton
        icon="plus"
        variant="secondary"
        label={increaseLabel}
        disabled={disabled || value >= max}
        onClick={() => onChange(clampQuantity(value + 1, max))}
      />
    </div>
  );
}
