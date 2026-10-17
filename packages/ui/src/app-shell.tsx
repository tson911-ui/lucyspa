'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { IconButton } from './button';
import { cx } from './cx';
import { HeaderBar } from './header-bar';
import { Icon } from './icons';
import { Drawer } from './overlay';
import { Popover } from './popover';
import {
  TABLET_QUERY,
  arrangeNav,
  currentContext,
  currentGroupId,
  initials,
  readNavGroupState,
  readSidebarCollapsed,
  writeNavGroupState,
  writeSidebarCollapsed,
  type ArrangedNavGroup,
  type NavGroupState,
  type ShellNavGroup,
} from './shell-core';
import { useSlidingPill } from './sliding-pill';
import { PHONE_QUERY, useMediaQuery } from './use-media-query';

/** The props the shell gives a link. A small explicit set so a router link (Next `Link`) is assignable. */
export interface ShellLinkProps {
  href: string;
  className?: string | undefined;
  'aria-current'?: 'page' | undefined;
  title?: string | undefined;
  onClick?: () => void;
  children?: ReactNode;
}

/** Anchor-like component; the app passes its router link so navigation stays client-side. */
export type ShellLink = ComponentType<ShellLinkProps>;

const PlainLink: ShellLink = (props) => <a {...props} />;

interface ShellPreferenceState {
  collapsed: boolean;
  groups: NavGroupState;
}

interface ShellPreferencesValue {
  state: ShellPreferenceState;
  /** Whether the server found each cookie (a device that chose before the cookies existed is carried over once). */
  known: { collapsed: boolean; groups: boolean };
  update: (patch: Partial<ShellPreferenceState>) => void;
}

const ShellPreferencesContext = createContext<ShellPreferencesValue | null>(null);

/**
 * The sidebar's remembered state (collapsed rail, open groups) as the server read it from the person's cookies
 * (`parseSidebarCookie`, `parseNavGroupCookie`), placed once around the app by the root layout. The shell then renders on the
 * server exactly as it will on the client, so nothing collapses or opens after the first paint (rbp
 * rendering-hydration-no-flicker), and it keeps the live state across client navigations between areas.
 */
export function ShellPreferencesProvider({
  collapsed,
  groups,
  children,
}: {
  collapsed: boolean | undefined;
  groups: NavGroupState | undefined;
  children: ReactNode;
}) {
  const [state, setState] = useState<ShellPreferenceState>(() => ({
    collapsed: collapsed ?? false,
    groups: groups ?? {},
  }));
  const update = useCallback(
    (patch: Partial<ShellPreferenceState>) => setState((previous) => ({ ...previous, ...patch })),
    [],
  );
  const known = useMemo(
    () => ({ collapsed: collapsed !== undefined, groups: groups !== undefined }),
    [collapsed, groups],
  );
  const value = useMemo(() => ({ state, known, update }), [state, known, update]);
  return <ShellPreferencesContext value={value}>{children}</ShellPreferencesContext>;
}

export interface AppShellLabels {
  /** Accessible name of the navigation, also the drawer title on phones. */
  nav: string;
  /** Menu button (tablet and phone). */
  menu: string;
  closeMenu: string;
  collapse: string;
  expand: string;
}

/**
 * Application shell (contract 4.1): sidebar + sticky topbar + content.
 * Desktop: full sidebar, collapsible to icons. Tablet: icon rail that expands as an overlay.
 * Phone: the sidebar becomes a drawer opened from the menu button.
 * Text always comes from props; permission filtering happens before `nav` is built.
 */
export function AppShell({
  brand,
  nav,
  labels,
  topbar,
  topbarExtras,
  topbarEnd,
  LinkComponent = PlainLink,
  className,
  mainClassName,
  children,
}: {
  /** The wordmark link. */
  brand: ReactNode;
  nav: readonly ShellNavGroup[];
  labels: AppShellLabels;
  /** Always shown in the topbar, first in the action group: notifications. */
  topbar: ReactNode;
  /** Shown from 640 px up, after `topbar` (theme toggle, language); on phones they live in the user menu. */
  topbarExtras?: ReactNode;
  /** Always shown, last (the user menu). Order is fixed: notifications, theme, language, user (contract 4.1). */
  topbarEnd?: ReactNode;
  LinkComponent?: ShellLink | undefined;
  className?: string | undefined;
  mainClassName?: string | undefined;
  children: ReactNode;
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  const tablet = useMediaQuery(TABLET_QUERY);
  const preferences = useContext(ShellPreferencesContext);
  const [localCollapsed, setLocalCollapsed] = useState(false);
  // With the provider the server already rendered the person's choice (a cookie), so the first paint is right; without it
  // (a bare kit use) the stored choice is read after hydration so the server and first client render agree.
  const collapsed = preferences ? preferences.state.collapsed : localCollapsed;
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const groups = useMemo(() => arrangeNav(nav), [nav]);
  const context = useMemo(() => currentContext(groups), [groups]);

  useEffect(() => {
    if (!preferences) {
      setLocalCollapsed(readSidebarCollapsed());
      return;
    }
    // A device that chose before the cookie existed: carry its stored choice over once (the next load paints it at once).
    if (!preferences.known.collapsed && readSidebarCollapsed()) {
      writeSidebarCollapsed(true);
      preferences.update({ collapsed: true });
    }
    // Only on mount.
  }, []);

  const close = useCallback(() => setOpen(false), []);
  // A resize to another layout must not leave an overlay or drawer open: adjusted while rendering when the layout changes,
  // not in an effect (rbp rerender-derived-state-no-effect).
  const layout = phone ? 'phone' : tablet ? 'tablet' : 'desktop';
  const [seenLayout, setSeenLayout] = useState(layout);
  if (layout !== seenLayout) {
    setSeenLayout(layout);
    setOpen(false);
  }

  useEffect(() => {
    if (!open || phone) return undefined;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open, phone]);

  function toggleCollapsed() {
    const next = !collapsed;
    writeSidebarCollapsed(next);
    if (preferences) preferences.update({ collapsed: next });
    else setLocalCollapsed(next);
  }

  const rail = tablet ? !open : collapsed;
  // Memoised: a menu toggle or media change re-renders the shell, not the whole navigation (rbp rerender-memo).
  const navigation = useMemo(
    () => (
      <SidebarNav
        groups={groups}
        label={labels.nav}
        rail={phone ? false : rail}
        LinkComponent={LinkComponent}
        onNavigate={close}
      />
    ),
    [groups, labels.nav, phone, rail, LinkComponent, close],
  );

  return (
    // The staff screens take the compact density (DESIGN.md 6.7): the only per-area difference from the customer site.
    <div className={cx('ls-shell', className)} data-density="compact">
      {/* The shared header bar of every area (R7): the same component as the customer site, compact density. */}
      <HeaderBar
        className="ls-topbar"
        start={
          // Always rendered and hidden by CSS on desktop, so a tablet or phone does not flash the desktop layout.
          <IconButton
            ref={menuButton}
            className="ls-menu-button"
            icon="menu"
            label={open ? labels.closeMenu : labels.menu}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          />
        }
        brandClassName="ls-topbar-brand"
        brand={brand}
        nav={
          context ? (
            <p className="ls-topbar-context">
              {context.group ? (
                <>
                  <span>{context.group}</span>
                  <Icon name="chevron-right" size={16} />
                </>
              ) : null}
              <span className="ls-topbar-context-item">{context.item}</span>
            </p>
          ) : undefined
        }
        endClassName="ls-topbar-end"
        end={
          <>
            {topbar}
            <div className="ls-topbar-extras">{topbarExtras}</div>
            {topbarEnd}
          </>
        }
      />
      <div className="ls-shell-body">
        {phone ? (
          <Drawer
            open={open}
            onClose={close}
            side="start"
            title={labels.nav}
            closeLabel={labels.closeMenu}
            className="ls-nav-drawer"
          >
            {navigation}
          </Drawer>
        ) : (
          <>
            {/* The slot keeps the rail's width in the layout while the aside overlays it on tablet. */}
            <div className="ls-sidebar-slot" data-rail={rail}>
              <aside
                className="ls-sidebar"
                data-rail={rail}
                data-overlay={tablet && open ? true : undefined}
              >
                {navigation}
                {tablet ? null : (
                  <div className="ls-sidebar-footer">
                    <button
                      type="button"
                      className="ls-sidebar-toggle"
                      aria-label={collapsed ? labels.expand : labels.collapse}
                      title={collapsed ? labels.expand : labels.collapse}
                      onClick={toggleCollapsed}
                    >
                      <Icon name="panel-left" />
                      <span className="ls-nav-label">
                        {collapsed ? labels.expand : labels.collapse}
                      </span>
                    </button>
                  </div>
                )}
              </aside>
            </div>
            {tablet && open ? (
              <div className="ls-sidebar-scrim" onClick={close} aria-hidden />
            ) : null}
          </>
        )}
        <main className={cx('ls-content', mainClassName)} id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

/** The grouped navigation list. Active item: `aria-current="page"`. Labels stay in the DOM in the rail. */
export function SidebarNav({
  groups,
  label,
  rail = false,
  LinkComponent = PlainLink,
  onNavigate,
}: {
  groups: readonly ArrangedNavGroup[];
  label: string;
  rail?: boolean | undefined;
  LinkComponent?: ShellLink | undefined;
  onNavigate?: (() => void) | undefined;
}) {
  const prefix = useId();
  const currentId = currentGroupId(groups);
  const preferences = useContext(ShellPreferencesContext);
  // With the provider the open groups come from a cookie the server read, so the first paint already shows them. Without it
  // the stored state is read after hydration (until then only the group with the current page is open).
  const [localStored, setLocalStored] = useState<NavGroupState>({});
  const stored = preferences ? preferences.state.groups : localStored;
  // The group holding the current page opens itself, on load and whenever the page moves into another group, and stays open
  // after the page leaves it until the person closes it. Adjusted while rendering when the current group changes (no effect).
  const [closedCurrent, setClosedCurrent] = useState<string | null>(null);
  const [opened, setOpened] = useState<NavGroupState>(() =>
    currentId ? { [currentId]: true } : {},
  );
  const [seenCurrent, setSeenCurrent] = useState(currentId);
  if (currentId !== seenCurrent) {
    setSeenCurrent(currentId);
    setClosedCurrent(null);
    if (currentId) setOpened((previous) => ({ ...previous, [currentId]: true }));
  }

  useEffect(() => {
    if (!preferences) {
      setLocalStored(readNavGroupState());
      return;
    }
    // A device that chose before the cookie existed: carry its stored groups over once.
    if (!preferences.known.groups) {
      const saved = readNavGroupState();
      if (Object.keys(saved).length > 0) {
        writeNavGroupState(saved);
        preferences.update({ groups: saved });
      }
    }
    // Only on mount.
  }, []);

  const isOpen = (id: string) =>
    id === currentId && closedCurrent !== currentId ? true : (opened[id] ?? stored[id] ?? false);

  // The choice is saved where it is made (rbp rerender-move-effect-to-event), with the current group's state as shown.
  const toggle = (id: string, open: boolean) => {
    const next: NavGroupState = {
      ...stored,
      ...(currentId ? { [currentId]: isOpen(currentId) } : {}),
      [id]: !open,
    };
    if (id === currentId) setClosedCurrent(open ? id : null);
    setOpened((previous) => {
      const rest: Record<string, boolean> = { ...previous };
      delete rest[id];
      return rest;
    });
    writeNavGroupState(next);
    if (preferences) preferences.update({ groups: next });
    else setLocalStored(next);
  };

  // The current page's highlight is one element that slides to the next page (pattern M8). A collapsed group clips its
  // items, so the pill hides with it (the rail shows every group open).
  const current = groups
    .flatMap((group) => group.items.map((item) => `${item.id}${item.current ? '*' : ''}`))
    .join('|');
  const menu = useSlidingPill(`${rail ? 'rail' : 'full'}:${current}`, {
    hidden: (link, element) =>
      element.dataset['rail'] !== 'true' &&
      link.closest('.ls-nav-collapse')?.getAttribute('data-open') === 'false',
    watch: '.ls-nav-collapse',
  });

  return (
    <nav ref={menu} className="ls-nav" aria-label={label} data-rail={rail}>
      <span className="ls-sidebar-pill" aria-hidden="true" />
      {groups.map((group) => {
        const headingId = `${prefix}-${group.id}`;
        const panelId = `${prefix}-${group.id}-items`;
        const open = group.flat || isOpen(group.id);
        return (
          <div className="ls-nav-group" key={group.id}>
            {group.flat ? null : rail ? (
              // The icon rail has no headers; the name stays for assistive technology.
              <p className="ls-nav-heading" id={headingId}>
                {group.label}
              </p>
            ) : (
              <button
                type="button"
                className="ls-nav-heading ls-nav-heading-button"
                id={headingId}
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => toggle(group.id, open)}
              >
                <span className="ls-nav-heading-text">{group.label}</span>
                <Icon name="chevron-down" size={16} className="ls-nav-chevron" />
              </button>
            )}
            {/* The wrapper animates the group open and closed (grid rows 0fr to 1fr); the list inside clips. */}
            <div className="ls-nav-collapse" data-open={open}>
              <ul
                className="ls-nav-list"
                id={panelId}
                data-open={open}
                {...(group.flat ? {} : { 'aria-labelledby': headingId })}
              >
                {group.items.map((item) => (
                  <li key={item.id}>
                    <LinkComponent
                      href={item.href}
                      className="ls-nav-link"
                      aria-current={item.current ? 'page' : undefined}
                      title={rail ? item.label : undefined}
                      {...(onNavigate ? { onClick: onNavigate } : {})}
                    >
                      <Icon name={item.icon} />
                      <span className="ls-nav-label">{item.label}</span>
                    </LinkComponent>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Avatar button that opens a panel with the account name, links, settings and sign-out. The panel
 * content is composed by the app (children); this component owns the trigger, focus and dismissal.
 */
export function UserMenu({
  name,
  subtitle,
  triggerLabel,
  children,
}: {
  name: string;
  subtitle?: string | undefined;
  /** Accessible name of the trigger, for example "Tài khoản". */
  triggerLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  return (
    <span className="ls-usermenu">
      <button
        ref={triggerRef}
        type="button"
        className="ls-usermenu-trigger"
        aria-label={`${triggerLabel}: ${name}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="ls-avatar" aria-hidden>
          {initials(name)}
        </span>
        <span className="ls-usermenu-name" aria-hidden>
          {name}
        </span>
        {/* C74: the signed-in name is never hidden. Where the full name has no room (under 1024 css px, 200 % zoom), the given name stays:
            the last word of a Vietnamese name. */}
        <span className="ls-usermenu-short" aria-hidden>
          {name.trim().split(/\s+/).pop()}
        </span>
        <Icon name="chevron-down" size={16} />
      </button>
      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        align="end"
        id={panelId}
        className="ls-usermenu-panel"
      >
        <div className="ls-usermenu-header">
          <span className="ls-avatar ls-avatar-lg" aria-hidden>
            {initials(name)}
          </span>
          <span className="ls-usermenu-who">
            <strong>{name}</strong>
            {subtitle ? <span>{subtitle}</span> : null}
          </span>
        </div>
        <div
          onClick={(event) => {
            // Choosing a link closes the panel; controls inside (theme, language) keep it open.
            if ((event.target as HTMLElement).closest('a[href]')) close();
          }}
        >
          {children}
        </div>
      </Popover>
    </span>
  );
}

export interface Crumb {
  label: string;
  /** Omit on the current page. */
  href?: string | undefined;
}

/** Shown above the page title on detail pages only (contract 4.1). The last crumb is the page. */
export function Breadcrumbs({
  label,
  items,
  LinkComponent = PlainLink,
}: {
  label: string;
  items: readonly Crumb[];
  LinkComponent?: ShellLink | undefined;
}) {
  return (
    <nav className="ls-crumbs" aria-label={label}>
      <ol>
        {items.map((crumb, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${index}-${crumb.label}`}>
              {last || !crumb.href ? (
                <span aria-current={last ? 'page' : undefined}>{crumb.label}</span>
              ) : (
                <LinkComponent href={crumb.href} className="ls-link">
                  {crumb.label}
                </LinkComponent>
              )}
              {last ? null : <Icon name="chevron-right" size={14} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
