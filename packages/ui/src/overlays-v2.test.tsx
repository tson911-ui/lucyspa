import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { installDom } from './dom-harness';
import type { FormOverlayLabels } from './index';

// Redesign group 1, C6: how the overlays and the data parts behave (focus trap and return, Escape, one modal at a time) and the rules of
// their v2 stylesheet (DESIGN.md 8.6, 8.8, 8.9, H13).
const dom = installDom();
const { window } = dom;
after(() => window.close());
// jsdom has no layout, so every element reports no offset parent and the focus trap would find nothing to cycle through.
Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
  configurable: true,
  get() {
    return (this as HTMLElement).parentNode;
  },
});
const { act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
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
const press = (element: Element, key: string, shift = false) =>
  act(() => {
    element.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key,
        shiftKey: shift,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
const body = window.document.body;
const $ = (selector: string) => body.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...body.querySelectorAll<HTMLElement>(selector)];
const css = readFileSync(new URL('components-v2.css', import.meta.url), 'utf8');

const labels: FormOverlayLabels = {
  close: 'Đóng',
  cancel: 'Hủy',
  submit: 'Lưu',
  discardTitle: 'Bỏ thay đổi?',
  discardBody: 'Dữ liệu đã nhập sẽ mất.',
  discardConfirm: 'Bỏ thay đổi',
  discardKeep: 'Tiếp tục nhập',
};

test('Dialog: focus enters the panel, Tab cycles inside it, Escape closes, focus returns to the opener', () => {
  const opener = window.document.createElement('button');
  window.document.body.appendChild(opener);
  opener.focus();
  let closed = 0;
  const view = mount(
    <ui.Dialog
      title="Liên hệ"
      closeLabel="Đóng"
      onClose={() => {
        closed += 1;
      }}
      footer={<ui.Button variant="primary">Lưu</ui.Button>}
    >
      <input aria-label="Tên" />
    </ui.Dialog>,
  );
  const panel = $('.ls-dialog')!;
  const focusable = [...panel.querySelectorAll<HTMLElement>('button, input')];
  assert.ok(panel.contains(window.document.activeElement), 'focus moved into the dialog');
  assert.equal(panel.getAttribute('aria-modal'), 'true');
  // From the last control, Tab wraps to the first; from the first, Shift+Tab wraps to the last.
  focusable.at(-1)!.focus();
  press(focusable.at(-1)!, 'Tab');
  assert.equal(window.document.activeElement, focusable[0]);
  press(focusable[0]!, 'Tab', true);
  assert.equal(window.document.activeElement, focusable.at(-1));
  press(panel, 'Escape');
  assert.equal(closed, 1);
  view.unmount();
  assert.equal(window.document.activeElement, opener, 'focus returned to the opener');
  opener.remove();
});

test('Dialog: a busy dialog ignores Escape and the backdrop', () => {
  let closed = 0;
  const view = mount(
    <ui.Dialog
      title="Đang lưu"
      busy
      onClose={() => {
        closed += 1;
      }}
    >
      <p>Chờ một chút</p>
    </ui.Dialog>,
  );
  press($('.ls-dialog')!, 'Escape');
  assert.equal(closed, 0);
  view.unmount();
});

test('ConfirmDialog: an alertdialog whose focus starts on the neutral Cancel', () => {
  const view = mount(
    <ui.ConfirmDialog
      title="Hủy lịch hẹn?"
      description="Lịch hẹn sẽ được hủy."
      confirmLabel="Hủy lịch hẹn"
      cancelLabel="Giữ lịch hẹn"
      describeError={() => ({ message: '' })}
      onConfirm={() => Promise.resolve()}
      onCancel={() => undefined}
    />,
  );
  assert.equal($('.ls-dialog')!.getAttribute('role'), 'alertdialog');
  const cancel = $('.ls-dialog-footer .ls-btn-neutral')!;
  assert.equal(cancel.textContent?.trim(), 'Giữ lịch hẹn');
  assert.equal(window.document.activeElement, cancel);
  assert.ok($('.ls-dialog-footer .ls-btn-danger'), 'the solid danger button lives only here');
  view.unmount();
});

function Harness() {
  const [name, setName] = useState('');
  return (
    <ui.FormDialog
      title="Thêm kỹ năng"
      labels={labels}
      dirty={name !== ''}
      onClose={() => undefined}
      onSubmit={() => undefined}
    >
      <ui.Field label="Tên">
        {(control) => (
          <ui.TextInput {...control} value={name} onChange={(e) => setName(e.target.value)} />
        )}
      </ui.Field>
    </ui.FormDialog>
  );
}

test('FormDialog: the discard prompt suspends the form, so one modal is on the screen; keeping the input brings it back', () => {
  const view = mount(<Harness />);
  const input = $('input')!;
  act(() => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, 'Massage');
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  click($$('.ls-dialog-footer button').find((button) => button.textContent === 'Hủy')!);
  const backdrops = $$('.ls-backdrop');
  assert.equal(backdrops.length, 2, 'the form is still mounted, with its state');
  assert.equal(backdrops.filter((item) => !item.hasAttribute('data-suspended')).length, 1);
  assert.ok(backdrops[0]!.hasAttribute('data-suspended'), 'the form surface is the suspended one');
  assert.equal($('.ls-dialog[role="alertdialog"]')?.textContent?.includes('Bỏ thay đổi?'), true);
  click($$('.ls-dialog-footer button').find((button) => button.textContent === 'Tiếp tục nhập')!);
  assert.equal($$('.ls-backdrop').length, 1);
  assert.equal($('.ls-backdrop')!.hasAttribute('data-suspended'), false);
  assert.equal(($('input') as HTMLInputElement).value, 'Massage', 'the typed text was kept');
  view.unmount();
});

test('Accordion: buttons with aria-expanded, a hidden panel, arrows move between rows, one open at a time', () => {
  const view = mount(
    <ui.Accordion
      items={[
        { id: 'a', title: 'Một', content: <p>Nội dung một</p> },
        { id: 'b', title: 'Hai', content: <p>Nội dung hai</p> },
        { id: 'c', title: 'Ba', content: <p>Nội dung ba</p> },
      ]}
    />,
  );
  const triggers = $$('.ls-accordion-trigger');
  const panels = $$('.ls-accordion-panel');
  assert.equal(view.container.querySelector('details'), null, 'never a <details>');
  assert.deepEqual(
    triggers.map((item) => item.getAttribute('aria-expanded')),
    ['false', 'false', 'false'],
  );
  assert.equal(triggers[0]!.getAttribute('aria-controls'), panels[0]!.id);
  assert.equal(panels[0]!.getAttribute('aria-labelledby'), triggers[0]!.id);
  assert.ok(panels.every((panel) => panel.hidden));
  click(triggers[0]!);
  assert.equal(panels[0]!.hidden, false);
  click(triggers[1]!);
  assert.deepEqual(
    panels.map((panel) => panel.hidden),
    [true, false, true],
    'opening a row closes the other',
  );
  triggers[0]!.focus();
  press(triggers[0]!, 'ArrowDown');
  assert.equal(window.document.activeElement, triggers[1]);
  press(triggers[1]!, 'End');
  assert.equal(window.document.activeElement, triggers[2]);
  press(triggers[2]!, 'ArrowDown');
  assert.equal(window.document.activeElement, triggers[0], 'wraps');
  view.unmount();
});

test('Pagination: first and last are marked, a phone shows "Page x / y" when the label is given', () => {
  const pagerLabels = {
    nav: 'Các trang',
    first: 'Trang đầu',
    previous: 'Trang trước',
    next: 'Trang sau',
    last: 'Trang cuối',
    pageNumber: 'Trang {page}',
    summary: 'Hiển thị {from}–{to} trong {total}',
    pageSize: 'Số dòng',
    pageSizeOption: '{size} dòng',
  };
  const plain = mount(
    <ui.Pagination
      page={2}
      pageSize={20}
      total={132}
      onPageChange={() => undefined}
      labels={pagerLabels}
    />,
  );
  assert.equal($$('.ls-page-edge').length, 2);
  assert.ok($$('.ls-page-num').length >= 3);
  assert.equal($('.ls-pagination-of'), null, 'no label, no phone text');
  plain.unmount();
  const phone = mount(
    <ui.Pagination
      page={2}
      pageSize={20}
      total={132}
      onPageChange={() => undefined}
      labels={{ ...pagerLabels, pageOf: 'Trang {page} / {pages}' }}
    />,
  );
  assert.equal($('.ls-pagination-of')?.textContent, 'Trang 2 / 7');
  phone.unmount();
});

test('v2 overlay and data rules: raised surface and hairline, 18 px, 512 drawer, neutral Cancel, no shadow', () => {
  assert.match(
    css,
    /\.ls-dialog \{[^}]*border-radius: var\(--ls-radius-lg\);[^}]*background: var\(--ls-bg-raised\)/,
  );
  assert.match(css, /\.ls-drawer \{[^}]*width: min\(100%, var\(--ls-drawer-form\)\)/);
  assert.match(css, /\.ls-backdrop\[data-suspended\] \{\s*visibility: hidden;/);
  assert.match(
    css,
    /\.ls-toast \{[^}]*border-radius: var\(--ls-radius-lg\);[^}]*background: var\(--ls-bg-raised\)/,
  );
  assert.match(css, /\.ls-page-current \{[^}]*background: var\(--ls-brand-fill\)/);
  assert.match(css, /\.ls-page-edge,\s*\[data-ui='v2'\] \.ls-pagination-of \{\s*display: none;/);
  assert.match(
    css,
    /\.ls-table-wrap,\s*\[data-ui='v2'\] \.ls-table-state \{[^}]*border-radius: var\(--ls-radius-lg\)/,
  );
  assert.match(css, /\.ls-table thead th \{[^}]*background: var\(--ls-bg-sunken\)/);
  assert.match(css, /\.ls-progress \{\s*height: var\(--ls-space-1\);/);
  assert.match(
    css,
    /\.ls-accordion-trigger\[aria-expanded='true'\] svg \{\s*transform: rotate\(180deg\)/,
  );
});
