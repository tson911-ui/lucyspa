import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dialog, Drawer, FormSection, Page, RadioGroup } from './index';

// UX/UI Step 14 final gate: fixes found by the axe pass and the 360/768 renders of the Step 12/13 screens.

const css = readFileSync(new URL('components.css', import.meta.url), 'utf8');

test('FormSection title is an h2 directly under a page and an h3 inside a dialog or drawer', () => {
  const section = <FormSection title="Lịch hiển thị">x</FormSection>;
  assert.match(renderToStaticMarkup(<Page>{section}</Page>), /<h2 class="ls-form-section-title"/);
  assert.match(renderToStaticMarkup(section), /<h3 class="ls-form-section-title"/);
  const dialog = renderToStaticMarkup(
    <Page>
      <Dialog open title="Sửa" closeLabel="Đóng" onClose={() => undefined}>
        {section}
      </Dialog>
    </Page>,
  );
  assert.match(dialog, /<h3 class="ls-form-section-title"/);
  const drawer = renderToStaticMarkup(
    <Page>
      <Drawer open title="Sửa" closeLabel="Đóng" onClose={() => undefined}>
        {section}
      </Drawer>
    </Page>,
  );
  assert.match(drawer, /<h3 class="ls-form-section-title"/);
});

test('RadioGroup carries required and invalid on a radiogroup, not on a plain fieldset', () => {
  const markup = renderToStaticMarkup(
    <RadioGroup
      legend="Phân loại"
      name="kind"
      value={null}
      onValueChange={() => undefined}
      options={[{ value: 'a', label: 'A' }]}
      required
      invalid
    />,
  );
  assert.match(
    markup,
    /<fieldset role="radiogroup"[^>]*aria-required="true"[^>]*aria-invalid="true"/,
  );
});

test('a field column may shrink below a native date input, and a media row wraps its schedule', () => {
  assert.match(css, /\.ls-field \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.ls-media-row \.ls-media-meta \{[^}]*white-space: normal/);
});

test('an ordered list item is a rail plus content on a phone, so slide text keeps its width', () => {
  assert.match(
    css,
    /@media \(max-width: 639px\) \{[^@]*\.ls-sortable-list > \.ls-sortable-item \{[^}]*display: grid/,
  );
  assert.match(
    css,
    /\.ls-sortable-list > \.ls-sortable-item > \.ls-sortable-moves \{[^}]*flex-direction: column/,
  );
});
