import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { installDom } from './dom-harness';
import type { ShellNavGroup } from './index';

// Step 5: app shell, theme toggle, user menu, breadcrumbs and the split auth layout, in a real DOM.
const dom = installDom('http://localhost/vi/workforce');
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { renderToStaticMarkup } = await import('react-dom/server');
const ui = await import('./index');

function mount(node: React.ReactNode) {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const click = (element: Element) =>
  act(() => {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
const press = (element: Element, key: string) =>
  act(() => {
    element.dispatchEvent(
      new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
const $ = (container: ParentNode, selector: string) => container.querySelector(selector);
const $$ = (container: ParentNode, selector: string) => [...container.querySelectorAll(selector)];

const LONG = 'Khách hàng vãng lai và đặt lịch theo từng chi nhánh';
const nav: ShellNavGroup[] = [
  {
    id: 'overview',
    label: 'Tổng quan',
    items: [{ id: 'dashboard', label: 'Tổng quan', href: '/w', icon: 'home', current: false }],
  },
  {
    id: 'operations',
    label: 'Vận hành',
    items: [
      { id: 'board', label: 'Lịch hẹn hôm nay', href: '/w/board', icon: 'calendar', current: true },
      { id: 'walkin', label: LONG, href: '/w/walk-in', icon: 'user-plus' },
    ],
  },
  { id: 'sales', label: 'Thanh toán', items: [] },
];
const labels = {
  nav: 'Điều hướng nhân sự',
  menu: 'Menu',
  closeMenu: 'Đóng menu',
  collapse: 'Thu gọn thanh bên',
  expand: 'Mở rộng thanh bên',
};

function shell() {
  return (
    <ui.AppShell
      brand={<span>Lucy Spa</span>}
      nav={nav}
      labels={labels}
      topbar={<button type="button">bell</button>}
      topbarExtras={<span id="extras">theme</span>}
    >
      <h1>Trang</h1>
    </ui.AppShell>
  );
}

test('desktop: grouped sidebar, hidden empty group, flat single item, current page marked', () => {
  window.localStorage.clear();
  const view = mount(shell());
  const navigation = $(view.container, 'nav[aria-label="Điều hướng nhân sự"]')!;
  assert.ok(navigation, 'named navigation landmark');
  assert.deepEqual(
    $$(navigation, '.ls-nav-heading').map((heading) => heading.textContent),
    ['Vận hành'],
    'only the multi-item group has a heading; the empty group is hidden',
  );
  assert.equal($$(navigation, 'a').length, 3);
  const current = $$(navigation, '[aria-current="page"]');
  assert.equal(current.length, 1);
  assert.equal(current[0]!.textContent, 'Lịch hẹn hôm nay');
  assert.ok($(view.container, 'main#main-content h1'), 'content sits in the skip-link target');
  assert.ok($(view.container, '#extras'), 'theme and language slot is rendered');
  view.unmount();
});

test('desktop: the sidebar collapses to an icon rail, keeps labels for assistive tech and remembers it', () => {
  window.localStorage.clear();
  const view = mount(shell());
  const aside = $(view.container, 'aside.ls-sidebar')!;
  assert.equal(aside.getAttribute('data-rail'), 'false');
  click($(view.container, '.ls-sidebar-toggle')!);
  assert.equal(aside.getAttribute('data-rail'), 'true');
  assert.equal(window.localStorage.getItem(ui.SIDEBAR_COLLAPSED_KEY), '1');
  const links = $$(aside, 'a.ls-nav-link');
  assert.ok(
    links.every((link) => link.textContent!.length > 0),
    'labels stay in the DOM for screen readers',
  );
  assert.equal(links[0]!.getAttribute('title'), 'Tổng quan', 'and show as a tooltip in the rail');
  const toggle = $(view.container, '.ls-sidebar-toggle')!;
  assert.equal(toggle.getAttribute('aria-label'), labels.expand);
  view.unmount();

  // A later visit starts collapsed.
  const again = mount(shell());
  assert.equal($(again.container, 'aside.ls-sidebar')!.getAttribute('data-rail'), 'true');
  again.unmount();
  window.localStorage.clear();
});

test('phone: no sidebar; the menu button opens a drawer with the same navigation, links close it', () => {
  dom.setPhone(true);
  const view = mount(shell());
  assert.equal($(view.container, 'aside.ls-sidebar'), null);
  const menu = $(view.container, '.ls-menu-button') as HTMLButtonElement;
  assert.equal(menu.getAttribute('aria-expanded'), 'false');
  click(menu);
  const drawer = $(window.document, '.ls-nav-drawer')!;
  assert.ok(drawer, 'drawer is open');
  assert.equal(drawer.getAttribute('role'), 'dialog');
  assert.equal($$(drawer, 'a.ls-nav-link').length, 3);
  click($$(drawer, 'a.ls-nav-link')[1]!);
  assert.equal($(window.document, '.ls-nav-drawer'), null, 'choosing a page closes the drawer');
  click(menu);
  press($(window.document, '.ls-nav-drawer')!, 'Escape');
  assert.equal($(window.document, '.ls-nav-drawer'), null, 'Escape closes it');
  view.unmount();
  dom.setPhone(false);
});

test('tablet: an icon rail that expands as an overlay; Escape and the scrim close it', () => {
  dom.setTablet(true);
  const view = mount(shell());
  const aside = $(view.container, 'aside.ls-sidebar')!;
  assert.equal(aside.getAttribute('data-rail'), 'true');
  assert.equal(
    $(view.container, '.ls-sidebar-toggle'),
    null,
    'the collapse toggle is desktop only',
  );
  const menu = $(view.container, '.ls-menu-button') as HTMLButtonElement;
  click(menu);
  assert.equal(aside.getAttribute('data-rail'), 'false', 'labels show while expanded');
  assert.equal(aside.getAttribute('data-overlay'), 'true');
  assert.ok($(view.container, '.ls-sidebar-scrim'));
  menu.focus();
  act(() => {
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  });
  assert.equal(aside.getAttribute('data-overlay'), null);
  assert.equal(window.document.activeElement, menu, 'focus returns to the menu button');
  click(menu);
  click($(view.container, '.ls-sidebar-scrim')!);
  assert.equal($(view.container, '.ls-sidebar-scrim'), null, 'pressing outside closes it');
  view.unmount();
  dom.setTablet(false);
});

test('ThemeToggle: one tab stop, arrows select, the choice is stored in the cookie', () => {
  window.document.cookie = 'ls-theme=; Max-Age=0; Path=/';
  const toggleLabels = { group: 'Giao diện', light: 'Sáng', dark: 'Tối', system: 'Theo hệ thống' };
  const view = mount(<ui.ThemeToggle labels={toggleLabels} />);
  const group = $(view.container, '[role="radiogroup"]')!;
  assert.equal(group.getAttribute('aria-label'), 'Giao diện');
  const radios = $$(group, '[role="radio"]') as HTMLElement[];
  assert.deepEqual(
    radios.map((radio) => radio.getAttribute('aria-label')),
    ['Sáng', 'Tối', 'Theo hệ thống'],
    'icon-only options still have names',
  );
  assert.deepEqual(
    radios.map((radio) => radio.getAttribute('aria-checked')),
    ['false', 'false', 'true'],
    'no cookie means System',
  );
  assert.deepEqual(
    radios.map((radio) => radio.getAttribute('tabindex')),
    ['-1', '-1', '0'],
  );
  radios[2]!.focus();
  press(radios[2]!, 'ArrowRight');
  assert.equal(window.document.activeElement, radios[0], 'wraps to Light');
  assert.equal(radios[0]!.getAttribute('aria-checked'), 'true');
  assert.equal(window.document.documentElement.getAttribute('data-theme'), 'light');
  assert.match(window.document.cookie, /ls-theme=light/);
  click(radios[1]!);
  assert.equal(window.document.documentElement.getAttribute('data-theme'), 'dark');
  click(radios[2]!);
  assert.equal(
    window.document.documentElement.getAttribute('data-theme'),
    null,
    'System clears it',
  );
  assert.doesNotMatch(window.document.cookie, /ls-theme=/);
  view.unmount();
});

test('ThemeToggle with labels shows the text (user menu on phones)', () => {
  const markup = renderToStaticMarkup(
    <ui.ThemeToggle
      withLabels
      labels={{ group: 'Giao diện', light: 'Sáng', dark: 'Tối', system: 'Theo hệ thống' }}
    />,
  );
  assert.ok(markup.includes('Theo hệ thống') && markup.includes('ls-theme-toggle-labeled'));
});

test('UserMenu: opens on click, shows name and title, closes on Escape and when a link is chosen', () => {
  const view = mount(
    <ui.UserMenu name="Nguyễn Văn An" subtitle="Quản lý" triggerLabel="Tài khoản">
      <a className="ls-usermenu-link" href="#account">
        Tài khoản của tôi
      </a>
      <button type="button" id="inside">
        Giữ mở
      </button>
    </ui.UserMenu>,
  );
  const trigger = $(view.container, '.ls-usermenu-trigger') as HTMLButtonElement;
  assert.equal(trigger.getAttribute('aria-label'), 'Tài khoản: Nguyễn Văn An');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal($(view.container, '.ls-avatar')!.textContent, 'NA');
  click(trigger);
  const panel = $(view.container, '.ls-usermenu-panel')!;
  assert.ok(panel.textContent!.includes('Nguyễn Văn An') && panel.textContent!.includes('Quản lý'));
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  click($(panel, '#inside')!);
  assert.ok($(view.container, '.ls-usermenu-panel'), 'controls inside keep it open');
  act(() => {
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  });
  assert.equal($(view.container, '.ls-usermenu-panel'), null, 'Escape closes');
  click(trigger);
  click($(view.container, 'a.ls-usermenu-link')!);
  assert.equal($(view.container, '.ls-usermenu-panel'), null, 'choosing a link closes');
  view.unmount();
});

test('Breadcrumbs: the last crumb is the current page and is not a link', () => {
  const markup = renderToStaticMarkup(
    <ui.Breadcrumbs
      label="Đường dẫn"
      items={[
        { label: 'Nhân viên', href: '/w/employees' },
        { label: 'Nguyễn Văn An', href: '/w/employees/1' },
        { label: 'Vai trò' },
      ]}
    />,
  );
  assert.ok(markup.includes('aria-label="Đường dẫn"'));
  assert.equal(markup.match(/<a /g)?.length, 2);
  assert.ok(markup.includes('aria-current="page">Vai trò</span>'));
});

test('AuthLayout: brand panel for wide screens, form column, decoration hidden from assistive tech', () => {
  const markup = renderToStaticMarkup(
    <ui.AuthLayout
      brand={<span>LUCY SPA</span>}
      tagline="Chăm sóc từng khách hàng, mỗi ngày."
      topActions={<a href="#en">English</a>}
    >
      <h1>Đăng nhập nhân sự</h1>
      <form />
    </ui.AuthLayout>,
  );
  const panel =
    /<div class="ls-auth-panel" aria-hidden="true">([\s\S]*?)<\/div><div class="ls-auth-side">/.exec(
      markup,
    );
  assert.ok(panel, 'the panel is decorative and aria-hidden');
  assert.ok(panel[1]!.includes('Chăm sóc từng khách hàng, mỗi ngày.'), 'tagline');
  assert.ok(panel[1]!.includes('LUCY SPA'), 'wordmark');
  assert.ok(panel[1]!.includes('<svg') && panel[1]!.includes('<pattern'), 'botanical SVG pattern');
  assert.doesNotMatch(markup, /<img|url\((?!#)|https?:/, 'no external or raster image');
  assert.match(markup, /<main class="ls-auth-main" id="main-content" tabindex="-1">/);
  assert.ok(
    markup.indexOf('ls-auth-side') < markup.indexOf('<h1>'),
    'the form is in the side column',
  );
  assert.ok(markup.includes('English'), 'language and theme controls are top right');
});

test('BotanicalPattern: two instances on one page never share ids', () => {
  const markup = renderToStaticMarkup(
    <>
      <ui.BotanicalPattern />
      <ui.BotanicalPattern />
    </>,
  );
  const ids = [...markup.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  assert.ok(ids.length >= 4);
  assert.ok(
    ids.every((id) => /^[\w-]+$/.test(id!)),
    'safe inside url(#id)',
  );
});

// ---- Stylesheet contract ---------------------------------------------------------------------------
const shellCss = readFileSync(new URL('shell.css', import.meta.url), 'utf8');
const block = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.[\]()]/g, '\\$&');
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
};

test('auth styles: form only on phones, split from 768 px, gradient from tokens, subtle art, no motion', () => {
  assert.match(block(shellCss, '.ls-auth-panel'), /display:\s*none/, 'phone shows the form only');
  const wide = /@media \(min-width: 768px\) \{([\s\S]*)\n\}\n?$/.exec(shellCss)?.[1] ?? '';
  assert.match(
    wide,
    /\.ls-auth \{[^}]*grid-template-columns:\s*minmax\(20rem, 5fr\) minmax\(0, 6fr\)/,
  );
  assert.match(wide, /\.ls-auth-panel \{[^}]*display:\s*flex/, 'panel appears on wide screens');
  assert.match(
    wide,
    /linear-gradient\([^)]*var\(--ls-auth-panel-from\)[^)]*var\(--ls-auth-panel-to\)\)/,
    'gradient uses the theme tokens, so light and dark both work',
  );
  const opacity = Number(/\.ls-auth-pattern \{[^}]*opacity:\s*([\d.]+)/.exec(wide)?.[1]);
  assert.ok(opacity > 0 && opacity <= 0.15, `line art is very subtle (opacity ${opacity})`);
  assert.match(wide, /\.ls-auth-top-brand \{[^}]*display:\s*none/, 'wordmark is not doubled');
  assert.doesNotMatch(shellCss, /@keyframes|animation\s*:/, 'no heavy animation');
  assert.doesNotMatch(shellCss, /url\(/, 'no external images');
});

test('shell styles: tokens only, rail and overlay on tablet, phone hides the sidebar, 44 px targets', () => {
  assert.doesNotMatch(shellCss, /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/i, 'no color literals');
  assert.match(shellCss, /@media \(min-width: 640px\) and \(max-width: 1023px\)/);
  assert.match(shellCss, /\.ls-sidebar\[data-overlay\] \{[^}]*position:\s*fixed/);
  assert.match(
    /@media \(max-width: 639px\) \{\s*\.ls-sidebar-slot \{([^}]*)\}/.exec(shellCss)?.[1] ?? '',
    /display:\s*none/,
  );
  assert.match(
    block(shellCss, '.ls-nav-link,\n.ls-sidebar-toggle'),
    /min-height:\s*var\(--ls-control-h\)/,
  );
  assert.match(block(shellCss, '.ls-topbar'), /position:\s*sticky/);
  assert.match(
    block(shellCss, ".ls-nav-link[aria-current='page']"),
    /box-shadow:\s*inset/,
    'edge bar, not color only',
  );
});
