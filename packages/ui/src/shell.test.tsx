import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { installDom } from './dom-harness';
import type { ShellNavGroup } from './index';

// Step 5: app shell, theme toggle, user menu, breadcrumbs and the split auth layout, in a real DOM.
const dom = installDom('http://localhost/vi/workforce');
const { window } = dom;
after(() => window.close());
const { act, useState } = await import('react');
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

const accordionNav: ShellNavGroup[] = [
  {
    id: 'operations',
    label: 'Vận hành',
    items: [
      { id: 'board', label: 'Lịch hẹn', href: '/w/board', icon: 'calendar' },
      { id: 'walkin', label: 'Khách vãng lai', href: '/w/walk-in', icon: 'user-plus' },
    ],
  },
  {
    id: 'people',
    label: 'Nhân sự',
    items: [
      { id: 'employees', label: 'Nhân viên', href: '/w/employees', icon: 'users', current: true },
      { id: 'teams', label: 'Đội nhóm', href: '/w/teams', icon: 'users' },
    ],
  },
];

test('sidebar groups: accordion buttons, the current group opens, several stay open, state is remembered', () => {
  window.localStorage.clear();
  const view = mount(
    <ui.SidebarNav groups={ui.arrangeNav(accordionNav)} label="Điều hướng nhân sự" />,
  );
  const headers = () => $$(view.container, 'button.ls-nav-heading') as HTMLElement[];
  const [operations, people] = headers();
  assert.equal(headers().length, 2, 'every multi-item group has a header button');
  assert.equal(operations!.getAttribute('aria-expanded'), 'false', 'other groups start closed');
  assert.equal(
    people!.getAttribute('aria-expanded'),
    'true',
    'the group with the current page is open',
  );
  assert.equal(
    $(view.container, '.ls-nav-list[data-open="true"]')!.id,
    people!.getAttribute('aria-controls'),
    'the button controls its list',
  );
  assert.equal(
    $$(view.container, '.ls-nav-list')
      .map((list) => list.getAttribute('data-open'))
      .join(),
    'false,true',
  );
  assert.ok($(view.container, '.ls-nav-chevron'), 'a chevron on each header');

  click(operations!);
  assert.deepEqual(
    headers().map((header) => header.getAttribute('aria-expanded')),
    ['true', 'true'],
    'several groups may be open at once',
  );
  assert.deepEqual(JSON.parse(window.localStorage.getItem(ui.SIDEBAR_GROUPS_KEY)!), {
    operations: true,
    people: true,
  });
  click(people!);
  assert.equal(
    headers()[1]!.getAttribute('aria-expanded'),
    'false',
    'the current group can be closed',
  );
  view.unmount();

  // A new visit restores what was remembered, and the current group opens itself again.
  window.localStorage.setItem(
    ui.SIDEBAR_GROUPS_KEY,
    JSON.stringify({ operations: true, people: false }),
  );
  const again = mount(
    <ui.SidebarNav groups={ui.arrangeNav(accordionNav)} label="Điều hướng nhân sự" />,
  );
  assert.deepEqual(
    ($$(again.container, 'button.ls-nav-heading') as HTMLElement[]).map((header) =>
      header.getAttribute('aria-expanded'),
    ),
    ['true', 'true'],
    'remembered open group, and the current page forces its own group open',
  );
  again.unmount();
});

test('sidebar groups: the icon rail has no header buttons and shows every item', () => {
  window.localStorage.clear();
  const view = mount(
    <ui.SidebarNav groups={ui.arrangeNav(accordionNav)} label="Điều hướng nhân sự" rail />,
  );
  assert.equal($$(view.container, 'button').length, 0);
  assert.equal($$(view.container, 'p.ls-nav-heading').length, 2, 'names stay for assistive tech');
  assert.equal($$(view.container, 'a.ls-nav-link').length, 4);
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
  const toggleLabels = { group: 'Giao diện', light: 'Sáng', dark: 'Tối', auto: 'Tự động theo giờ' };
  const view = mount(<ui.ThemeToggle labels={toggleLabels} />);
  const group = $(view.container, '[role="radiogroup"]')!;
  assert.equal(group.getAttribute('aria-label'), 'Giao diện');
  const radios = $$(group, '[role="radio"]') as HTMLElement[];
  assert.deepEqual(
    radios.map((radio) => radio.getAttribute('aria-label')),
    ['Sáng', 'Tối', 'Tự động theo giờ'],
    'icon-only options still have names',
  );
  assert.deepEqual(
    radios.map((radio) => radio.getAttribute('aria-checked')),
    ['false', 'false', 'true'],
    'no cookie means Auto by time',
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
    ui.resolveTheme('auto', new Date()),
    'Auto by time follows the local hour',
  );
  assert.doesNotMatch(window.document.cookie, /ls-theme=/);
  view.unmount();
});

test('ThemeToggle with labels shows the text (user menu on phones)', () => {
  const markup = renderToStaticMarkup(
    <ui.ThemeToggle
      withLabels
      labels={{ group: 'Giao diện', light: 'Sáng', dark: 'Tối', auto: 'Tự động theo giờ' }}
    />,
  );
  assert.ok(markup.includes('Tự động theo giờ') && markup.includes('ls-theme-toggle-labeled'));
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

test('AuthLayout: centered card with the wordmark inside, controls top right, art behind', () => {
  const markup = renderToStaticMarkup(
    <ui.AuthLayout brand={<span>LUCY SPA</span>} topActions={<a href="#en">English</a>}>
      <h1>Đăng nhập nhân sự</h1>
      <form />
    </ui.AuthLayout>,
  );
  assert.doesNotMatch(markup, /ls-auth-panel|ls-auth-side|ls-auth-tagline/, 'no split layout');
  const svg = /<svg class="ls-auth-pattern"[^>]*aria-hidden="true"/.exec(markup);
  assert.ok(svg && markup.includes('<pattern'), 'botanical SVG, hidden from assistive tech');
  assert.doesNotMatch(markup, /<img|url\((?!#)|https?:/, 'no external or raster image');
  assert.match(markup, /<main class="ls-auth-main" id="main-content" tabindex="-1">/);
  const card = markup.indexOf('class="ls-auth-card"');
  assert.ok(card > 0);
  assert.ok(
    card < markup.indexOf('LUCY SPA', card) &&
      markup.indexOf('LUCY SPA', card) < markup.indexOf('<h1>'),
    'the wordmark is at the top inside the card, above the title',
  );
  assert.ok(
    markup.indexOf('class="ls-auth-top"') < markup.indexOf('English') &&
      markup.indexOf('English') < card,
    'language and theme controls sit in the top strip, before the card',
  );
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

test('segmentedTarget: arrows wrap, Home/End jump, other keys are ignored', () => {
  assert.equal(ui.segmentedTarget('ArrowRight', 0, 2), 1);
  assert.equal(ui.segmentedTarget('ArrowRight', 1, 2), 0);
  assert.equal(ui.segmentedTarget('ArrowLeft', 0, 2), 1);
  assert.equal(ui.segmentedTarget('ArrowUp', 1, 3), 0);
  assert.equal(ui.segmentedTarget('Home', 2, 3), 0);
  assert.equal(ui.segmentedTarget('End', 0, 3), 2);
  assert.equal(ui.segmentedTarget('a', 0, 2), null);
  assert.equal(ui.segmentedTarget('ArrowRight', 0, 0), null);
});

test('SegmentedControl: two-option radio group, one tab stop, arrows and clicks select', () => {
  const seen: string[] = [];
  function Harness() {
    const [value, setValue] = useState<'EMPLOYEE_ID' | 'EMAIL'>('EMPLOYEE_ID');
    return (
      <ui.SegmentedControl
        label="Đăng nhập bằng"
        value={value}
        onChange={(next) => {
          seen.push(next);
          setValue(next);
        }}
        options={[
          { value: 'EMPLOYEE_ID', label: 'Mã nhân viên' },
          { value: 'EMAIL', label: 'Email' },
        ]}
      />
    );
  }
  const view = mount(<Harness />);
  const group = $(view.container, '[role="radiogroup"]')!;
  assert.equal(group.getAttribute('aria-label'), 'Đăng nhập bằng');
  const radios = $$(group, '[role="radio"]') as HTMLElement[];
  assert.deepEqual(
    radios.map((radio) => [radio.textContent, radio.getAttribute('aria-checked')]),
    [
      ['Mã nhân viên', 'true'],
      ['Email', 'false'],
    ],
  );
  assert.deepEqual(
    radios.map((radio) => radio.getAttribute('tabindex')),
    ['0', '-1'],
    'one tab stop',
  );
  radios[0]!.focus();
  press(radios[0]!, 'ArrowRight');
  assert.equal(window.document.activeElement, radios[1], 'focus follows the selection');
  assert.equal(radios[1]!.getAttribute('aria-checked'), 'true');
  press(radios[1]!, 'Home');
  assert.equal(radios[0]!.getAttribute('aria-checked'), 'true');
  click(radios[1]!);
  assert.deepEqual(seen, ['EMAIL', 'EMPLOYEE_ID', 'EMAIL']);
  assert.ok(
    radios.every((radio) => radio.getAttribute('type') === 'button'),
    'never submits a form',
  );
  view.unmount();
});

test('PasswordInput: hidden by default, a named button shows and hides it, the value is kept', () => {
  const view = mount(
    <ui.PasswordInput
      id="pw"
      name="password"
      showLabel="Hiện mật khẩu"
      hideLabel="Ẩn mật khẩu"
      autoComplete="current-password"
      defaultValue="bí mật"
    />,
  );
  const input = $(view.container, 'input') as HTMLInputElement;
  const button = $(view.container, 'button.ls-password-toggle') as HTMLButtonElement;
  assert.equal(input.type, 'password');
  assert.equal(input.getAttribute('autocomplete'), 'current-password');
  assert.equal(button.getAttribute('aria-label'), 'Hiện mật khẩu');
  assert.equal(button.getAttribute('type'), 'button', 'does not submit the form');
  assert.ok($(button, 'svg'), 'eye icon');
  click(button);
  assert.equal(input.type, 'text');
  assert.equal(input.value, 'bí mật');
  assert.equal(button.getAttribute('aria-label'), 'Ẩn mật khẩu');
  click(button);
  assert.equal(input.type, 'password');
  view.unmount();
});

test('Field: labelAction sits at the right end of the label row, outside the label', () => {
  const markup = renderToStaticMarkup(
    <ui.Field id="p" label="Mật khẩu" required labelAction={<a href="#f">Quên mật khẩu?</a>}>
      <input id="p" />
    </ui.Field>,
  );
  assert.match(
    markup,
    /<div class="ls-label-row"><label[^>]*>Mật khẩu[\s\S]*?<\/label><span class="ls-label-action"><a href="#f">Quên mật khẩu\?<\/a><\/span><\/div>/,
  );
  const plain = renderToStaticMarkup(
    <ui.Field id="p" label="Mật khẩu">
      <input id="p" />
    </ui.Field>,
  );
  assert.doesNotMatch(plain, /ls-label-row/, 'no row without an action');
});

// ---- Stylesheet contract ---------------------------------------------------------------------------
const shellCss = readFileSync(new URL('shell.css', import.meta.url), 'utf8');
const block = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.[\]()*+?]/g, '\\$&');
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
};

test('Breadcrumb links are full-size targets, even a one-word name such as "Nail"', () => {
  const link = block(shellCss, '.ls-crumbs a');
  assert.match(link, /min-width: var\(--ls-control-h\)/);
  assert.match(link, /min-height: var\(--ls-control-h\)/);
});

test('SegmentedControl: one sliding thumb positioned by the selected index, solid brand fill, no border', () => {
  const markup = renderToStaticMarkup(
    <ui.SegmentedControl
      label="Đăng nhập bằng"
      value="EMAIL"
      onChange={() => undefined}
      options={[
        { value: 'EMPLOYEE_ID', label: 'Mã nhân viên' },
        { value: 'EMAIL', label: 'Email' },
      ]}
    />,
  );
  assert.match(markup, /--seg-count:2/);
  assert.match(markup, /--seg-index:1/, 'the thumb sits under the selected option');
  assert.equal(markup.match(/ls-segmented-thumb/g)?.length, 1, 'one thumb, not one per option');
  const components = readFileSync(new URL('components.css', import.meta.url), 'utf8');
  const track = block(components, '.ls-segmented');
  assert.doesNotMatch(track, /border\s*:/, 'no border on the track');
  assert.match(track, /background:\s*var\(--ls-bg-sunken\)/, 'subtle neutral track');
  const thumb = block(components, '.ls-segmented-thumb');
  assert.match(thumb, /background:\s*var\(--ls-brand-fill\)/, 'solid brand fill in both themes');
  assert.match(
    thumb,
    /transition:\s*transform var\(--ls-dur-slow\) var\(--ls-ease-out\)/,
    'slides',
  );
  assert.match(
    block(components, '.ls-segment-active,\n.ls-segment-active:hover'),
    /color:\s*var\(--ls-on-brand\)/,
  );
});

test('ThemeInitScript: in the server HTML, never created on the client (no React script warning)', () => {
  assert.match(
    renderToStaticMarkup(<ui.ThemeInitScript />),
    /<script>[^<]*ls-theme[^<]*<\/script>/,
  );
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    const view = mount(<ui.ThemeInitScript />);
    assert.equal($(view.container, 'script'), null, 'a client render creates no script element');
    view.unmount();
  } finally {
    console.error = original;
  }
  assert.deepEqual(errors, [], 'nothing logged');
});

test('motion tokens: 150-250 ms ease-out, used by the micro-interactions, all off for reduced motion', () => {
  const tokens = readFileSync(new URL('tokens.css', import.meta.url), 'utf8');
  const ms = (name: string) => Number(new RegExp(`${name}:\\s*(\\d+)ms`).exec(tokens)?.[1]);
  assert.deepEqual(
    [ms('--ls-dur-fast'), ms('--ls-dur-base'), ms('--ls-dur-slow')],
    [150, 200, 250],
  );
  assert.match(tokens, /--ls-ease-out:\s*cubic-bezier\(0, 0, 0\.2, 1\)/);
  assert.match(tokens, /--ls-press-scale:\s*0\.9[5-9]/, 'a slight press scale');
  const reduced =
    /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/.exec(tokens)?.[1] ?? '';
  for (const name of [
    '--ls-dur-fast: 0ms',
    '--ls-dur-base: 0ms',
    '--ls-dur-slow: 0ms',
    '--ls-press-scale: 1',
  ]) {
    assert.ok(reduced.includes(name), `reduced motion sets ${name}`);
  }
  const components = readFileSync(new URL('components.css', import.meta.url), 'utf8');
  const all = components + '\n' + shellCss;
  // Every transition reads the tokens: no millisecond literal, no cinematic properties.
  for (const match of all.matchAll(/transition:([^;]*);/g)) {
    assert.doesNotMatch(match[1]!, /\d+m?s\b/, `transition uses tokens: ${match[1]}`);
  }
  assert.match(block(components, '.ls-btn'), /transform var\(--ls-dur-fast\) var\(--ls-ease-out\)/);
  assert.match(
    components,
    /\.ls-btn:active:not\(:disabled\)[^{]*\{[^}]*scale\(var\(--ls-press-scale\)\)/,
    'press scale',
  );
  assert.match(
    block(components, '.ls-input:focus-visible'),
    /outline-color:\s*var\(--ls-focus\)/,
    'focus eases in',
  );
  assert.match(
    block(components, '.ls-input'),
    /outline-color var\(--ls-dur-fast\) var\(--ls-ease-out\)/,
  );
  assert.match(
    block(shellCss, ".ls-auth-card input:not([type='radio']):not([type='checkbox']):focus-visible"),
    /outline-offset:\s*2px/,
  );
});

test('motion (D13): every shared component animates from the tokens; loops are limited to indicators', () => {
  const components = readFileSync(new URL('components.css', import.meta.url), 'utf8');
  const all = components + '\n' + shellCss;
  // Animations read the tokens too. Only the spinner and indeterminate progress (functional indicators) keep a literal.
  for (const match of all.matchAll(/animation:([^;]*);/g)) {
    if (/ls-spin|ls-slide/.test(match[1]!)) continue;
    assert.doesNotMatch(match[1]!, /\d+m?s\b/, `animation uses tokens: ${match[1]}`);
    assert.match(match[1]!, /var\(--ls-dur-(?:fast|base|slow|loop|slide)\)/, match[1]);
  }
  // Repeating animation is the skeleton pulse (and the two indicators) only.
  const infinite = [...all.matchAll(/animation:([^;]*infinite[^;]*);/g)].map((m) => m[1]!.trim());
  assert.equal(infinite.length, 3, infinite.join(' | '));
  assert.match(block(components, '.ls-skeleton'), /ls-pulse var\(--ls-dur-loop\)/);
  // Each listed component carries a micro-interaction.
  const wants: [string, RegExp][] = [
    [components + shellCss, /\.ls-page-btn\s*\{[^}]*transition:/],
    [components, /\.ls-table td\s*\{[^}]*transition: background-color var\(--ls-dur-fast\)/],
    [components, /\.ls-table tbody tr\s*\{[^}]*transition:/],
    [components, /\.ls-menu-item\s*\{[^}]*transition:/],
    [components, /\.ls-popover\s*\{[^}]*animation: ls-pop-in/],
    [components, /\.ls-dialog\s*\{[^}]*animation: ls-pop-in var\(--ls-dur-base\)/],
    [components, /\.ls-backdrop\s*\{[^}]*animation: ls-fade-in/],
    [components, /\.ls-drawer\s*\{[^}]*animation: ls-drawer-in var\(--ls-dur-slow\)/],
    [components, /\.ls-toast\s*\{[^}]*animation: ls-toast-in/],
    [
      shellCss,
      /\.ls-sidebar-slot\s*\{[^}]*transition: width var\(--ls-dur-base\) var\(--ls-ease-out\)/,
    ],
    [shellCss, /\.ls-route-fade\s*\{[^}]*animation: ls-fade-in var\(--ls-dur-base\)/],
  ];
  for (const [text, pattern] of wants) assert.match(text, pattern, String(pattern));
  // The route fade is opacity only: no keyframe that moves content is used by it.
  assert.match(components, /@keyframes ls-fade-in \{\s*from \{\s*opacity: 0;\s*\}\s*\}/);
  const tokens = readFileSync(new URL('tokens.css', import.meta.url), 'utf8');
  assert.match(tokens, /--ls-dur-loop:\s*0ms/, 'the loop token is off for reduced motion');
});

test('RouteFade wraps the page in the fade class (used by template.tsx)', () => {
  assert.match(
    renderToStaticMarkup(
      <ui.RouteFade>
        <p>x</p>
      </ui.RouteFade>,
    ),
    /^<div class="ls-route-fade"><p>x<\/p><\/div>$/,
  );
});

test('Step 5b UX gate fixes (F1-F12, F14): topbar order, control sizes, brand edge, overlay layer, phone rows', () => {
  const markup = renderToStaticMarkup(
    <ui.AppShell
      brand={<span>Lucy Spa</span>}
      nav={nav}
      labels={labels}
      topbar={<i id="bell" />}
      topbarExtras={<i id="theme" />}
      topbarEnd={<i id="user" />}
    >
      <p>x</p>
    </ui.AppShell>,
  );
  const order = ['id="bell"', 'id="theme"', 'id="user"'].map((needle) => markup.indexOf(needle));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    'notifications, theme, user (F7)',
  );
  assert.ok(order.every((index) => index > 0));
  const components = readFileSync(new URL('components.css', import.meta.url), 'utf8');
  // F1/F2 (legacy plain-control rules with zero specificity) went away with the last legacy stylesheet in Part 2 P2-8.
  // F3: a badge keeps one line when it can; F12: sort buttons keep a touch-sized width.
  assert.match(block(components, '.ls-badge'), /width:\s*max-content/);
  assert.match(block(components, '.ls-th-sort'), /min-width:\s*var\(--ls-control-h\)/);
  // F4/F5: phone card rows are two columns; titles and actions are full-size targets.
  assert.match(components, /\.ls-table tbody tr td\[data-label\] \{[^}]*grid-template-columns/);
  assert.match(
    components,
    /\.ls-table \.ls-cell-title a,[^{]*\{[^}]*min-height:\s*var\(--ls-control-h\)/,
  );
  // F6: on a phone the search and the Filters button share a row.
  assert.match(components, /\.ls-toolbar-row \{[^}]*flex-wrap:\s*nowrap/);
  // F8/F14: theme options use the control height (40 desktop, 44 touch) in every place.
  assert.match(block(shellCss, '.ls-theme-option'), /min-height:\s*var\(--ls-control-h\)/);
  assert.match(block(shellCss, '.ls-theme-option'), /min-width:\s*var\(--ls-control-h\)/);
  assert.match(block(shellCss, '.ls-topbar'), /height:\s*var\(--ls-topbar-h\)/);
  // F9: the unread count is brand colored, not amber.
  assert.match(block(shellCss, '.ls-bell-count'), /background:\s*var\(--ls-brand-fill\)/);
  // F10: the brand link is a full-size target and starts on the sidebar's icon edge.
  assert.match(block(shellCss, '.ls-topbar-brand a'), /min-height:\s*var\(--ls-control-h\)/);
  assert.match(
    shellCss,
    /\.ls-topbar \{\s*padding-inline-start:\s*calc\(var\(--ls-space-3\) \* 2\)/,
  );
  assert.match(shellCss, /\.ls-topbar > \.ls-tooltip-wrap:has\(> \.ls-menu-button\)/);
  // F11: page titles come from the type scale and are not lighter than the section titles.
  assert.match(block(components, '.ls-page-title'), /font-size:\s*var\(--ls-text-xl\)/);
  assert.match(block(components, '.ls-page-title'), /font-weight:\s*600/);
  assert.doesNotMatch(block(components, '.ls-page-title'), /clamp\(/);
});

test('auth header: the wordmark leads (twice the topbar size, centered), then a smaller title and a muted subtitle', () => {
  const rem = (markup: string) => Number(/font-size:([\d.]+)rem/.exec(markup)?.[1]);
  const normal = renderToStaticMarkup(<ui.BrandWordmark />);
  const display = renderToStaticMarkup(<ui.BrandWordmark size="display" />);
  assert.equal(rem(display), rem(normal) * 2);
  assert.doesNotMatch(normal, /padding-inline-start/, 'the topbar wordmark is unchanged');
  assert.match(block(shellCss, '.ls-auth-card-brand'), /text-align:\s*center/);
  const title = block(shellCss, '.ls-auth-card h1');
  assert.match(title, /font-size:\s*var\(--ls-text-lg\)/, 'smaller than the wordmark');
  assert.match(title, /text-align:\s*center/);
  const subtitle = [...shellCss.matchAll(/\.ls-auth-card > h1 \+ p \{([^}]*)\}/g)]
    .map((match) => match[1])
    .join(' ');
  assert.match(subtitle, /color:\s*var\(--ls-text-muted\)/);
  assert.match(subtitle, /text-align:\s*center/);
});

test('open states: tablet overlay above sticky content, nav drawer leaves a strip, menu never clips sign out, filter sheet from the bottom', () => {
  const components = readFileSync(new URL('components.css', import.meta.url), 'utf8');
  assert.match(
    shellCss,
    /\.ls-sidebar-slot:has\(> \.ls-sidebar\[data-overlay\]\) \{\s*z-index:\s*var\(--ls-z-drawer\)/,
  );
  assert.match(block(shellCss, '.ls-drawer.ls-nav-drawer'), /width:\s*min\(20rem, calc\(100% - /);
  assert.match(block(shellCss, '.ls-usermenu-panel'), /max-height:\s*calc\(100svh/);
  assert.match(block(components, '.ls-drawer-bottom'), /max-height:\s*85vh/);
  assert.match(
    components,
    /\.ls-tooltip-wrap:has\(:focus-visible\)/,
    'no tooltip on programmatic focus',
  );
  const sheet = renderToStaticMarkup(
    <ui.Drawer open onClose={() => undefined} side="bottom" title="Bộ lọc" closeLabel="Đóng">
      x
    </ui.Drawer>,
  );
  assert.match(sheet, /ls-drawer ls-drawer-bottom/);
});

test('auth card UX: token rhythm, elevation token in every theme block, segmented and password styles', () => {
  const card = block(shellCss, '.ls-auth-card');
  assert.match(card, /box-shadow:\s*var\(--ls-auth-card-shadow\)/);
  const tokens = readFileSync(new URL('tokens.css', import.meta.url), 'utf8');
  assert.equal(
    tokens.match(/--ls-auth-card-shadow:/g)?.length,
    4,
    'defined for light, dark toggle, dark system preference and the forced-light preview scope',
  );
  // Spacing between blocks comes from spacing tokens only (no px/rem literals on margins or gaps).
  const rhythm = [...shellCss.matchAll(/\.ls-auth-card > [^{]*\{([^}]*)\}/g)].map((m) => m[1]!);
  assert.ok(rhythm.length >= 4, 'rhythm rules exist');
  for (const body of rhythm)
    assert.doesNotMatch(body, /margin[-a-z]*:\s*-?(?:0?\.\d|[1-9])/, 'no spacing literal');
  assert.match(
    block(shellCss, '.ls-auth-card > .ls-auth-card-brand + *'),
    /var\(--ls-space-6\)/,
    'wordmark-to-title gap',
  );
  assert.match(block(shellCss, '.ls-auth-card > * + *'), /var\(--ls-space-4\)/);
  const components = readFileSync(new URL('components.css', import.meta.url), 'utf8');
  assert.match(
    block(components, '.ls-label-row'),
    /justify-content:\s*space-between/,
    'link at the right end',
  );
  assert.match(block(components, '.ls-segment'), /flex:\s*1 1 0/, 'equal segments');
  assert.match(
    block(components, '.ls-segment'),
    /min-height:\s*var\(--ls-control-h\)/,
    '44 px target',
  );
  assert.match(
    block(components, '.ls-password-toggle'),
    /width:\s*var\(--ls-control-h\)/,
    '44 px target',
  );
});

test('auth styles: full-screen gradient from tokens, subtle art, card on surface tokens, readable controls', () => {
  assert.match(
    block(shellCss, '.ls-auth'),
    /min-height:\s*100svh[\s\S]*linear-gradient\([^)]*var\(--ls-auth-panel-from\)[^)]*var\(--ls-auth-panel-to\)\)/,
    'the whole screen is the brand gradient, from theme tokens (light and dark)',
  );
  const opacity = Number(/\.ls-auth-pattern \{[^}]*opacity:\s*([\d.]+)/.exec(shellCss)?.[1]);
  assert.ok(opacity > 0 && opacity <= 0.15, `line art is very subtle (opacity ${opacity})`);
  const card = block(shellCss, '.ls-auth-card');
  assert.match(
    card,
    /background:\s*var\(--ls-bg-surface\)/,
    'light card in light, dark card in dark',
  );
  assert.match(card, /color:\s*var\(--ls-text\)/);
  assert.match(card, /width:\s*min\(100%, 26rem\)/, 'the card width of before');
  assert.doesNotMatch(
    shellCss,
    /ls-auth-panel\s*\{|grid-template-columns:\s*minmax\(20rem/,
    'no split',
  );
  assert.match(
    block(shellCss, '.ls-auth-main'),
    /padding:\s*var\(--ls-space-4\)/,
    'side margins on phones',
  );
  // Top-right controls use the on-red tokens, including the focus ring.
  assert.match(block(shellCss, '.ls-auth-top a'), /color:\s*var\(--ls-auth-panel-text\)/);
  assert.match(
    block(shellCss, '.ls-auth-top :focus-visible'),
    /outline-color:\s*var\(--ls-auth-panel-text\)/,
  );
  assert.match(
    block(
      shellCss,
      '.ls-auth-top .ls-theme-option:hover,\n.ls-auth-top .ls-theme-option-active,\n.ls-auth-top .ls-theme-option-active:hover',
    ),
    /var\(--ls-auth-panel-from\)/,
  );
  assert.doesNotMatch(shellCss, /@keyframes/, 'shell keyframes live in components.css (shared)');
  assert.doesNotMatch(
    block(shellCss, '.ls-auth-card'),
    /animation\s*:/,
    'no decorative animation on the auth screen',
  );
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

test('sidebar styles: solid red hover and current page, accordion header, rail shows every item, ring outside', () => {
  const hover = block(shellCss, '.ls-nav-link:hover,\n.ls-sidebar-toggle:hover');
  assert.match(hover, /color:\s*var\(--ls-nav-hover-text\)/);
  assert.match(hover, /background:\s*var\(--ls-nav-hover-bg\)/);
  const active = block(shellCss, ".ls-nav-link[aria-current='page']");
  assert.match(active, /background:\s*var\(--ls-nav-active-bg\)/);
  assert.match(active, /font-weight:\s*600/);
  const heading = block(shellCss, '.ls-nav-heading');
  assert.match(heading, /color:\s*var\(--ls-brand\)/);
  assert.match(heading, /font-weight:\s*600/);
  assert.match(heading, /text-transform:\s*uppercase/);
  assert.match(block(shellCss, '.ls-nav-heading-button'), /min-height:\s*var\(--ls-control-h\)/);
  assert.match(
    block(shellCss, ".ls-nav-heading-button[aria-expanded='false'] .ls-nav-chevron"),
    /rotate\(-90deg\)/,
  );
  assert.match(block(shellCss, '.ls-nav-chevron'), /transition:[^;]*var\(--ls-dur-fast\)/);
  // A group eases open and closed (grid rows 0fr to 1fr) and turns invisible once closed, so it is not focusable.
  assert.match(block(shellCss, '.ls-nav-collapse'), /grid-template-rows:\s*1fr/);
  assert.match(
    block(shellCss, '.ls-nav-collapse'),
    /transition:[^;]*grid-template-rows var\(--ls-dur-base\)/,
  );
  const closed = block(shellCss, ".ls-nav-collapse[data-open='false']");
  assert.match(closed, /grid-template-rows:\s*0fr/);
  assert.match(closed, /visibility:\s*hidden/);
  assert.match(block(shellCss, '.ls-nav-list'), /overflow:\s*hidden/);
  assert.match(
    shellCss,
    /\.ls-sidebar\[data-rail='true'\] \.ls-nav-collapse\[data-open='false'\] \{\s*grid-template-rows:\s*1fr;\s*visibility:\s*visible/,
    'the rail shows every group',
  );
  assert.match(shellCss, /\.ls-nav-heading-button:focus-visible \{\s*outline-offset:\s*2px/);
});
