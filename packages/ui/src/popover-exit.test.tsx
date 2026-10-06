import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { installDom } from './dom-harness';

// The pop panel's exit (public header: person menu and bell panel): it stays in the page while the closing animation
// runs and is removed at once where there is none (staff area, reduced motion, tests).
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act, createRef } = await import('react');
const { createRoot } = await import('react-dom/client');
const { Popover, exitDuration } = await import('./popover');

test('exitDuration reads the longest computed animation duration in milliseconds', () => {
  assert.equal(exitDuration('0.18s'), 180);
  assert.equal(exitDuration('180ms'), 180);
  assert.equal(exitDuration('0s, 0.3s'), 300);
  assert.equal(exitDuration('0s'), 0);
  assert.equal(exitDuration(''), 0);
});

test('Popover: removed at once without an exit animation; kept (inert, data-state closed) until it ends with one', () => {
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  const anchor = createRef<HTMLElement>();
  const draw = (open: boolean) =>
    act(() =>
      root.render(
        <>
          <button ref={anchor as React.RefObject<HTMLButtonElement>}>t</button>
          <Popover open={open} onClose={() => undefined} anchorRef={anchor} className="x">
            <p>panel</p>
          </Popover>
        </>,
      ),
    );

  draw(true);
  assert.equal(container.querySelector('.ls-popover')?.getAttribute('data-state'), 'open');
  draw(false);
  assert.equal(container.querySelector('.ls-popover'), null, 'no animation: gone at once');

  const real = window.getComputedStyle.bind(window);
  (window as unknown as { getComputedStyle: unknown }).getComputedStyle = (element: Element) => {
    const style = real(element);
    return new Proxy(style, {
      get(target, key) {
        if (key === 'animationName') return 'ls-site-pop-out';
        if (key === 'animationDuration') return '0.18s';
        return Reflect.get(target, key) as unknown;
      },
    });
  };
  (globalThis as Record<string, unknown>).getComputedStyle = window.getComputedStyle;
  try {
    draw(true);
    draw(false);
    const panel = container.querySelector('.ls-popover');
    assert.ok(panel, 'with an exit animation it stays while it plays');
    assert.equal(panel.getAttribute('data-state'), 'closed');
    assert.equal(panel.hasAttribute('inert'), true, 'and nothing in it can be reached');
    act(() => {
      panel.dispatchEvent(new window.Event('animationend'));
    });
    assert.equal(container.querySelector('.ls-popover'), null, 'removed when the animation ends');
  } finally {
    (window as unknown as { getComputedStyle: unknown }).getComputedStyle = real;
    (globalThis as Record<string, unknown>).getComputedStyle = real;
    act(() => root.unmount());
  }
});
