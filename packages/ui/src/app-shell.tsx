'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { IconButton } from './button';
import { cx } from './cx';
import { Icon } from './icons';
import { Drawer } from './overlay';
import { Popover } from './popover';
import {
  TABLET_QUERY,
  arrangeNav,
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
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement | null>(null);
  const groups = arrangeNav(nav);

  // Stored state is read after hydration so the server and first client render agree.
  useEffect(() => setCollapsed(readSidebarCollapsed()), []);

  const close = useCallback(() => setOpen(false), []);
  // A resize to another layout must not leave an overlay or drawer open.
  useEffect(() => setOpen(false), [phone, tablet]);

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
    setCollapsed((value) => {
      writeSidebarCollapsed(!value);
      return !value;
    });
  }

  const rail = tablet ? !open : collapsed;
  const navigation = (
    <SidebarNav
      groups={groups}
      label={labels.nav}
      rail={phone ? false : rail}
      LinkComponent={LinkComponent}
      onNavigate={close}
    />
  );

  return (
    <div className={cx('ls-shell', className)}>
      <header className="ls-topbar">
        {/* Always rendered and hidden by CSS on desktop, so a tablet or phone does not flash the desktop layout. */}
        <IconButton
          ref={menuButton}
          className="ls-menu-button"
          icon="menu"
          label={open ? labels.closeMenu : labels.menu}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        />
        <div className="ls-topbar-brand">{brand}</div>
        <div className="ls-topbar-end">
          {topbar}
          <div className="ls-topbar-extras">{topbarExtras}</div>
          {topbarEnd}
        </div>
      </header>
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
  // Stored state is read after hydration so the server and first client render agree: until then only
  // the group with the current page is open.
  const [stored, setStored] = useState<NavGroupState>({});
  const loaded = useRef(false);

  useEffect(() => {
    setStored((previous) => ({
      ...readNavGroupState(),
      ...previous,
      ...(currentId ? { [currentId]: true } : {}),
    }));
    loaded.current = true;
    // Only on mount; later page changes are handled by the next effect.
  }, []);

  // The group holding the current page opens itself when the page changes.
  useEffect(() => {
    if (!currentId) return;
    setStored((previous) =>
      previous[currentId] === true ? previous : { ...previous, [currentId]: true },
    );
  }, [currentId]);

  useEffect(() => {
    if (loaded.current) writeNavGroupState(stored);
  }, [stored]);

  const toggle = (id: string, open: boolean) =>
    setStored((previous) => ({ ...previous, [id]: !open }));

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
        const open = group.flat || (stored[group.id] ?? group.id === currentId);
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
