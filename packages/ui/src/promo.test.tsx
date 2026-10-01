import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import type { ReactNode } from 'react';
import { installDom } from './dom-harness';
import type { PromoContent, PromoLink } from './index';

// The promotional popup in a real DOM (jsdom): an accessible modal with a full-size close control, the same
// card as a static preview, tokens-only styles.
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await import('./index');

const content: PromoContent = {
  title: 'Khuyến mãi Tết',
  body: 'Giảm 20%\ncho mọi dịch vụ',
  image: {
    src: '/api/v1/public/media/1/md',
    srcSet: '/api/v1/public/media/1/md 960w, /api/v1/public/media/1/lg 1920w',
    sizes: '(max-width: 640px) 90vw, 560px',
    alt: 'Ảnh khuyến mãi',
    width: 1920,
    height: 800,
  },
  cta: { label: 'Đặt lịch', href: '/vi/account/book' },
};

function mount(node: ReactNode) {
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

test('PromoDialog: a named modal with the title, body, image and link; the close button and Escape close it', () => {
  const closed: string[] = [];
  const { container, unmount } = mount(
    <ui.PromoDialog
      content={content}
      label="Khuyến mãi"
      closeLabel="Đóng"
      onClose={() => closed.push('closed')}
    />,
  );
  const dialog = container.querySelector('[role="dialog"]');
  assert.equal(dialog?.getAttribute('aria-modal'), 'true');
  const titleId = dialog?.getAttribute('aria-labelledby');
  assert.ok(titleId);
  const heading = container.querySelector('h2');
  assert.equal(heading?.id, titleId);
  assert.equal(heading?.textContent, 'Khuyến mãi Tết');
  assert.equal(dialog?.getAttribute('aria-label'), null, 'the title names the dialog');
  assert.equal(container.querySelector('.ls-promo-text')?.textContent, 'Giảm 20%\ncho mọi dịch vụ');
  const image = container.querySelector('img');
  assert.equal(image?.getAttribute('alt'), 'Ảnh khuyến mãi');
  assert.equal(image?.getAttribute('width'), '1920', 'the file size reserves the space');
  assert.equal(image?.getAttribute('height'), '800');
  assert.match(image?.getAttribute('srcset') ?? '', /960w, .*1920w/);
  const link = container.querySelector<HTMLAnchorElement>('a.ls-btn-primary');
  assert.equal(link?.getAttribute('href'), '/vi/account/book');
  assert.equal(link?.textContent, 'Đặt lịch');
  // The close button is the first control (the first stop of the focus trap) and has a text name.
  const first = container.querySelector('button, a');
  assert.equal(first?.getAttribute('aria-label'), 'Đóng');
  // jsdom has no layout, so the trap finds no visible control and focuses the panel itself.
  assert.ok(dialog?.contains(window.document.activeElement), 'focus moves into the dialog');
  act(() => {
    first?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  assert.deepEqual(closed, ['closed']);
  act(() => {
    dialog?.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  assert.equal(closed.length, 2, 'Escape closes');
  act(() => {
    container
      .querySelector('.ls-backdrop')
      ?.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  });
  assert.equal(closed.length, 3, 'a press on the backdrop closes');
  act(() => {
    link?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  assert.equal(closed.length, 4, 'following the link closes the popup behind the navigation');
  unmount();
  assert.equal(window.document.body.style.overflow, '', 'the page scrolls again');
});

test('PromoDialog: an image-only popup is named by the given label; a text-only one has no image', () => {
  const imageOnly = mount(
    <ui.PromoDialog
      content={{ ...content, title: null, body: null, cta: null }}
      label="Khuyến mãi"
      closeLabel="Đóng"
      onClose={() => undefined}
    />,
  );
  const dialog = imageOnly.container.querySelector('[role="dialog"]');
  assert.equal(dialog?.getAttribute('aria-label'), 'Khuyến mãi');
  assert.equal(dialog?.getAttribute('aria-labelledby'), null);
  assert.equal(imageOnly.container.querySelector('h2'), null);
  assert.equal(imageOnly.container.querySelector('a'), null);
  imageOnly.unmount();

  const textOnly = mount(
    <ui.PromoDialog
      content={{ ...content, image: null, cta: null }}
      label="Khuyến mãi"
      closeLabel="Đóng"
      onClose={() => undefined}
    />,
  );
  assert.equal(textOnly.container.querySelector('img'), null);
  assert.equal(textOnly.container.querySelector('h2')?.textContent, 'Khuyến mãi Tết');
  textOnly.unmount();
});

test('PromoDialog: a router link component is used for the link', () => {
  const followed: string[] = [];
  const Link: PromoLink = ({ href, className, onClick, children }) => (
    <a
      href={href}
      className={className}
      data-router="yes"
      onClick={(event) => {
        event.preventDefault();
        followed.push(href);
        onClick?.();
      }}
    >
      {children}
    </a>
  );
  const { container, unmount } = mount(
    <ui.PromoDialog
      content={content}
      label="Khuyến mãi"
      closeLabel="Đóng"
      onClose={() => undefined}
      LinkComponent={Link}
    />,
  );
  const link = container.querySelector<HTMLAnchorElement>('a[data-router]');
  act(() => {
    link?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  assert.deepEqual(followed, ['/vi/account/book']);
  unmount();
});

test('PromoPreview: the same card twice (desktop and phone) as pictures: no focusable control, no link', () => {
  const { container, unmount } = mount(
    <ui.PromoPreview content={content} desktopLabel="Máy tính" phoneLabel="Điện thoại" />,
  );
  const frames = [...container.querySelectorAll('figure.ls-promo-frame')];
  assert.equal(frames.length, 2);
  assert.deepEqual(
    frames.map((frame) => frame.querySelector('figcaption')?.textContent),
    ['Máy tính', 'Điện thoại'],
  );
  assert.equal(container.querySelectorAll('.ls-promo').length, 2);
  assert.equal(
    container.querySelectorAll('button, a, [tabindex]').length,
    0,
    'a picture, not controls',
  );
  assert.equal(container.querySelectorAll('.ls-promo-title').length, 2);
  assert.equal(container.querySelectorAll('[role="dialog"]').length, 0, 'never a modal');
  unmount();
});

test('promo styles: tokens only, one bordered surface, a contained image, a full-size close target', () => {
  const css = readFileSync(new URL('components.css', import.meta.url), 'utf8');
  const block = (selector: string) => {
    const match = new RegExp(`(?:^|\\n)${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`).exec(
      css,
    );
    assert.ok(match, selector);
    return match[1] ?? '';
  };
  assert.match(block('.ls-promo'), /border:\s*1px solid var\(--ls-border\)/);
  assert.match(block('.ls-promo-media img'), /object-fit:\s*contain/);
  assert.match(block('.ls-promo-media img'), /height:\s*auto/);
  assert.match(block('.ls-promo-body'), /padding:\s*var\(--ls-space-6\)/);
  assert.match(block('.ls-promo-dialog'), /width:\s*min\(100%, var\(--ls-dialog-sm\)\)/);
  assert.match(block('.ls-promo-text'), /white-space:\s*pre-line/);
  const all = [
    '.ls-promo-dialog',
    '.ls-promo',
    '.ls-promo-close',
    '.ls-promo-body',
    '.ls-promo-previews',
    '.ls-promo-frame',
    '.ls-promo-stage',
  ]
    .map(block)
    .join('\n');
  assert.doesNotMatch(all, /(?:gap|padding|margin)[^;]*\d(?:px|rem)/, 'no px/rem spacing literal');
  assert.doesNotMatch(all, /#[0-9a-f]{3,8}\b/i, 'no hex colour');
});
