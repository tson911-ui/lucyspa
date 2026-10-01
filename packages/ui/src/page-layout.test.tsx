import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Card,
  CardHeader,
  Cluster,
  EmptyState,
  Grid,
  Page,
  PageHeader,
  RouteFade,
  Stack,
} from './index';

const css = readFileSync(new URL('components.css', import.meta.url), 'utf8');
const shellCss = readFileSync(new URL('shell.css', import.meta.url), 'utf8');

function block(source: string, selector: string): string {
  const escaped = selector.replace(/[.[\]()>*,:]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  assert.ok(match, `rule ${selector} exists`);
  return match[1] ?? '';
}

test('Page picks its width variant and keeps extra classes', () => {
  assert.match(renderToStaticMarkup(<Page>x</Page>), /class="ls-page ls-page-default"/);
  assert.match(renderToStaticMarkup(<Page width="form">x</Page>), /ls-page-form/);
  assert.match(
    renderToStaticMarkup(
      <Page width="full" className="a">
        x
      </Page>,
    ),
    /ls-page-full a/,
  );
});

test('PageHeader: one h1, optional description, breadcrumbs and actions in that order', () => {
  const html = renderToStaticMarkup(
    <PageHeader
      title="Kỹ năng chuyên môn"
      description="Danh mục kỹ năng"
      breadcrumbs={<nav>Trang chủ</nav>}
      actions={
        <>
          <button type="button">Tải lại</button>
          <button type="button">Thêm kỹ năng</button>
        </>
      }
    />,
  );
  assert.equal(html.match(/<h1 /g)?.length, 1);
  assert.match(html, /Danh mục kỹ năng/);
  assert.ok(html.indexOf('Trang chủ') < html.indexOf('<h1'), 'crumbs above the title');
  assert.ok(html.indexOf('<h1') < html.indexOf('ls-page-actions'), 'actions after the title');
  assert.ok(html.indexOf('Tải lại') < html.indexOf('Thêm kỹ năng'), 'primary action last');

  const bare = renderToStaticMarkup(<PageHeader title="T" />);
  assert.doesNotMatch(bare, /ls-page-description|ls-page-actions|ls-page-crumbs/);
});

test('Stack, Cluster and Grid take their gap from named tokens, never from the caller', () => {
  assert.match(renderToStaticMarkup(<Stack gap="page">x</Stack>), /ls-stack ls-gap-page/);
  assert.match(renderToStaticMarkup(<Stack>x</Stack>), /ls-gap-block/);
  assert.match(renderToStaticMarkup(<Cluster gap="tight">x</Cluster>), /ls-cluster ls-gap-tight/);
  assert.match(renderToStaticMarkup(<Cluster align="end">x</Cluster>), /ls-align-end/);
  assert.match(renderToStaticMarkup(<Grid min="lg">x</Grid>), /ls-grid ls-grid-lg ls-gap-block/);
  assert.match(renderToStaticMarkup(<Stack as="ul">x</Stack>), /^<ul /);

  assert.match(block(css, '.ls-gap-page'), /gap:\s*var\(--ls-space-6\)/);
  assert.match(block(css, '.ls-gap-inline'), /gap:\s*var\(--ls-space-2\)/);
  assert.match(block(css, '.ls-gap-tight'), /gap:\s*var\(--ls-space-1\)/);
  assert.match(css, /\.ls-gap-block,\s*\.ls-gap-field \{\s*gap:\s*var\(--ls-space-4\)/);
});

test('page frame CSS: tokens only, children carry no outer margin, grid tracks cannot overflow', () => {
  const frame = css.slice(css.indexOf('/* ---- Page frame'));
  assert.doesNotMatch(
    frame,
    /(?:margin|padding|gap)[a-z-]*:[^;]*\b\d*\.?\d+(?:px|rem)\b/,
    'no px/rem spacing literal',
  );
  assert.match(block(css, '.ls-page'), /padding:\s*var\(--ls-space-6\) var\(--ls-gutter\)/);
  assert.match(block(css, '.ls-page'), /min-width:\s*0/);
  assert.match(block(css, '.ls-page'), /max-width:\s*var\(--ls-content-max\)/);
  assert.match(block(css, '.ls-page-form'), /max-width:\s*var\(--ls-form-max\)/);
  assert.match(
    block(css, '.ls-page > *,\n.ls-stack > *,\n.ls-cluster > *,\n.ls-grid > *,\n.ls-card > *'),
    /margin-block:\s*0/,
  );
  assert.match(block(css, '.ls-grid-md'), /minmax\(min\(100%, 16rem\), 1fr\)/);
  assert.match(block(css, '.ls-page-header-row'), /flex-wrap:\s*wrap/);
  assert.match(block(css, '.ls-page-actions'), /margin-inline-start:\s*auto/);
});

test('inside a card the table wrapper and the empty state lose their own border (flush)', () => {
  const flush = block(css, '.ls-card .ls-table-wrap,\n.ls-card .ls-empty');
  assert.match(flush, /border:\s*0/);
  assert.match(flush, /box-shadow:\s*none/);
  const html = renderToStaticMarkup(
    <Card>
      <CardHeader title="Danh sách" />
      <EmptyState>Chưa có dữ liệu</EmptyState>
    </Card>,
  );
  assert.match(html, /ls-card.*ls-empty/s);
});

test('a Card inside a Card is reported in development and a plain card is not', () => {
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void errors.push(args);
  try {
    renderToStaticMarkup(
      <Card>
        <EmptyState>Chưa có dữ liệu</EmptyState>
      </Card>,
    );
    assert.equal(errors.length, 0, 'content inside a card is not a nested card');
    renderToStaticMarkup(
      <Card>
        <Card>x</Card>
      </Card>,
    );
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]?.[0]), /Card inside Card/);
  } finally {
    console.error = original;
  }
});

test('RouteFade stack makes the route wrapper the page block container', () => {
  assert.match(
    renderToStaticMarkup(<RouteFade stack>x</RouteFade>),
    /ls-route-fade ls-stack ls-gap-page/,
  );
  assert.equal(
    renderToStaticMarkup(<RouteFade>x</RouteFade>),
    '<div class="ls-route-fade">x</div>',
    'unchanged for the customer area',
  );
});

test('nav list gap sits on the grid (4 px token) and the active bar is a 4 px edge', () => {
  assert.match(block(shellCss, '.ls-nav-list'), /gap:\s*var\(--ls-space-1\)/);
  assert.match(block(shellCss, ".ls-nav-link[aria-current='page']"), /inset 4px 0 0/);
});
