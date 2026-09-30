import type { IconName } from './icons';

// Pure shell logic (docs/UXUI_REDESIGN_DESIGN.md section 4): navigation grouping, active-item match,
// the user's initials, and the persisted sidebar state. No DOM and no React here, so it is unit-tested.

/** Tablet (640-1023 px): the sidebar is an icon rail that expands as an overlay. */
export const TABLET_QUERY = '(min-width: 640px) and (max-width: 1023px)';

export interface ShellNavItem {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  /** True for the page being shown; renders `aria-current="page"`. */
  current?: boolean | undefined;
}

export interface ShellNavGroup {
  id: string;
  label: string;
  items: readonly ShellNavItem[];
}

export interface ArrangedNavGroup extends ShellNavGroup {
  /** A group with a single item renders that item flat: no heading. */
  flat: boolean;
}

/** Hides groups with no visible item and marks single-item groups as flat (contract 4.2). */
export function arrangeNav(groups: readonly ShellNavGroup[]): ArrangedNavGroup[] {
  return groups
    .filter((group) => group.items.length > 0)
    .map((group) => ({ ...group, flat: group.items.length === 1 }));
}

function trimSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/** Whether `pathname` is `href` or below it. `exact` is for roots such as the dashboard. */
export function isPathActive(pathname: string, href: string, exact = false): boolean {
  const current = trimSlash(pathname);
  const target = trimSlash(href);
  return exact ? current === target : current === target || current.startsWith(`${target}/`);
}

/** Up to two letters for the avatar: first letter of the first and of the last word. */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')
    .map((word) => Array.from(word)[0]!.toLocaleUpperCase());
  if (words.length === 0) return '';
  return words.length === 1 ? words[0]! : `${words[0]}${words.at(-1)}`;
}

/** Per-viewer convenience only (contract: browser storage is never authoritative). */
export const SIDEBAR_COLLAPSED_KEY = 'ls.sidebar.collapsed';

export function readSidebarCollapsed(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): boolean {
  try {
    return storage?.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(
  collapsed: boolean,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safeStorage(),
): void {
  try {
    if (collapsed) storage?.setItem(SIDEBAR_COLLAPSED_KEY, '1');
    else storage?.removeItem(SIDEBAR_COLLAPSED_KEY);
  } catch {
    // Private mode or blocked storage: the sidebar simply starts expanded next time.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
