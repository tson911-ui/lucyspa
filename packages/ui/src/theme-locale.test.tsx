import assert from 'node:assert/strict';
import { after, mock, test } from 'node:test';
import { installDom } from './dom-harness';

// Locale switch: the root layout is keyed by the locale, so a switch remounts <html>. React then clears the
// attributes the pre-paint script set (data-theme) and the script is not created again after hydration.
// The theme must still match the chosen mode afterwards (this reproduced in a real browser as: Light button
// selected, page dark, because the OS prefers dark and no data-theme was left).
const dom = installDom('http://localhost/vi/workforce');
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await import('./index');
const { ThemeInitScript, ThemeToggle } = ui;

const labels = { group: 'Giao diện', light: 'Sáng', dark: 'Tối', auto: 'Tự động theo giờ' };
const at = (hour: number) => new Date(2026, 9, 2, hour, 0, 0, 0).getTime();
const root = window.document.documentElement;
const theme = () => root.getAttribute('data-theme');
const pressed = () =>
  [...window.document.querySelectorAll('.ls-theme-option-active')].map(
    (node) => node.getAttribute('aria-label') ?? node.textContent,
  );

function Layout({ locale }: { locale: 'vi' | 'en' }) {
  return (
    <html lang={locale}>
      {/* eslint-disable-next-line @next/next/no-head-element -- a test document, not a Next page */}
      <head>
        <ThemeInitScript />
      </head>
      <body>
        <ThemeToggle labels={labels} />
      </body>
    </html>
  );
}

const setCookie = (preference: 'light' | 'dark' | 'auto') => {
  window.document.cookie = ui.serializeThemeCookie(preference);
};

for (const mode of [
  { name: 'light', cookie: 'light', hour: 9, expected: 'light' },
  { name: 'dark', cookie: 'dark', hour: 9, expected: 'dark' },
  { name: 'auto at 09:00', cookie: 'auto', hour: 9, expected: 'light' },
  { name: 'auto at 20:00', cookie: 'auto', hour: 20, expected: 'dark' },
] as const) {
  test(`locale switch keeps the theme: ${mode.name}, vi to en and en to vi`, () => {
    mock.timers.enable({ apis: ['Date', 'setTimeout'], now: at(mode.hour) });
    try {
      setCookie(mode.cookie);
      root.removeAttribute('data-theme');
      const container = createRoot(window.document);
      act(() => container.render(<Layout key="vi" locale="vi" />));
      assert.equal(theme(), mode.expected, 'first render');
      for (const locale of ['en', 'vi'] as const) {
        // The key changes with the locale, as Next's segment key does on a client navigation.
        act(() => container.render(<Layout key={locale} locale={locale} />));
        assert.equal(window.document.documentElement.lang, locale);
        assert.equal(theme(), mode.expected, `after switching to ${locale}`);
        assert.equal(pressed().length, 1, 'one toggle button is selected');
      }
      act(() => container.unmount());
    } finally {
      mock.timers.reset();
    }
  });
}

test('auto follows the clock across the 18:00 boundary and survives a locale switch', () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: at(17) });
  try {
    setCookie('auto');
    const container = createRoot(window.document);
    act(() => container.render(<Layout key="vi" locale="vi" />));
    assert.equal(theme(), 'light');
    act(() => mock.timers.tick(2 * 60 * 60 * 1000));
    assert.equal(theme(), 'dark', 'after 18:00');
    act(() => container.render(<Layout key="en" locale="en" />));
    assert.equal(theme(), 'dark', 'still dark after the switch');
    act(() => container.unmount());
  } finally {
    mock.timers.reset();
  }
});

test('the theme cookie is global: Path=/, not scoped to a locale', () => {
  assert.match(ui.serializeThemeCookie('light'), /Path=\/(;|$)/);
  assert.doesNotMatch(ui.serializeThemeCookie('dark'), /Path=\/(vi|en)/);
});
