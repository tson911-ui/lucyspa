import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Card, CardHeader, SortableGrid, Stat } from './index';

const format = { valueFormat: 'count', locale: 'vi' } as const;
const labels = { up: 'tăng', down: 'giảm', flat: 'không đổi', comparedTo: 'so với hôm qua' };

test('Card renders its element, passes attributes and keeps one class hook', () => {
  const html = renderToStaticMarkup(
    <Card as="section" aria-labelledby="t" className="extra">
      <CardHeader id="t" title="Lịch hẹn" description="Hôm nay" actions={<span>Xem</span>} />
    </Card>,
  );
  assert.match(html, /^<section[^>]*class="ls-card extra"/);
  assert.match(html, /aria-labelledby="t"/);
  assert.match(html, /<h2 class="ls-card-title" id="t">Lịch hẹn<\/h2>/);
  assert.match(html, /Hôm nay/);
  assert.match(html, /<span>Xem<\/span>/);
});

test('CardHeader heading level is configurable and actions are optional', () => {
  const html = renderToStaticMarkup(<CardHeader title="T" headingLevel={3} />);
  assert.match(html, /<h3 /);
  assert.doesNotMatch(html, /ls-card-actions/);
});

test('Stat shows label, formatted value and a note; the change needs previous and labels', () => {
  const plain = renderToStaticMarkup(
    <Stat label="Đang chờ" value={1234} format={format} note="n" />,
  );
  assert.match(plain, /Đang chờ/);
  assert.match(plain, /1\.234/);
  assert.doesNotMatch(plain, /ls-kpi-delta/);

  const compared = renderToStaticMarkup(
    <Stat label="L" value={12} previous={10} format={format} labels={labels} />,
  );
  assert.match(compared, /ls-kpi-delta/);
  assert.match(compared, /tăng/);
  assert.match(compared, /so với hôm qua/);

  // No previous value (or zero): nothing to compare with, so no change line.
  const none = renderToStaticMarkup(
    <Stat label="L" value={12} previous={0} format={format} labels={labels} />,
  );
  assert.doesNotMatch(none, /ls-kpi-delta/);
});

const sortLabels = {
  dragHandle: 'Kéo {name}',
  moveEarlier: 'Lên {name}',
  moveLater: 'Xuống {name}',
  roleDescription: 'mục',
  instructions: 'i',
  lifted: 'l',
  moved: 'm',
  dropped: 'd',
  cancelled: 'c',
};

test('SortableGrid bare variant and per-item class apply in view and edit mode', () => {
  const items = [
    { id: 'a', size: 's' },
    { id: 'b', size: 'l' },
  ];
  for (const disabled of [true, false]) {
    const html = renderToStaticMarkup(
      <SortableGrid
        items={items}
        getId={(item) => item.id}
        getLabel={(item) => item.id}
        renderItem={(item) => <Card>{item.id}</Card>}
        onReorder={() => undefined}
        labels={sortLabels}
        ariaLabel="grid"
        disabled={disabled}
        variant="bare"
        className="ls-widget-grid"
        itemClassName={(item) => `ls-widget-${item.size}`}
      />,
    );
    assert.match(html, /class="ls-sortable ls-sortable-grid ls-sortable-bare ls-widget-grid"/);
    assert.match(html, /ls-sortable-item ls-widget-s/);
    assert.match(html, /ls-sortable-item ls-widget-l/);
    // Handles and move buttons exist only while editing.
    assert.equal(/ls-sortable-handle/.test(html), !disabled);
  }
});
