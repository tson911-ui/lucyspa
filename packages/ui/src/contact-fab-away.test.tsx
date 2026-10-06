import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { installDom } from './dom-harness';

// Owner request 2026-10-06: the floating contact button never sits on top of what is being read.
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ContactFab } = await import('./contact-fab');

const css = readFileSync(new URL('site.css', import.meta.url), 'utf8');
const items = [{ key: 'call' as const, href: 'tel:+84934936101', label: 'Gọi Lucy Spa' }];
const labels = { openLabel: 'Liên hệ', closeLabel: 'Đóng', groupLabel: 'Liên hệ Lucy Spa' };

function mount(phone: boolean) {
  let scroll = 0;
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scroll });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: phone, addEventListener() {}, removeEventListener() {} }),
  });
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ContactFab items={items} {...labels} />));
  const wrap = () => container.querySelector('.ls-contact') as HTMLElement;
  const scrollTo = (y: number) =>
    act(() => {
      scroll = y;
      window.dispatchEvent(new window.Event('scroll'));
    });
  return { wrap, scrollTo, root };
}

test('ContactFab on a phone: steps aside while reading down, is there at the top, on scrolling up and on focus', () => {
  const { wrap, scrollTo, root } = mount(true);
  assert.equal(wrap().dataset['away'], undefined, 'at the top it is shown');
  scrollTo(400);
  assert.equal(wrap().dataset['away'], 'true', 'reading down: away');
  scrollTo(900);
  assert.equal(wrap().dataset['away'], 'true');
  scrollTo(700);
  assert.equal(wrap().dataset['away'], undefined, 'scrolling up: back');
  scrollTo(1200);
  assert.equal(wrap().dataset['away'], 'true');
  act(() => {
    (wrap().querySelector('a') as HTMLElement).dispatchEvent(
      new window.FocusEvent('focusin', { bubbles: true }),
    );
  });
  assert.equal(wrap().dataset['away'], undefined, 'keyboard focus brings it back');
  scrollTo(0);
  assert.equal(wrap().dataset['away'], undefined, 'top of the page');
  act(() => root.unmount());
});

test('ContactFab on a wide screen never steps aside', () => {
  const { wrap, scrollTo, root } = mount(false);
  scrollTo(900);
  assert.equal(wrap().dataset['away'], undefined);
  act(() => root.unmount());
});

test('css: away hides it from sight, pointer and keyboard on phones only, with the shared motion tokens', () => {
  assert.match(
    css,
    /@media \(max-width: 1023\.98px\) \{\s*\.ls-contact-stack \{[^}]*\}\s*\.ls-contact\[data-away='true'\] \.ls-contact-stack \{\s*visibility: hidden;\s*opacity: 0;/,
  );
});
