import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { installDom } from './dom-harness';

// Session 9: the contact button follows a sticky action bar (the service page's phone bar) to where the bar really is, so near the end of the
// page, when the bar leaves the bottom edge with its container, the button stays above it and never covers its call to action.
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { ContactFab } = await import('./contact-fab');

const labels = { openLabel: 'Liên hệ', closeLabel: 'Đóng', groupLabel: 'Liên hệ Lucy Spa' };
const items = [{ key: 'call' as const, href: 'tel:+84934936101', label: 'Gọi Lucy Spa' }];

function rect(top: number, height: number) {
  return () =>
    ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 360,
      width: 360,
      x: 0,
      y: top,
    }) as DOMRect;
}

test('the lift is the bar height while the bar is stuck, and grows to keep the button above a bar that has left the edge', async () => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  });
  const site = window.document.createElement('div');
  site.className = 'ls-site';
  const tab = window.document.createElement('nav');
  tab.className = 'ls-tab-bar';
  const bar = window.document.createElement('div');
  bar.className = 'ls-action-bar';
  site.append(bar, tab);
  window.document.body.appendChild(site);
  tab.getBoundingClientRect = rect(728, 72);
  bar.getBoundingClientRect = rect(659, 69); // stuck: its bottom meets the top of the tab bar
  const holder = window.document.createElement('div');
  site.appendChild(holder);
  const root = createRoot(holder);
  act(() => root.render(<ContactFab items={items} {...labels} />));
  const fab = () => site.querySelector('.ls-contact') as HTMLElement;
  const settle = () => act(() => new Promise<void>((done) => window.setTimeout(done, 60)));
  await settle();
  assert.equal(fab().style.getPropertyValue('--ls-fab-lift'), '69px', 'stuck: the bar height');

  bar.getBoundingClientRect = rect(590, 69); // near the end of the page: the bar has scrolled up with its container
  act(() => {
    window.dispatchEvent(new window.Event('resize'));
  });
  await settle();
  assert.equal(
    fab().style.getPropertyValue('--ls-fab-lift'),
    '138px',
    'unstuck: 800 - 590 - 72 = 138, so the button stays above the bar',
  );

  bar.style.display = 'none';
  act(() => {
    window.dispatchEvent(new window.Event('resize'));
  });
  await settle();
  assert.equal(fab().style.getPropertyValue('--ls-fab-lift'), '0px', 'no bar: no lift');
  act(() => root.unmount());
});
