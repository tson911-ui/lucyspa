'use client';

import type { ProductNameRef } from '@lucy-spa/contracts';
import { CheckField, Field, FormGrid, Select, Stack, Textarea, TextInput } from '@lucy-spa/ui';
import { productDictionary } from '../../../i18n/products';
import {
  DESCRIPTION_MAX,
  localizedName,
  NAME_MAX,
  type ProductDraft,
  type ProductDraftErrors,
} from '../../../lib/workforce/products';
import { useWorkforce } from '../session';

/**
 * The fields of a product's general information, shared by the "Add product" page and the edit drawer. Both names are required
 * (the English one is never copied from the Vietnamese one); brand and category are optional choices.
 */
export function ProductFields({
  draft,
  onChange,
  errors,
  checked,
  brands,
  categories,
}: {
  draft: ProductDraft;
  onChange: (patch: Partial<ProductDraft>) => void;
  errors: ProductDraftErrors;
  /** Show the field errors (after the first submit attempt). */
  checked: boolean;
  brands: readonly ProductNameRef[];
  categories: readonly ProductNameRef[];
}) {
  const { locale } = useWorkforce();
  const p = productDictionary(locale);
  const c = p.create;
  const issue = (value: 'required' | 'invalid' | undefined) =>
    checked && value ? (value === 'required' ? p.required : p.invalid) : undefined;
  return (
    <Stack gap="block">
      <FormGrid cols={2}>
        <Field label={c.nameVi} error={issue(errors.nameVi)} required>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={NAME_MAX}
              value={draft.nameVi}
              onChange={(event) => onChange({ nameVi: event.target.value })}
            />
          )}
        </Field>
        <Field label={c.nameEn} error={issue(errors.nameEn)} required>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={NAME_MAX}
              value={draft.nameEn}
              onChange={(event) => onChange({ nameEn: event.target.value })}
            />
          )}
        </Field>
        <Field label={c.brand}>
          {(control) => (
            <Select
              {...control}
              value={draft.brandId}
              options={[
                { value: '', label: c.choose },
                ...brands.map((brand) => ({
                  value: brand.id,
                  label: localizedName(brand, locale),
                })),
              ]}
              onChange={(event) => onChange({ brandId: event.target.value })}
            />
          )}
        </Field>
        <Field label={c.category}>
          {(control) => (
            <Select
              {...control}
              value={draft.categoryId}
              options={[
                { value: '', label: c.choose },
                ...categories.map((category) => ({
                  value: category.id,
                  label: localizedName(category, locale),
                })),
              ]}
              onChange={(event) => onChange({ categoryId: event.target.value })}
            />
          )}
        </Field>
        <Field label={c.descriptionVi} error={issue(errors.descriptionVi)}>
          {(control) => (
            <Textarea
              {...control}
              maxLength={DESCRIPTION_MAX}
              value={draft.descriptionVi}
              onChange={(event) => onChange({ descriptionVi: event.target.value })}
            />
          )}
        </Field>
        <Field label={c.descriptionEn} error={issue(errors.descriptionEn)}>
          {(control) => (
            <Textarea
              {...control}
              maxLength={DESCRIPTION_MAX}
              value={draft.descriptionEn}
              onChange={(event) => onChange({ descriptionEn: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
      <CheckField
        label={c.featured}
        hint={c.featuredHint}
        checked={draft.featured}
        onChange={(event) => onChange({ featured: event.target.checked })}
      />
    </Stack>
  );
}
