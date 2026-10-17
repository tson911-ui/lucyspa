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

/**
 * The page context shown at the leading edge of the staff bar (session 10 SHELL plan, DESIGN.md 8.5): the current item's group and
 * label ("Thanh toán › Hóa đơn"); a flat group shows the item alone. Null when no item is current (a record below a menu page keeps
 * its menu page current, so it still has a context).
 */
export function currentContext(
  groups: readonly ArrangedNavGroup[],
): { group: string | null; item: string } | null {
  for (const group of groups) {
    const item = group.items.find((entry) => entry.current);
    if (item) return { group: group.flat ? null : group.label, item: item.label };
  }
  return null;
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
  writeCookie(SIDEBAR_COOKIE, collapsed ? '1' : null);
  try {
    if (collapsed) storage?.setItem(SIDEBAR_COLLAPSED_KEY, '1');
    else storage?.removeItem(SIDEBAR_COLLAPSED_KEY);
  } catch {
    // Private mode or blocked storage: the sidebar simply starts expanded next time.
  }
}

/**
 * The same two sidebar preferences as cookies, so the server renders the sidebar as the person left it and the first paint
 * never jumps from expanded to collapsed (rbp rendering-hydration-no-flicker). Still a per-viewer convenience only.
 */
export const SIDEBAR_COOKIE = 'ls_rail';
export const NAV_GROUPS_COOKIE = 'ls_nav';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function writeCookie(name: string, value: string | null): void {
  try {
    if (typeof document === 'undefined') return;
    document.cookie =
      value === null
        ? `${name}=; path=/; max-age=0; samesite=lax`
        : `${name}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    // Cookies blocked: the preference lasts for this page only.
  }
}

/** The sidebar cookie as the server reads it: `true`/`false`, or `undefined` when this device never chose. */
export function parseSidebarCookie(raw: string | undefined): boolean | undefined {
  return raw === undefined ? undefined : raw === '1';
}

/** The open-groups cookie (JSON, possibly still URI-encoded) as a clean state, or `undefined` when absent or broken. */
export function parseNavGroupCookie(raw: string | undefined): NavGroupState | undefined {
  if (raw === undefined || raw === '') return undefined;
  for (const text of [raw, safeDecode(raw)]) {
    const state = cleanGroupState(text);
    if (state) return state;
  }
  return undefined;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function cleanGroupState(json: string): NavGroupState | undefined {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
      ),
    );
  } catch {
    return undefined;
  }
}

/** Per-viewer convenience: which sidebar groups the person opened or closed (id -> open). */
export const SIDEBAR_GROUPS_KEY = 'ls.sidebar.groups';

export type NavGroupState = Readonly<Record<string, boolean>>;

/** The group (with a heading) that holds the current page, so it can open itself. */
export function currentGroupId(groups: readonly ArrangedNavGroup[]): string | undefined {
  return groups.find((group) => !group.flat && group.items.some((item) => item.current))?.id;
}

export function readNavGroupState(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): NavGroupState {
  try {
    return cleanGroupState(storage?.getItem(SIDEBAR_GROUPS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export function writeNavGroupState(
  state: NavGroupState,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
): void {
  writeCookie(NAV_GROUPS_COOKIE, JSON.stringify(state));
  try {
    storage?.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify(state));
  } catch {
    // Private mode or blocked storage: groups simply start closed (except the current one) next time.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
