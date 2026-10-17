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
const { act, useRef, useState } = await import('react');
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

// Hotfix 1/2 (2026-10-17): a Dialog with its own form opened inside a FormDialog (the image picker's description step in the brand
// form). Dialogs are not portaled. jsdom bubbles the nested submit into the host form, so the host must ignore it; real Chromium does
// not deliver it past the nested form at all (the real cause of the brand-logo bug, proved in a browser: see media-picker.tsx).
function NestedForms({ calls }: { calls: string[] }) {
  const [describing, setDescribing] = useState(true);
  return (
    <ui.FormDialog
      title="Sửa thương hiệu"
      labels={labels}
      onClose={() => undefined}
      onSubmit={() => {
        calls.push('host saved');
      }}
    >
      <input aria-label="Tên thương hiệu" />
      {describing ? (
        <ui.Dialog
          title="Thêm mô tả cho ảnh"
          onClose={() => setDescribing(false)}
          footer={
            <ui.Button type="submit" form="describe" variant="primary">
              Lưu mô tả và dùng ảnh
            </ui.Button>
          }
        >
          <form
            id="describe"
            onSubmit={(event) => {
              event.preventDefault();
              calls.push('description saved');
              setDescribing(false);
            }}
          >
            <input aria-label="Mô tả" />
          </form>
        </ui.Dialog>
      ) : null}
    </ui.FormDialog>
  );
}

test('FormDialog: a nested dialog form submits only itself; the host form stays open and unsaved until its own Save', () => {
  const calls: string[] = [];
  const view = mount(<NestedForms calls={calls} />);
  const inner = $('form#describe')!;
  const host = inner.parentElement!.closest('form')!;
  assert.ok(
    host.contains(inner),
    'the description form sits inside the host form, as on the brand form',
  );
  act(() => {
    inner.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.deepEqual(calls, ['description saved']);
  assert.equal($('form#describe'), null);
  act(() => {
    host.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
  assert.deepEqual(calls, ['description saved', 'host saved']);
  view.unmount();
});

// C60: a confirmation whose command needs a second question (the staff password check) is suspended while that question is open,
// then comes back with its reason; the requests run in the same order as before (command, check, command again).
function CheckedConfirm({ calls }: { calls: string[] }) {
  const [checking, setChecking] = useState(false);
  const answer = useRef<((ok: boolean) => void) | null>(null);
  const check = () =>
    new Promise<boolean>((resolve) => {
      answer.current = resolve;
      setChecking(true);
    });
  const finish = (ok: boolean) => {
    setChecking(false);
    answer.current?.(ok);
  };
  return (
    <>
      <ui.ConfirmDialog
        title="Hủy hóa đơn?"
        description="Hóa đơn sẽ bị hủy."
        confirmLabel="Hủy hóa đơn"
        cancelLabel="Giữ hóa đơn"
        reasonField={{ label: 'Lý do', required: true }}
        suspended={checking}
        describeError={(error) => ({ message: (error as Error).message })}
        onConfirm={async (reason) => {
          calls.push(`send ${reason}`);
          if (!(await check())) throw new Error('Đã hủy xác nhận mật khẩu.');
          calls.push(`send again ${reason}`);
        }}
        onCancel={() => undefined}
      />
      {checking ? (
        <ui.Dialog title="Xác nhận mật khẩu" onClose={() => finish(false)}>
          <ui.Button onClick={() => finish(false)}>Thôi</ui.Button>
          <ui.Button onClick={() => finish(true)}>Xác nhận</ui.Button>
        </ui.Dialog>
      ) : null}
    </>
  );
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

test('ConfirmDialog: the password check opens alone (the confirm is suspended), a cancel brings the confirm back as it was', async () => {
  const calls: string[] = [];
  const view = mount(<CheckedConfirm calls={calls} />);
  const reason = $('textarea') as HTMLTextAreaElement;
  act(() => {
    const set = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    set.call(reason, 'Khách đổi ý');
    reason.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  click($('.ls-dialog-footer .ls-btn-danger')!);
  await settle();
  const backdrops = $$('.ls-backdrop');
  assert.equal(
    backdrops.length,
    2,
    'the confirm stays mounted with its reason and pending request',
  );
  assert.equal(
    backdrops.filter((item) => !item.hasAttribute('data-suspended')).length,
    1,
    'one modal on screen',
  );
  assert.ok(backdrops[0]!.hasAttribute('data-suspended'), 'the confirm is the suspended one');
  click($$('button').find((button) => button.textContent === 'Thôi')!);
  await settle();
  assert.deepEqual(calls, ['send Khách đổi ý'], 'a cancelled check sends nothing again');
  assert.equal($$('.ls-backdrop').length, 1);
  assert.equal($('.ls-backdrop')!.hasAttribute('data-suspended'), false, 'the confirm is back');
  assert.equal(($('textarea') as HTMLTextAreaElement).value, 'Khách đổi ý', 'with the reason');
  // Confirmed: the command runs again after the check, and the confirm's own flow continues.
  click($('.ls-dialog-footer .ls-btn-danger')!);
  await settle();
  assert.ok($$('.ls-backdrop')[0]!.hasAttribute('data-suspended'));
  click($$('button').find((button) => button.textContent === 'Xác nhận')!);
  await settle();
  assert.deepEqual(calls, ['send Khách đổi ý', 'send Khách đổi ý', 'send again Khách đổi ý']);
  assert.equal($('.ls-backdrop')!.hasAttribute('data-suspended'), false);
  view.unmount();
});

function SuspendedForm({ drawer }: { drawer: boolean }) {
  const [name, setName] = useState('');
  const [checking, setChecking] = useState(false);
  const Surface = drawer ? ui.FormDrawer : ui.FormDialog;
  return (
    <>
      <Surface
        open
        title="Hoàn tiền"
        labels={labels}
        dirty={name !== ''}
        suspended={checking}
        onClose={() => undefined}
        onSubmit={() => setChecking(true)}
      >
        <ui.Field label="Lý do">
          {(control) => (
            <ui.TextInput {...control} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </ui.Field>
      </Surface>
      {checking ? (
        <ui.Dialog title="Xác nhận mật khẩu" onClose={() => setChecking(false)}>
          <ui.Button onClick={() => setChecking(false)}>Thôi</ui.Button>
        </ui.Dialog>
      ) : null}
    </>
  );
}

for (const drawer of [false, true]) {
  test(`${drawer ? 'FormDrawer' : 'FormDialog'}: suspended while the password check is open, the input kept, back on cancel (C60)`, () => {
    const view = mount(<SuspendedForm drawer={drawer} />);
    const input = $('input')!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, 'Hàng lỗi');
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    act(() => {
      $('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    const backdrops = $$('.ls-backdrop');
    assert.equal(backdrops.length, 2);
    assert.equal(backdrops.filter((item) => !item.hasAttribute('data-suspended')).length, 1);
    assert.ok(backdrops[0]!.hasAttribute('data-suspended'), 'the form is the suspended one');
    click($$('button').find((button) => button.textContent === 'Thôi')!);
    assert.equal($$('.ls-backdrop').length, 1);
    assert.equal($('.ls-backdrop')!.hasAttribute('data-suspended'), false, 'the form is back');
    assert.equal(($('input') as HTMLInputElement).value, 'Hàng lỗi', 'with the typed input');
    view.unmount();
  });
}

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
