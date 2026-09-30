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

test('auth card UX: token rhythm, elevation token in every theme block, segmented and password styles', () => {
  const card = block(shellCss, '.ls-auth-card');
  assert.match(card, /box-shadow:\s*var\(--ls-auth-card-shadow\)/);
  const tokens = readFileSync(new URL('tokens.css', import.meta.url), 'utf8');
  assert.equal(
    tokens.match(/--ls-auth-card-shadow:/g)?.length,
    3,
    'defined for light, dark toggle and dark system preference',
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
    block(shellCss, '.ls-auth-top .ls-theme-option-active'),
    /var\(--ls-auth-panel-from\)/,
  );
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
