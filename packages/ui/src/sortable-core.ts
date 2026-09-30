// DOM-free helpers of SortableList/SortableGrid (docs/UXUI_REDESIGN_DESIGN.md 9.7, 14.2).

/** Same as `--ls-dur-base` (a test compares them); dnd-kit animates the items that make room. */
export const SORT_TRANSITION_MS = 200;
export const SORT_EASING = 'cubic-bezier(0, 0, 0.2, 1)';

/** `ids` with the item at `from` moved to `to`. Out-of-range or equal positions return a copy. */
export function reorder<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/** Ids after moving `id` by `delta` places; `null` when it cannot move (unknown id or at the edge). */
export function moveBy(ids: readonly string[], id: string, delta: number): string[] | null {
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length || delta === 0) return null;
  return reorder(ids, from, to);
}
