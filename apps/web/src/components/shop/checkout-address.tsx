'use client';

import type { CustomerAddressResponse } from '@lucy-spa/contracts';
import { VIETNAM_PROVINCES } from '@lucy-spa/contracts';
import {
  Button,
  Card,
  CardHeader,
  ChoiceCard,
  CheckField,
  Field,
  FormGrid,
  Select,
  Stack,
  TextInput,
} from '@lucy-spa/ui';
import { useId, useMemo } from 'react';
import type { Locale } from '../../i18n/locales';
import type { ShopText } from '../../i18n/online-shop';
import {
  ADDRESS_LIMITS,
  addressLine,
  nationalPhone,
  type AddressDraft,
  type AddressField,
} from '../../lib/shop/online';

/** The 34 provinces and cities in the reader's alphabet. */
export function provinceOptions(locale: Locale): { value: string; label: string }[] {
  return VIETNAM_PROVINCES.map((province) => ({
    value: province.code,
    label: locale === 'vi' ? province.nameVi : province.nameEn,
  })).sort((a, b) => a.label.localeCompare(b.label, locale));
}

/**
 * "Địa chỉ giao hàng" of the checkout: the member's saved addresses to pick from, and the five fields (recipient name, phone,
 * province, ward, street). Name and phone are filled from the profile for a first address. The server decides again and names the
 * field it refused; `problems` marks those fields.
 */
export function CheckoutAddress({
  locale,
  s,
  draft,
  onDraft,
  saved,
  selected,
  onSelect,
  onDelete,
  saveAddress,
  onSaveAddress,
  problems,
  disabled,
  requiredLabel,
}: {
  locale: Locale;
  s: ShopText['checkout'];
  draft: AddressDraft;
  onDraft: (patch: Partial<AddressDraft>) => void;
  saved: readonly CustomerAddressResponse[];
  /** The id of the chosen saved address, or `null` for a new one. */
  selected: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (address: CustomerAddressResponse) => void;
  saveAddress: boolean;
  onSaveAddress: (value: boolean) => void;
  problems: Partial<Record<AddressField, true>>;
  disabled: boolean;
  requiredLabel: string;
}) {
  const group = useId();
  const options = useMemo(() => provinceOptions(locale), [locale]);
  const error = (field: AddressField) => (problems[field] ? s.problems[field] : undefined);
  const chosen = saved.find((address) => address.id === selected) ?? null;
  return (
    <Card as="section" aria-label={s.address}>
      <CardHeader title={s.address} />
      <Stack gap="block">
        {saved.length > 0 ? (
          <div className="ls-shop-saved" role="radiogroup" aria-label={s.saved}>
            {saved.map((address) => (
              <ChoiceCard
                key={address.id}
                type="radio"
                name={group}
                value={address.id}
                checked={selected === address.id}
                onChange={() => onSelect(address.id)}
                disabled={disabled}
                title={`${address.recipientName} · ${nationalPhone(address.recipientPhone)}`}
                meta={addressLine(address)}
              />
            ))}
            <ChoiceCard
              type="radio"
              name={group}
              value=""
              checked={selected === null}
              onChange={() => onSelect(null)}
              disabled={disabled}
              title={s.savedNew}
            />
          </div>
        ) : null}
        <FormGrid cols={2}>
          <Field
            label={s.recipientName}
            required
            requiredLabel={requiredLabel}
            error={error('recipientName')}
          >
            {(control) => (
              <TextInput
                {...control}
                autoComplete="name"
                maxLength={ADDRESS_LIMITS.name}
                value={draft.recipientName}
                disabled={disabled}
                onChange={(event) => onDraft({ recipientName: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={s.recipientPhone}
            hint={s.recipientPhoneHint}
            required
            requiredLabel={requiredLabel}
            error={error('recipientPhone')}
          >
            {(control) => (
              <TextInput
                {...control}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={ADDRESS_LIMITS.phone}
                value={draft.recipientPhone}
                disabled={disabled}
                onChange={(event) => onDraft({ recipientPhone: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={s.province}
            required
            requiredLabel={requiredLabel}
            error={error('provinceCode')}
            full
          >
            {(control) => (
              <Select
                {...control}
                autoComplete="address-level1"
                options={options}
                placeholder={s.provincePlaceholder}
                value={draft.provinceCode}
                disabled={disabled}
                onChange={(event) => onDraft({ provinceCode: event.target.value })}
              />
            )}
          </Field>
          <Field label={s.ward} required requiredLabel={requiredLabel} error={error('ward')}>
            {(control) => (
              <TextInput
                {...control}
                autoComplete="address-level2"
                maxLength={ADDRESS_LIMITS.ward}
                value={draft.ward}
                disabled={disabled}
                onChange={(event) => onDraft({ ward: event.target.value })}
              />
            )}
          </Field>
          <Field label={s.street} required requiredLabel={requiredLabel} error={error('street')}>
            {(control) => (
              <TextInput
                {...control}
                autoComplete="street-address"
                maxLength={ADDRESS_LIMITS.street}
                value={draft.street}
                disabled={disabled}
                onChange={(event) => onDraft({ street: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
        {chosen ? (
          <div>
            <Button
              variant="ghost"
              icon="trash"
              disabled={disabled}
              onClick={() => onDelete(chosen)}
            >
              {s.savedDelete}
            </Button>
          </div>
        ) : (
          <CheckField
            label={s.saveAddress}
            hint={s.saveAddressHint}
            checked={saveAddress}
            disabled={disabled}
            onChange={(event) => onSaveAddress(event.target.checked)}
          />
        )}
      </Stack>
    </Card>
  );
}
