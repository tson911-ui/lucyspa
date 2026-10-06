import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDom } from './dom-harness';

// The floating contact button (Owner request 2026-10-06).
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ContactFab } = await import('./contact-fab');

const css = readFileSync(new URL('site.css', import.meta.url), 'utf8');
const items = [
  { key: 'zalo' as const, href: 'https://zalo.me/0934936101', label: 'Nhắn Zalo' },
  { key: 'messenger' as const, href: 'https://m.me/lucyspa', label: 'Nhắn Messenger' },
  { key: 'call' as const, href: 'tel:+84934936101', label: 'Gọi Lucy Spa' },
];
const labels = { openLabel: 'Liên hệ', closeLabel: 'Đóng', groupLabel: 'Liên hệ Lucy Spa' };

test('ContactFab: collapsed button named "Liên hệ", the three links in order, new tab except tel:', () => {
  const html = renderToStaticMarkup(<ContactFab items={items} {...labels} />);
  assert.match(
    html,
    /<button[^>]*class="ls-contact-toggle"[^>]*aria-expanded="false"[^>]*aria-label="Liên hệ"/,
  );
  assert.match(html, /role="group" aria-label="Liên hệ Lucy Spa"/);
  const links = [...html.matchAll(/<a [^>]*>/g)].map((match) => match[0]);
  assert.equal(links.length, 3);
  assert.match(
    links[0]!,
    /href="https:\/\/zalo\.me\/0934936101"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
  );
  assert.match(links[1]!, /href="https:\/\/m\.me\/lucyspa"[^>]*target="_blank"/);
  assert.match(links[2]!, /href="tel:\+84934936101"/);
  assert.doesNotMatch(links[2]!, /target=/);
  assert.match(html, /Nhắn Zalo<\/span>[\s\S]*Nhắn Messenger<\/span>[\s\S]*Gọi Lucy Spa<\/span>/);
});

test('ContactFab: nothing at all when no way to reach the spa is given', () => {
  assert.equal(renderToStaticMarkup(<ContactFab items={[]} {...labels} />), '');
});

test('ContactFab: a click opens it, Escape and a press outside close it, focus returns to the button', () => {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ContactFab items={items} {...labels} />));
  const wrap = () => container.querySelector('.ls-contact') as HTMLElement;
  const toggle = () => container.querySelector('.ls-contact-toggle') as HTMLButtonElement;
  assert.equal(wrap().dataset['open'], 'false');
  act(() => toggle().click());
  assert.equal(wrap().dataset['open'], 'true');
  assert.equal(toggle().getAttribute('aria-expanded'), 'true');
  assert.equal(toggle().getAttribute('aria-label'), 'Đóng');

  act(() => {
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  });
  assert.equal(wrap().dataset['open'], 'false');
  assert.equal(window.document.activeElement, toggle());

  act(() => toggle().click());
  act(() => {
    window.document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  });
  assert.equal(wrap().dataset['open'], 'false', 'a press outside closes it');

  act(() => toggle().click());
  act(() => {
    container
      .querySelector('.ls-contact-link')!
      .dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  });
  assert.equal(wrap().dataset['open'], 'true', 'a press inside does not');
  act(() => root.unmount());
});

test('ContactFab css: sticky row on the shared layer scale, lifted above the tab bar and the action bar, pulse once', () => {
  // Above the page content, below the header, menus, drawers and dialogs: the shared sticky layer.
  assert.match(
    css,
    /\.ls-contact \{[^}]*position: sticky;[^}]*z-index: var\(--ls-z-sticky\);[^}]*height: calc\(var\(--ls-fab-size\) \+ var\(--ls-space-4\) \* 2\);/,
  );
  assert.match(
    css,
    /\.ls-contact \{[^}]*bottom: calc\(var\(--ls-fab-base\) \+ var\(--ls-fab-lift\)\);/,
  );
  assert.match(
    css,
    /@media \(max-width: 1023px\) \{\s*\.ls-contact \{\s*--ls-fab-base: calc\(var\(--ls-tab-bar-h\) \+ var\(--ls-safe-bottom\)\);/,
  );
  assert.match(css, /\.ls-site:has\(\.ls-booking-bar\) \.ls-contact \{\s*--ls-fab-base: 0px;/);
  // One pulse (1 iteration), on the motion tokens; the ring only exists while the pulse plays.
  assert.match(
    css,
    /\.ls-contact-toggle\[data-pulse='true'\]::after \{[^}]*animation: ls-fab-pulse var\(--ls-dur-pulse\)[^}]* 1 both;/,
  );
  assert.doesNotMatch(css, /ls-fab-pulse[^;]*infinite/);
  // Expand and collapse: fade + slight scale from the toggle, hidden items leave the tab order.
  assert.match(
    css,
    /\.ls-contact-link \{[^}]*visibility: hidden;[^}]*scale: var\(--ls-pop-scale\);/,
  );
  assert.match(
    css,
    /\.ls-contact\[data-open='true'\] \.ls-contact-link \{[^}]*visibility: visible;[^}]*scale: 1;/,
  );
  // Colours: Zalo and Messenger in their brand colours, the call button in the site's brand fill, a brand-red toggle.
  assert.match(css, /data-kind='zalo'\] \.ls-contact-icon \{\s*background: var\(--ls-brand-zalo\)/);
  assert.match(css, /data-kind='messenger'\] \.ls-contact-icon \{\s*background: linear-gradient\(/);
  assert.match(
    css,
    /data-kind='call'\] \.ls-contact-icon \{[^}]*background: var\(--ls-brand-fill\)/,
  );
  assert.match(
    css,
    /\.ls-contact-toggle \{[^}]*color: var\(--ls-on-brand\);[^}]*background: var\(--ls-brand-fill\)/,
  );
  // Footer icons: footer-link grey, the official colour on hover.
  assert.match(css, /\.ls-footer-icon \{[^}]*color: var\(--ls-text-muted\)/);
  assert.match(
    css,
    /data-network='facebook'\] \{\s*--ls-footer-icon-hover: var\(--ls-brand-facebook\)/,
  );
  assert.match(css, /data-network='zalo'\] \{\s*--ls-footer-icon-hover: var\(--ls-brand-zalo\)/);
});
