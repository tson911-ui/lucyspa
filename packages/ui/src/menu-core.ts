// Pure keyboard logic for menus, listboxes and focus traps. Kept free of DOM types so it can be unit
// tested in Node; the components only translate events into these calls.

export interface MenuNavigable {
  disabled?: boolean | undefined;
}

/** Index of the next enabled entry for an arrow/Home/End key, wrapping at the ends. -1 if none. */
export function nextEnabledIndex(
  items: readonly MenuNavigable[],
  current: number,
  key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End',
): number {
  const count = items.length;
  if (count === 0) return -1;
  const enabled = (index: number) => !items[index]?.disabled;
  if (key === 'Home') return items.findIndex((_, index) => enabled(index));
  if (key === 'End') {
    for (let index = count - 1; index >= 0; index -= 1) if (enabled(index)) return index;
    return -1;
  }
  const step = key === 'ArrowDown' ? 1 : -1;
  let index = current;
  for (let tries = 0; tries < count; tries += 1) {
    index = (index + step + count) % count;
    if (enabled(index)) return index;
  }
  return -1;
}

/**
 * Typeahead: the next enabled label that starts with the typed text, searching after `current`
 * first. A single repeated character cycles through entries that start with it.
 */
export function typeaheadIndex(
  labels: readonly string[],
  disabled: readonly boolean[],
  current: number,
  typed: string,
): number {
  const needle = typed.toLocaleLowerCase();
  if (!needle.trim()) return -1;
  const repeated = [...needle].every((character) => character === needle[0]);
  const query = repeated ? needle[0]! : needle;
  const count = labels.length;
  // A growing prefix may still match the current entry; a repeated letter must move on.
  const first = repeated ? 1 : 0;
  for (let offset = first; offset <= count; offset += 1) {
    const index = (current + offset + count) % count;
    if (disabled[index]) continue;
    if (labels[index]?.toLocaleLowerCase().startsWith(query)) return index;
  }
  return -1;
}

export interface Orderable {
  tone?: 'default' | 'danger' | undefined;
}

/**
 * Fixed order of a row-action menu (contract 10.4): safe actions first, then the destructive ones.
 * The relative order inside each group is kept.
 */
export function orderActions<T extends Orderable>(items: readonly T[]): { safe: T[]; danger: T[] } {
  return {
    safe: items.filter((item) => item.tone !== 'danger'),
    danger: items.filter((item) => item.tone === 'danger'),
  };
}

/**
 * Focus trap: where Tab should go from `activeIndex` within `count` focusable elements.
 * Returns the index to focus, or `null` when the browser default is correct.
 * `activeIndex` is -1 when focus is outside the trap.
 */
export function trapTarget(activeIndex: number, count: number, shiftKey: boolean): number | null {
  if (count === 0) return 0;
  if (activeIndex === -1) return shiftKey ? count - 1 : 0;
  if (shiftKey && activeIndex === 0) return count - 1;
  if (!shiftKey && activeIndex === count - 1) return 0;
  return null;
}
