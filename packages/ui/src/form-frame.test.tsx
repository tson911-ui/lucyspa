import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { installDom } from './dom-harness';
import type { FormOverlayLabels } from './index';

// Form frame in a real DOM (jsdom): FormDialog/FormDrawer behaviour, Disclosure, CheckField, FormGrid.
const dom = installDom();
const { window } = dom;
after(() => window.close());
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
const press = (element: Element, key: string) =>
  act(() => {
    element.dispatchEvent(
      new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
const body = window.document.body;
const $ = (selector: string) => body.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...body.querySelectorAll<HTMLElement>(selector)];
const text = (element: Element | null) => element?.textContent?.trim() ?? '';

const labels: FormOverlayLabels = {
  close: 'Đóng',
  cancel: 'Hủy',
  submit: 'Tạo kỹ năng',
  submitting: 'Đang lưu',
  discardTitle: 'Bỏ thay đổi?',
  discardBody: 'Dữ liệu đã nhập sẽ mất.',
  discardConfirm: 'Bỏ thay đổi',
  discardKeep: 'Tiếp tục nhập',
};

function Harness({
  kind = 'dialog',
  busy = false,
  error,
  onSubmit,
  onClose,
}: {
  kind?: 'dialog' | 'drawer';
  busy?: boolean;
  error?: string;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const Container = kind === 'dialog' ? ui.FormDialog : ui.FormDrawer;
  return (
    <Container
      title="Thêm kỹ năng"
      labels={labels}
      busy={busy}
      dirty={name !== ''}
      error={error ? <p id="summary">{error}</p> : null}
      onSubmit={onSubmit}
      onClose={onClose}
    >
      <ui.FormGrid>
        <ui.Field label="Tên" required>
          {(control) => (
            <ui.TextInput
              {...control}
              value={name}
              onChange={(event) => setName(event.target.value)}
              invalid={error ? true : undefined}
            />
          )}
        </ui.Field>
      </ui.FormGrid>
    </Container>
  );
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

test('FormDialog: first field is focused, footer is Cancel then Save, the title is the action', () => {
  const view = mount(<Harness onSubmit={() => undefined} onClose={() => undefined} />);
  const dialog = $('[role="dialog"]')!;
  assert.equal(text(dialog.querySelector('h2')), 'Thêm kỹ năng');
  assert.equal(window.document.activeElement, dialog.querySelector('input'));
  const footer = [...dialog.querySelectorAll('.ls-dialog-footer button')];
  assert.deepEqual(footer.map(text), ['Hủy', 'Tạo kỹ năng']);
  assert.equal(footer[1]!.getAttribute('type'), 'submit');
  assert.ok(footer[1]!.classList.contains('ls-btn-primary'), 'primary last');
  view.unmount();
});

test('FormDialog: Save submits the form once; Escape on a clean form closes without asking', () => {
  let submitted = 0;
  let closed = 0;
  const view = mount(
    <Harness
      onSubmit={() => {
        submitted += 1;
      }}
      onClose={() => {
        closed += 1;
      }}
    />,
  );
  const input = $('input') as HTMLInputElement;
  // The browser blocks an invalid form before the submit event; fill the required field first.
  type(input, 'Massage');
  click($$('.ls-dialog-footer button')[1]!);
  assert.equal(submitted, 1);
  // Clear it again so the form is clean and Escape closes directly.
  type(input, '');
  press($('[role="dialog"]')!, 'Escape');
  assert.equal(closed, 1);
  assert.equal($('[role="alertdialog"]'), null);
  view.unmount();
});

test('FormDialog: a dirty form asks before discarding; keep returns to the form, discard closes', () => {
  let closed = 0;
  const view = mount(
    <Harness
      onSubmit={() => undefined}
      onClose={() => {
        closed += 1;
      }}
    />,
  );
  type($('input') as HTMLInputElement, 'Massage');
  press($('[role="dialog"]')!, 'Escape');
  assert.equal(closed, 0, 'not closed yet');
  const guard = $('[role="alertdialog"]')!;
  assert.equal(text(guard.querySelector('h2')), 'Bỏ thay đổi?');
  assert.equal(
    ($('input') as HTMLInputElement).value,
    'Massage',
    'the entered text is kept behind the question',
  );
  click([...guard.querySelectorAll('button')].find((b) => text(b) === 'Tiếp tục nhập')!);
  assert.equal($('[role="alertdialog"]'), null);
  assert.equal(closed, 0);
  click($$('.ls-dialog-footer button')[0]!);
  const second = $('[role="alertdialog"]')!;
  click([...second.querySelectorAll('button')].find((b) => text(b) === 'Bỏ thay đổi')!);
  assert.equal(closed, 1);
  view.unmount();
});

test('FormDialog: while busy nothing dismisses it and Save shows the busy label', () => {
  let closed = 0;
  const view = mount(
    <Harness
      busy
      onSubmit={() => undefined}
      onClose={() => {
        closed += 1;
      }}
    />,
  );
  press($('[role="dialog"]')!, 'Escape');
  assert.equal(closed, 0);
  const [cancel, save] = $$('.ls-dialog-footer button');
  assert.equal(cancel!.hasAttribute('disabled'), true);
  assert.equal(save!.getAttribute('aria-busy'), 'true');
  assert.equal(text(save!), 'Đang lưu');
  assert.equal(
    $('[aria-label="Đóng"]')!.hasAttribute('disabled'),
    true,
    'the header close button is off',
  );
  view.unmount();
});

test('FormDialog: an error summary is drawn above the fields and focus lands on the invalid field', () => {
  const view = mount(
    <Harness error="Mã đã tồn tại" onSubmit={() => undefined} onClose={() => undefined} />,
  );
  const form = $('form.ls-form')!;
  assert.equal(text($('#summary')), 'Mã đã tồn tại');
  assert.ok(form.firstElementChild?.matches('.ls-form-error'), 'summary is the first block');
  assert.equal(window.document.activeElement, form.querySelector('input'));
  view.unmount();
});

test('FormDialog: closing returns focus to the button that opened it', () => {
  const opener = window.document.createElement('button');
  window.document.body.appendChild(opener);
  opener.focus();
  const view = mount(<Harness onSubmit={() => undefined} onClose={() => undefined} />);
  assert.notEqual(window.document.activeElement, opener);
  view.unmount();
  assert.equal(window.document.activeElement, opener);
  opener.remove();
});

test('FormDrawer: a side drawer on desktop, a bottom sheet on a phone, same footer order', () => {
  const view = mount(
    <Harness kind="drawer" onSubmit={() => undefined} onClose={() => undefined} />,
  );
  assert.ok($('.ls-drawer-form.ls-drawer-end'), 'side drawer');
  assert.deepEqual($$('.ls-dialog-footer button').map(text), ['Hủy', 'Tạo kỹ năng']);
  act(() => dom.setPhone(true));
  assert.ok($('.ls-drawer-form.ls-drawer-bottom'), 'bottom sheet on a phone');
  act(() => dom.setPhone(false));
  view.unmount();
});

test('Disclosure: a button with aria-expanded and aria-controls; the panel is hidden until opened', () => {
  const view = mount(
    <ui.Disclosure title="Tùy chọn nâng cao">
      <p id="adv">Nội dung</p>
    </ui.Disclosure>,
  );
  const trigger = view.container.querySelector('button')!;
  const panel = view.container.querySelector('.ls-disclosure-panel') as HTMLElement;
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(trigger.getAttribute('aria-controls'), panel.id);
  assert.equal(panel.hidden, true);
  assert.equal(view.container.querySelector('details'), null, 'never a <details>');
  click(trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(panel.hidden, false);
  assert.ok(view.container.querySelector('.ls-disclosure-open'), 'the chevron turns');
  view.unmount();
});

test('CheckField: the whole row is the label; hint is linked; radio type is supported', () => {
  const view = mount(
    <div>
      <ui.CheckField label="Quản lý kỹ năng" hint="Cho phép sửa danh mục" defaultChecked />
      <ui.CheckField type="radio" name="r" label="Một" />
    </div>,
  );
  const rows = [...view.container.querySelectorAll('label.ls-check.ls-check-field')];
  assert.equal(rows.length, 2);
  const input = rows[0]!.querySelector('input')!;
  assert.equal(input.type, 'checkbox');
  assert.equal(
    rows[0]!.querySelector('.ls-hint')!.id,
    input.getAttribute('aria-describedby'),
    'hint is the description',
  );
  assert.equal(rows[1]!.querySelector('input')!.type, 'radio');
  view.unmount();

  // A label can carry a badge or a code, and can be visually hidden for a bare table-cell checkbox.
  const rich = mount(
    <ui.CheckField
      label={
        <span>
          Quyền <em className="code">(VIEW_X)</em>
        </span>
      }
    />,
  );
  assert.ok(rich.container.querySelector('label.ls-check-field .code'));
  rich.unmount();
  const hidden = mount(<ui.CheckField label={<ui.VisuallyHidden>Chọn: Lan</ui.VisuallyHidden>} />);
  assert.equal(text(hidden.container.querySelector('label')), 'Chọn: Lan');
  hidden.unmount();
});

test('FormGrid, Field width and FormSection: classes carry the layout, no fieldset', () => {
  const view = mount(
    <ui.FormGrid cols={2}>
      <ui.Field label="Mã" width="sm">
        <ui.TextInput />
      </ui.Field>
      <ui.Field label="Ghi chú" full>
        <ui.Textarea />
      </ui.Field>
      <ui.FormSection title="Liên hệ" description="Hiển thị cho khách">
        <span>x</span>
      </ui.FormSection>
    </ui.FormGrid>,
  );
  assert.ok(view.container.querySelector('.ls-form-grid.ls-form-grid-2'));
  assert.ok(view.container.querySelector('.ls-field.ls-field-sm'));
  assert.ok(view.container.querySelector('.ls-field.ls-field-full'));
  assert.equal(view.container.querySelector('fieldset'), null);
  const section = view.container.querySelector('section.ls-form-section')!;
  assert.equal(
    section.getAttribute('aria-labelledby'),
    section.querySelector('h3')!.id,
    'a named region',
  );
  view.unmount();
});

test('RadioGroup options are row-wide targets and a field never stretches its control', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('./components.css', import.meta.url), 'utf8');
  const view = mount(
    <ui.RadioGroup
      legend="Phân loại"
      name="c"
      value={null}
      onValueChange={() => undefined}
      options={[{ value: 'a', label: 'A', hint: 'gợi ý' }]}
    />,
  );
  assert.ok(view.container.querySelector('label.ls-check.ls-check-field'));
  view.unmount();
  // In a two-column grid a taller sibling must not stretch this field's control (inputs stay 40 px).
  assert.match(css, /\.ls-field\s*\{[^}]*align-content:\s*start/s);
  assert.match(css, /\.ls-radios > legend\s*\{[^}]*margin-block-end:\s*var\(--ls-space-1\)/s);
});
