import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Button,
  ButtonLink,
  IconButton,
  MoneyInput,
  NumberInput,
  Select,
  SelectIconScope,
  TextInput,
  Textarea,
  buttonClass,
} from './index';

// Redesign group 1, C4: the variants and the compact prop that the v2 stylesheet styles (DESIGN.md 8.1, 8.2).
const noop = () => undefined;

test('buttonClass: neutral is a variant, compact is a modifier, the old calls are unchanged', () => {
  assert.equal(buttonClass('primary', 'md'), 'ls-btn ls-btn-primary ls-btn-md');
  assert.equal(buttonClass('neutral', 'md'), 'ls-btn ls-btn-neutral ls-btn-md');
  assert.equal(
    buttonClass('secondary', 'md', 'extra', true),
    'ls-btn ls-btn-secondary ls-btn-md ls-btn-compact extra',
  );
});

test('Button, ButtonLink and IconButton take the compact prop without leaking it to the DOM', () => {
  const button = renderToStaticMarkup(
    <Button variant="neutral" compact>
      Hủy
    </Button>,
  );
  assert.match(button, /class="ls-btn ls-btn-neutral ls-btn-md ls-btn-compact"/);
  assert.doesNotMatch(button, /compact=/);
  const link = renderToStaticMarkup(
    <ButtonLink href="/vi" compact>
      Xem
    </ButtonLink>,
  );
  assert.match(link, /ls-btn-compact/);
  assert.doesNotMatch(link, /compact=/);
  const icon = renderToStaticMarkup(<IconButton icon="close" label="Đóng" compact />);
  assert.match(icon, /ls-btn-icon ls-btn-compact|ls-btn-compact ls-btn-icon/);
  assert.doesNotMatch(icon, /compact=/);
  assert.doesNotMatch(renderToStaticMarkup(<Button>Lưu</Button>), /ls-btn-compact/);
});

test('inputs take the compact prop as a class and keep it off the DOM', () => {
  const html = renderToStaticMarkup(
    <>
      <TextInput compact aria-label="a" />
      <NumberInput compact aria-label="b" />
      <MoneyInput compact aria-label="c" value={1000} onValueChange={noop} />
      <Textarea compact aria-label="d" />
      <Select compact aria-label="e" options={[{ value: '1', label: 'Một' }]} />
    </>,
  );
  assert.equal(html.match(/ls-input-compact/g)?.length, 5);
  assert.doesNotMatch(html, /compact=/);
  assert.doesNotMatch(renderToStaticMarkup(<TextInput aria-label="a" />), /ls-input-compact/);
});

test('Select: plain outside the v2 frame; inside SelectIconScope it is wrapped with the chevron icon and the caller class moves to the wrapper', () => {
  const options = [{ value: '1', label: 'Một' }];
  const plain = renderToStaticMarkup(<Select aria-label="s" className="x" options={options} />);
  assert.doesNotMatch(plain, /ls-select-wrap|ls-select-icon/);
  assert.match(plain, /^<select [^>]*class="ls-input ls-select x"/);
  const framed = renderToStaticMarkup(
    <SelectIconScope>
      <Select aria-label="s" className="x" options={options} />
    </SelectIconScope>,
  );
  assert.match(framed, /^<span class="ls-select-wrap x"><select [^>]*class="ls-input ls-select"/);
  assert.match(framed, /<span class="ls-select-icon" aria-hidden="true"><svg/);
  assert.match(framed, /M6 9l6 6 6-6/, 'the chevron-down path of the icon set');
  const multiple = renderToStaticMarkup(
    <SelectIconScope>
      <Select aria-label="s" multiple options={options} />
    </SelectIconScope>,
  );
  assert.doesNotMatch(multiple, /ls-select-wrap/, 'a list box has no arrow');
});
