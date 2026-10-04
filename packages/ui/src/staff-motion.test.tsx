import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDom } from './dom-harness';
import { prefetchAllowed, type MotionEnvironment } from './reveal-core';

// Staff area motion (the public site's motion system on the admin): prefetch policy, the sidebar's sliding highlight and
// animated groups, the loading placeholder, the route wrapper and the stylesheet pins (hover colors stay locked).
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await import('./index');

const shellCss = readFileSync(new URL('shell.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('tokens.css', import.meta.url), 'utf8');

const environment = (patch: Partial<MotionEnvironment>): MotionEnvironment => ({
  reducedMotion: false,
  saveData: false,
  deviceMemory: undefined,
  hasObserver: true,
  ...patch,
});

test('links are fetched ahead except in data saver mode or on a low memory device; reduced motion does not matter', () => {
  assert.equal(prefetchAllowed(environment({})), true);
  assert.equal(prefetchAllowed(environment({ deviceMemory: 8 })), true);
  assert.equal(prefetchAllowed(environment({ reducedMotion: true })), true);
  assert.equal(prefetchAllowed(environment({ hasObserver: false })), true);
  assert.equal(prefetchAllowed(environment({ saveData: true })), false);
  assert.equal(prefetchAllowed(environment({ deviceMemory: 2 })), false);
  assert.equal(prefetchAllowed(environment({ deviceMemory: 0.5 })), false);
});

test('LoadingState announces its label and draws decorative rows; the page variant adds a title and one card', () => {
  const block = renderToStaticMarkup(<ui.LoadingState label="Đang tải…" />);
  assert.match(block, /role="status"/);
  assert.match(block, /aria-busy="true"/);
  assert.match(block, /<span class="ls-visually-hidden">Đang tải…<\/span>/);
  assert.equal(block.match(/class="ls-skeleton"/g)?.length, 4, 'four rows by default');
  assert.doesNotMatch(block, /ls-card/, 'a block is the body of a card, never a card itself');

  const page = renderToStaticMarkup(<ui.LoadingState label="Đang tải…" variant="page" rows={3} />);
  assert.match(page, /ls-loading ls-loading-page/);
  assert.match(page, /ls-skeleton ls-loading-title/);
  assert.equal(page.match(/class="ls-card"/g)?.length, 1, 'one card surface');
  assert.equal(page.match(/<span class="ls-skeleton" /g)?.length, 3);
  assert.match(page, /aria-hidden="true"/);
});

test('RouteEnter is the page wrapper of the staff area: stack makes it the block container, the first render never animates', () => {
  const html = renderToStaticMarkup(
    <ui.RouteEnter stack>
      <p>x</p>
    </ui.RouteEnter>,
  );
  assert.equal(
    html,
    '<div class="ls-route-fade ls-route-enter ls-stack ls-gap-page"><p>x</p></div>',
  );
});

const nav = [
  {
    id: 'operations',
    label: 'Vận hành',
    items: [
      { id: 'pos', label: 'POS', href: '/pos', icon: 'receipt' as const, current: true },
      { id: 'board', label: 'Bảng', href: '/board', icon: 'calendar' as const },
    ],
  },
  {
    id: 'people',
    label: 'Nhân sự',
    items: [
      { id: 'staff', label: 'Nhân viên', href: '/staff', icon: 'users' as const },
      { id: 'roles', label: 'Vai trò', href: '/roles', icon: 'shield' as const },
    ],
  },
];

test('the sidebar draws one highlight that slides to the new current page, jumps on a resize, and hides with its group', () => {
  window.localStorage.clear();
  const server = renderToStaticMarkup(
    <ui.SidebarNav groups={ui.arrangeNav(nav)} label="Điều hướng" />,
  );
  assert.match(server, /<span class="ls-sidebar-pill" aria-hidden="true"><\/span>/);
  assert.doesNotMatch(server, /data-pill/, 'nothing is placed on the server');
  assert.equal(server.match(/class="ls-nav-collapse"/g)?.length, 2, 'every group can collapse');

  const rows = new Map<string, number>([
    ['/pos', 8],
    ['/board', 56],
    ['/staff', 150],
    ['/roles', 198],
  ]);
  const proto = window.HTMLElement.prototype;
  const define = (name: string, read: (element: HTMLElement) => number) =>
    Object.defineProperty(proto, name, {
      configurable: true,
      get(this: HTMLElement) {
        return read(this);
      },
    });
  define('offsetTop', (element) => rows.get(element.getAttribute('href') ?? '') ?? 0);
  define('offsetLeft', () => 12);
  define('offsetWidth', (element) => (element.getAttribute('href') ? 200 : 0));
  define('offsetHeight', () => 44);
  // jsdom has no ResizeObserver: keep the callback so the test can say "a size changed".
  const observers: Array<() => void> = [];
  const globals = globalThis as Record<string, unknown>;
  globals['ResizeObserver'] = class {
    constructor(callback: () => void) {
      observers.push(callback);
    }
    observe() {}
    disconnect() {}
  };
  (window as unknown as Record<string, unknown>)['ResizeObserver'] = globals['ResizeObserver'];

  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  const render = (current: string) =>
    act(() =>
      root.render(
        <ui.SidebarNav
          groups={ui.arrangeNav(
            nav.map((group) => ({
              ...group,
              items: group.items.map((item) => ({ ...item, current: item.id === current })),
            })),
          )}
          label="Điều hướng"
        />,
      ),
    );
  const menu = () => container.querySelector('nav') as HTMLElement;

  render('pos');
  assert.equal(menu().dataset['pill'], 'still', 'first placement never slides');
  assert.equal(menu().style.getPropertyValue('--ls-pill-y'), '8px');
  assert.equal(menu().style.getPropertyValue('--ls-pill-h'), '44px');

  render('board');
  assert.equal(menu().dataset['pill'], 'slide', 'a route change slides');
  assert.equal(menu().style.getPropertyValue('--ls-pill-y'), '56px');

  // The current page lives in another group, which opens itself: the highlight slides there.
  render('staff');
  assert.equal(menu().dataset['pill'], 'slide');
  assert.equal(menu().style.getPropertyValue('--ls-pill-y'), '150px');

  // A size change (a group moving the current link) re-places the highlight without sliding.
  rows.set('/staff', 190);
  act(() => observers.forEach((callback) => callback())); // the observers' first report is skipped
  act(() => observers.forEach((callback) => callback()));
  assert.equal(menu().dataset['pill'], 'still', 'a layout change jumps');
  assert.equal(menu().style.getPropertyValue('--ls-pill-y'), '190px');

  // Closing the group that holds the current page clips the link: the highlight hides with it.
  const heading = [...container.querySelectorAll('button.ls-nav-heading')].find(
    (button) => button.textContent === 'Nhân sự',
  ) as HTMLElement;
  act(() => heading.click());
  assert.equal(heading.nextElementSibling?.getAttribute('data-open'), 'false');
  act(() => observers.forEach((callback) => callback()));
  assert.equal(menu().dataset['pill'], 'none', 'the highlight leaves with its group');
  act(() => heading.click());
  act(() => observers.forEach((callback) => callback()));
  assert.equal(menu().dataset['pill'], 'still', 'and comes back in place when the group opens');

  act(() => root.unmount());
  for (const name of ['offsetLeft', 'offsetWidth', 'offsetTop', 'offsetHeight']) {
    Reflect.deleteProperty(proto, name);
  }
  Reflect.deleteProperty(globals, 'ResizeObserver');
  Reflect.deleteProperty(window, 'ResizeObserver');
});

const block = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.[\]()*+?]/g, '\\$&');
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
};

test('dialogs, sheets and drawers: header and footer stay, only the body scrolls, at any screen height', () => {
  const components = readFileSync(new URL('components.css', import.meta.url), 'utf8');
  // The row is exactly the screen: a tall panel can no longer stretch it past the viewport and hide its footer.
  assert.match(block(components, '.ls-backdrop'), /grid-template-rows:\s*minmax\(0,\s*1fr\)/);
  // The panel clips; it does not scroll as a whole.
  const dialog = block(components, '.ls-dialog');
  assert.match(dialog, /overflow:\s*hidden/);
  assert.doesNotMatch(dialog, /overflow-y:\s*auto/);
  assert.match(
    dialog,
    /max-height:\s*calc\(100dvh - 2 \* var\(--ls-space-4\)\)/,
    'dynamic viewport on phones',
  );
  assert.match(dialog, /max-height:\s*calc\(100vh - 2 \* var\(--ls-space-4\)\)/, 'fallback');
  // The body between header and footer scrolls.
  const body = block(components, '.ls-dialog-body');
  assert.match(body, /overflow-y:\s*auto/);
  assert.match(body, /min-height:\s*0/);
  assert.match(body, /flex:\s*1 1 auto/);
  const fixed = block(components, '.ls-dialog-header,\n.ls-dialog-description,\n.ls-dialog-footer');
  assert.match(fixed, /flex:\s*none/);
  // Drawer: the panel is at most the screen high, the body scrolls, header and footer do not shrink.
  assert.match(block(components, '.ls-drawer'), /max-height:\s*100%/);
  assert.match(block(components, '.ls-drawer-body'), /overflow-y:\s*auto/);
  assert.match(
    block(components, '.ls-drawer .ls-dialog-header,\n.ls-drawer .ls-dialog-footer'),
    /flex:\s*none/,
  );
  assert.match(block(components, '.ls-drawer-bottom'), /max-height:\s*85dvh/);
  assert.match(components, /\.ls-dialog-sm,\s*\.ls-dialog-md \{[^}]*max-height:\s*90dvh/);
  assert.match(block(components, '.ls-promo-dialog'), /max-height:\s*calc\(100dvh/);
});

test('the Back button sits above the title, pulls the block gap in to 16 px and is a ghost button', () => {
  const row = block(shellCss, '.ls-back-row');
  assert.match(row, /margin-block-end:\s*calc\(var\(--ls-space-2\) \* -1\)/);
  assert.match(
    block(shellCss, '.ls-back-row .ls-back'),
    /margin-inline-start:\s*calc\(var\(--ls-space-3\) \* -1\)/,
  );
});

test('staff motion styles: the highlight is the locked solid fill, controls ease, data saver drops the movement', () => {
  const pill = block(shellCss, '.ls-sidebar-pill');
  assert.match(pill, /background:\s*var\(--ls-nav-active-bg\)/, 'same fill as the current page');
  assert.match(
    shellCss,
    /\.ls-nav\[data-pill='slide'\] > \.ls-sidebar-pill \{\s*transition:\s*translate var\(--ls-dur-slide\) var\(--ls-ease-premium\)/,
  );
  // Links paint above the highlight.
  assert.match(block(shellCss, '.ls-nav-link,\n.ls-sidebar-toggle'), /position:\s*relative/);

  // The hover colours are untouched by the motion rules: no hover rule of this section sets a colour.
  const section = shellCss.slice(
    shellCss.indexOf('Controls, cards and rows'),
    shellCss.indexOf('Loading placeholder'),
  );
  for (const rule of section.matchAll(/:hover\s*\{([^}]*)\}/g)) {
    assert.doesNotMatch(
      rule[1]!,
      /(?:^|[\s;])(?:background|color)\s*:/,
      'the motion rules never recolour a hover',
    );
  }
  assert.match(
    block(section, '.ls-btn'),
    /transform var\(--ls-dur-base\) var\(--ls-ease-premium\)/,
  );
  assert.match(
    section,
    /translateY\(calc\(var\(--ls-ctl-lift\) \/ -2\)\)/,
    'a button lifts half the public distance',
  );
  assert.match(section, /@media \(hover: hover\)/, 'lift is for fine pointers only');
  assert.match(block(section, '.ls-media-tile:active'), /scale\(var\(--ls-press-scale\)\)/);

  // Data saver / low memory: slide, rise, lifts and the loop are tokens set to zero inside the shell.
  const saver = block(shellCss, "html[data-ls-motion='reduced'] .ls-shell");
  for (const name of [
    '--ls-dur-slide',
    '--ls-dur-loop',
    '--ls-reveal-shift',
    '--ls-ctl-lift',
    '--ls-card-lift',
  ]) {
    assert.match(saver, new RegExp(`${name}:\\s*0`), name);
  }
  // Reduced motion zeroes the same tokens in tokens.css.
  const reduced =
    /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/.exec(tokens)?.[1] ?? '';
  for (const name of ['--ls-dur-slide', '--ls-reveal-shift', '--ls-ctl-lift', '--ls-card-lift']) {
    assert.match(reduced, new RegExp(`${name}:\\s*0`), name);
  }
});
