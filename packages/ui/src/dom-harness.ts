import { JSDOM } from 'jsdom';

// Test-only: a jsdom window installed as the globals React DOM expects. Install it BEFORE importing
// `react-dom/client` (it reads `window` when it loads), so tests import React DOM dynamically.

export interface TestDom {
  window: JSDOM['window'];
  /** Makes `matchMedia(query).matches` return `value` for queries containing `max-width: 639px`. */
  setPhone(value: boolean): void;
}

export function installDom(url = 'http://localhost/employees'): TestDom {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  let phone = false;
  const listeners = new Set<() => void>();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return phone && query.includes('max-width: 639px');
      },
      media: query,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }),
  });
  const globals = globalThis as Record<string, unknown>;
  for (const name of [
    'window',
    'document',
    'HTMLElement',
    'HTMLButtonElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'Element',
    'Node',
    'Event',
    'KeyboardEvent',
    'MouseEvent',
    'MutationObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]) {
    Object.defineProperty(globals, name, {
      configurable: true,
      writable: true,
      value: name === 'window' ? window : (window as unknown as Record<string, unknown>)[name],
    });
  }
  Object.defineProperty(globals, 'navigator', { configurable: true, value: window.navigator });
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    window,
    setPhone(value) {
      phone = value;
      for (const listener of listeners) listener();
    },
  };
}
