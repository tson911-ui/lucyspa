'use client';

import type { WebsiteSeasonListResponse, WebsiteSeasonResponse } from '@lucy-spa/contracts';
import { Field, FormSection, Select } from '@lucy-spa/ui';
import { presetName, seasonWindowText } from '../../../lib/workforce/seasons';
import { useWorkforce } from '../session';
import { useResource } from '../ui';

/**
 * "Follow a season" for a popup or a slide (design 20.6): none, or any season. Choosing one makes the item use the
 * season's dates (the form disables its own date fields and shows the season's window) and show only while the
 * season is enabled. The list loads on its own; while it fails or is empty and nothing is chosen the whole section
 * stays out of the way.
 */
export function SeasonSelect({
  value,
  onChange,
  text,
}: {
  /** The chosen season id, '' for none. */
  value: string;
  /** The season chosen, or null for none. */
  onChange: (season: WebsiteSeasonResponse | null) => void;
  text: { section: string; label: string; none: string; hint: string };
}) {
  const { api, locale } = useWorkforce();
  const seasons = useResource(
    () => api.get<WebsiteSeasonListResponse>('/api/v1/website/seasons'),
    [api],
  );
  const items = seasons.data?.items ?? [];
  if (items.length === 0 && value === '') return null;
  const options = items.map((season) => ({
    value: season.id,
    label: `${season.label} · ${presetName(season.presetKey, locale)} · ${seasonWindowText(season, locale)}`,
  }));
  // A followed season that the list does not know (deleted meanwhile) still shows as the current choice.
  if (value !== '' && !items.some((season) => season.id === value)) {
    options.unshift({ value, label: value });
  }
  return (
    <FormSection title={text.section} description={text.hint}>
      <Field label={text.label}>
        {(control) => (
          <Select
            {...control}
            value={value}
            placeholder={text.none}
            options={options}
            onChange={(event) =>
              onChange(items.find((season) => season.id === event.target.value) ?? null)
            }
          />
        )}
      </Field>
    </FormSection>
  );
}
