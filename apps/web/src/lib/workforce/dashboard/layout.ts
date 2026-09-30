import type { WidgetId, WidgetMeta, WidgetSize } from './widgets';

// The dashboard layout (docs/UXUI_REDESIGN_DESIGN.md 14.2, 15). Order is the single persisted fact: the grid
// flows by order, so a layout can never overlap and always reflows. Stored per user and device in
// localStorage (no API change, decision D11). Pure functions only; the storage is passed in.

export const LAYOUT_VERSION = 1;

export interface SavedLayout {
  version: typeof LAYOUT_VERSION;
  /** Every offered widget id, visible ones first in display order, then the hidden ones. */
  order: string[];
  hidden: string[];
  /** Only sizes that differ from the widget's default. */
  sizes: Record<string, WidgetSize>;
}

export interface PlacedWidget {
  meta: WidgetMeta;
  size: WidgetSize;
}

export interface ResolvedLayout {
  visible: PlacedWidget[];
  hidden: WidgetMeta[];
}

const SIZES: readonly WidgetSize[] = ['s', 'm', 'l', 'xl'];

export const layoutKey = (accountId: string): string => `ls-dashboard:${accountId}`;

/**
 * Applies a saved layout to what the account may see. Unknown or no longer available ids are ignored,
 * widgets the layout has never seen (new ones, or newly permitted) are appended in default order, and a
 * saved size that the widget no longer offers falls back to its default. Without a saved layout the
 * result is the default layout: every available widget in default order.
 */
export function resolveLayout(
  available: readonly WidgetMeta[],
  saved: SavedLayout | null,
): ResolvedLayout {
  const byId = new Map(available.map((meta) => [meta.id as string, meta]));
  const seen = new Set<string>();
  const ordered: WidgetMeta[] = [];
  for (const id of saved?.order ?? []) {
    const meta = byId.get(id);
    if (meta && !seen.has(id)) {
      seen.add(id);
      ordered.push(meta);
    }
  }
  for (const meta of available) if (!seen.has(meta.id)) ordered.push(meta);
  const hiddenIds = new Set(saved?.hidden ?? []);
  const visible: PlacedWidget[] = [];
  const hidden: WidgetMeta[] = [];
  for (const meta of ordered) {
    if (hiddenIds.has(meta.id)) {
      hidden.push(meta);
      continue;
    }
    const size = saved?.sizes[meta.id];
    visible.push({ meta, size: size && meta.sizes.includes(size) ? size : meta.defaultSize });
  }
  return { visible, hidden };
}

/** The resolved layout as a complete saved layout (the state that edits start from). */
export function toSaved(resolved: ResolvedLayout): SavedLayout {
  const sizes: Record<string, WidgetSize> = {};
  for (const { meta, size } of resolved.visible)
    if (size !== meta.defaultSize) sizes[meta.id] = size;
  return {
    version: LAYOUT_VERSION,
    order: [...resolved.visible.map(({ meta }) => meta.id), ...resolved.hidden.map((m) => m.id)],
    hidden: resolved.hidden.map((meta) => meta.id),
    sizes,
  };
}

/** Drag, keyboard or Move buttons: `orderedIds` is the new order of the visible widgets. */
export function reorderVisible(
  resolved: ResolvedLayout,
  orderedIds: readonly string[],
): ResolvedLayout {
  const byId = new Map(resolved.visible.map((placed) => [placed.meta.id as string, placed]));
  const next = orderedIds.flatMap((id) => {
    const placed = byId.get(id);
    return placed ? [placed] : [];
  });
  // Anything the caller left out keeps its relative place at the end: a reorder never drops a widget.
  for (const placed of resolved.visible)
    if (!orderedIds.includes(placed.meta.id)) next.push(placed);
  return { visible: next, hidden: resolved.hidden };
}

export function hideWidget(resolved: ResolvedLayout, id: WidgetId): ResolvedLayout {
  const target = resolved.visible.find(({ meta }) => meta.id === id);
  if (!target) return resolved;
  return {
    visible: resolved.visible.filter((placed) => placed !== target),
    hidden: [...resolved.hidden, target.meta],
  };
}

/** Restores a hidden widget at the end of the visible ones, at its default size. */
export function showWidget(resolved: ResolvedLayout, id: WidgetId): ResolvedLayout {
  const meta = resolved.hidden.find((entry) => entry.id === id);
  if (!meta) return resolved;
  return {
    visible: [...resolved.visible, { meta, size: meta.defaultSize }],
    hidden: resolved.hidden.filter((entry) => entry !== meta),
  };
}

export function resizeWidget(
  resolved: ResolvedLayout,
  id: WidgetId,
  size: WidgetSize,
): ResolvedLayout {
  return {
    visible: resolved.visible.map((placed) =>
      placed.meta.id === id && placed.meta.sizes.includes(size) ? { ...placed, size } : placed,
    ),
    hidden: resolved.hidden,
  };
}

/** Parses stored JSON; anything that is not a valid version-1 layout is treated as absent. */
export function parseLayout(raw: string | null): SavedLayout | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { version, order, hidden, sizes } = value as Record<string, unknown>;
    const strings = (list: unknown): list is string[] =>
      Array.isArray(list) && list.every((item) => typeof item === 'string');
    if (version !== LAYOUT_VERSION || !strings(order) || !strings(hidden)) return null;
    const clean: Record<string, WidgetSize> = {};
    if (typeof sizes === 'object' && sizes !== null) {
      for (const [id, size] of Object.entries(sizes)) {
        if (SIZES.includes(size as WidgetSize)) clean[id] = size as WidgetSize;
      }
    }
    return { version: LAYOUT_VERSION, order, hidden, sizes: clean };
  } catch {
    return null;
  }
}

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem' | 'removeItem'>;

/** Storage can be missing or throw (private windows, blocked site data): the dashboard then uses defaults. */
export function readLayout(storage: ReadStorage | null, accountId: string): SavedLayout | null {
  try {
    return parseLayout(storage?.getItem(layoutKey(accountId)) ?? null);
  } catch {
    return null;
  }
}

export function writeLayout(
  storage: WriteStorage | null,
  accountId: string,
  layout: SavedLayout | null,
): void {
  try {
    if (layout) storage?.setItem(layoutKey(accountId), JSON.stringify(layout));
    else storage?.removeItem(layoutKey(accountId));
  } catch {
    // Not saved: the layout still applies for this visit.
  }
}
