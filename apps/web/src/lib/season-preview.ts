import {
  ALL_SEASON_SLOTS_ON,
  isSeasonDensity,
  isSeasonPresetKey,
  isSeasonSlot,
  SEASON_SLOTS,
  type PublicSeasonResponse,
  type SeasonDensity,
  type SeasonSlot,
  type SeasonSlotSwitches,
} from '@lucy-spa/contracts';
import { parsePublicSeason } from './season-core';

/**
 * The full-page season preview (docs/UXUI_REDESIGN_S6_PLAN.md section 6): the admin form sends its unsaved state to
 * the app's own `season-preview` page (an iframe or a window it opened) with `postMessage`, and that page draws the
 * real public site from it. Pure functions: the message shapes, what is accepted, and the public answer a draft stands
 * for. Nothing here reads a network or the DOM, so it is unit-tested. The page that receives only ever draws; it
 * keeps nothing and sends nothing but "ready" and its own height.
 */

export const PREVIEW_SOURCE = 'lucy-season-preview';

export type PreviewTheme = 'light' | 'dark';

/** Everything the page needs to draw a season; `mediaIds` become the admin library's image URLs on arrival. */
export interface SeasonPreviewDraft {
  presetKey: string;
  greeting: string;
  /** Exclusive end, ISO instant (the Tet year name is computed from it). */
  endsAt: string;
  customer: boolean;
  particles: boolean;
  slots: SeasonSlotSwitches;
  density: SeasonDensity;
  greetingStrip: boolean;
  greetingFooter: boolean;
  mediaIds: Partial<Record<SeasonSlot, string>>;
}

export type PreviewMessage =
  | { source: typeof PREVIEW_SOURCE; type: 'draft'; draft: SeasonPreviewDraft; theme: PreviewTheme }
  | { source: typeof PREVIEW_SOURCE; type: 'ready' }
  | { source: typeof PREVIEW_SOURCE; type: 'height'; value: number };

/** The frame height the host accepts: a page shorter or taller than this is clamped, never trusted blindly. */
export const PREVIEW_MIN_HEIGHT = 480;
export const PREVIEW_MAX_HEIGHT = 12_000;

export const clampPreviewHeight = (value: number): number =>
  Math.min(PREVIEW_MAX_HEIGHT, Math.max(PREVIEW_MIN_HEIGHT, Math.round(value)));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The rendition each slot's image is shown in (the same choice the public API makes). */
const SLOT_VARIANT: Record<SeasonSlot, 'md' | 'lg'> = {
  particles: 'md',
  header: 'lg',
  logo: 'md',
  corners: 'md',
  dividers: 'lg',
  footer: 'lg',
  tint: 'lg',
};

/** The signed-in admin's own library URL of an image (the preview is admin-only, so it needs no public serving). */
export const previewMediaUrl = (id: string, slot: SeasonSlot): string =>
  `/api/v1/website/media/${id}/${SLOT_VARIANT[slot]}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A message from the other side, checked; anything odd is null (ignored). */
export function parsePreviewMessage(data: unknown): PreviewMessage | null {
  if (!isRecord(data) || data['source'] !== PREVIEW_SOURCE) return null;
  const type = data['type'];
  if (type === 'ready') return { source: PREVIEW_SOURCE, type };
  if (type === 'height') {
    const value = data['value'];
    return typeof value === 'number' && Number.isFinite(value)
      ? { source: PREVIEW_SOURCE, type, value: clampPreviewHeight(value) }
      : null;
  }
  if (type === 'draft') {
    const theme = data['theme'];
    const draft = parseDraft(data['draft']);
    return draft && (theme === 'light' || theme === 'dark')
      ? { source: PREVIEW_SOURCE, type, draft, theme }
      : null;
  }
  return null;
}

function parseDraft(value: unknown): SeasonPreviewDraft | null {
  if (!isRecord(value)) return null;
  const {
    presetKey,
    greeting,
    endsAt,
    customer,
    particles,
    density,
    greetingStrip,
    greetingFooter,
  } = value;
  if (!isSeasonPresetKey(presetKey)) return null;
  if (typeof greeting !== 'string' || [...greeting].length > 80) return null;
  if (typeof endsAt !== 'string' || Number.isNaN(Date.parse(endsAt))) return null;
  if (
    typeof customer !== 'boolean' ||
    typeof particles !== 'boolean' ||
    typeof greetingStrip !== 'boolean' ||
    typeof greetingFooter !== 'boolean' ||
    !isSeasonDensity(density)
  ) {
    return null;
  }
  const slots: SeasonSlotSwitches = { ...ALL_SEASON_SLOTS_ON };
  if (!isRecord(value['slots'])) return null;
  for (const slot of SEASON_SLOTS) {
    const on = value['slots'][slot];
    if (typeof on !== 'boolean') return null;
    slots[slot] = on;
  }
  const mediaIds: Partial<Record<SeasonSlot, string>> = {};
  if (!isRecord(value['mediaIds'])) return null;
  for (const [slot, id] of Object.entries(value['mediaIds'])) {
    if (!isSeasonSlot(slot) || typeof id !== 'string' || !UUID.test(id)) return null;
    mediaIds[slot] = id;
  }
  return {
    presetKey,
    greeting,
    endsAt,
    customer,
    particles,
    slots,
    density,
    greetingStrip,
    greetingFooter,
    mediaIds,
  };
}

/**
 * The public answer a draft stands for, run through the same parser the live site uses (so the preview can never draw
 * something the site would reject). Null when it would show nothing (not for the customer side, or odd).
 */
export function seasonOfDraft(draft: SeasonPreviewDraft): PublicSeasonResponse | null {
  const particles = draft.particles && draft.customer;
  const season = parsePublicSeason({
    presetKey: draft.presetKey,
    greeting: draft.greeting,
    endsAt: draft.endsAt,
    particles,
    customer: draft.customer,
    admin: true,
    slots: { ...draft.slots, particles },
    density: draft.density,
    greetingStrip: draft.greetingStrip,
    greetingFooter: draft.greetingFooter,
    media: {},
  });
  if (!season) return null;
  // The admin library URLs are not the public addresses the live parser accepts, so they are attached after it.
  const media: PublicSeasonResponse['media'] = {};
  for (const [slot, id] of Object.entries(draft.mediaIds)) {
    if (isSeasonSlot(slot)) media[slot] = previewMediaUrl(id, slot);
  }
  return { ...season, media };
}
