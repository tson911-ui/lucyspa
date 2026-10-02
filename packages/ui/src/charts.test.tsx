import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { installDom } from './dom-harness';
import type { Comparison, Series } from './index';

const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act, useState } = await import('react');
const { createRoot } = await import('react-dom/client');
const kit = await import('./index');
const {
  BarChart,
  ChartFrame,
  ComparisonToggle,
  DateRangePicker,
  DonutChart,
  KpiCard,
  LineChart,
  Sparkline,
} = kit;

const plain = (text: string | null | undefined) =>
  (text ?? '').replace(new RegExp('[\u00a0\u202f]', 'g'), ' ');
const format = { valueFormat: 'vnd' as const, locale: 'vi' as const };
const labels = {
  xHeader: 'Ngày',
  previous: 'Kỳ trước',
  showTable: 'Xem dạng bảng',
  showChart: 'Xem dạng biểu đồ',
  plotHint: 'Dùng phím mũi tên để chuyển giữa các điểm.',
  up: 'tăng',
  down: 'giảm',
  flat: 'không đổi',
};

function series(id: string, label: string, ys: number[], start = 1): Series {
  return {
    id,
    label,
    points: ys.map((y, index) => ({ x: `2026-09-${String(start + index).padStart(2, '0')}`, y })),
  };
}
const one: Comparison = {
  current: [series('paid', 'Hóa đơn đã thanh toán', [1_200_000, 900_000, 1_500_000, 700_000])],
};
const two: Comparison = {
  current: [
    series('paid', 'Hóa đơn đã thanh toán', [1_200_000, 900_000, 1_500_000]),
    series('visits', 'Lượt khách', [4, 6, 5]),
  ],
};

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
const key = (target: Element, name: string) =>
  act(() => {
    target.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
    );
  });
const click = (element: Element | null | undefined) => {
  assert.ok(element, 'element exists');
  act(() => (element as HTMLElement).click());
};
const byText = (container: Element, selector: string, text: string) =>
  [...container.querySelectorAll(selector)].find((node) => node.textContent?.includes(text)) as
    HTMLElement | undefined;

// ---- LineChart -----------------------------------------------------------------------------

test('line chart: a single series has no legend box; the plot is a named, focusable group with a hint', () => {
  const html = renderToStaticMarkup(
    <LineChart title="Hóa đơn 7 ngày" data={one} format={format} labels={labels} />,
  );
  assert.doesNotMatch(html, /ls-chart-legend/);
  assert.match(html, /role="group"/);
  assert.match(html, /aria-label="Hóa đơn 7 ngày\. Dùng phím mũi tên/);
  assert.match(html, /tabindex="0"/);
  assert.match(
    html,
    /<svg[^>]*aria-hidden="true"/,
    'the drawing is hidden from assistive technology; the table twin carries the data',
  );
  assert.match(html, /ls-chart-line ls-chart-s1/);
});

test('line chart: two or more series always show a legend with names in text, not color only', () => {
  const html = renderToStaticMarkup(
    <LineChart title="t" data={two} format={format} labels={labels} />,
  );
  assert.match(html, /ls-chart-legend/);
  assert.match(html, /Hóa đơn đã thanh toán/);
  assert.match(html, /Lượt khách/);
  assert.match(html, /ls-chart-s2/, 'the second series uses slot 2');
});

test('line chart with a previous period draws it dashed and adds it to the legend', () => {
  const html = renderToStaticMarkup(
    <LineChart
      title="t"
      data={{ ...one, previous: [series('paid', 'Hóa đơn đã thanh toán', [1, 2, 3, 4], 20)] }}
      format={format}
      labels={labels}
    />,
  );
  assert.match(html, /ls-chart-line-previous/);
  assert.match(html, /ls-chart-swatch-previous/);
  assert.match(html, /Kỳ trước/);
});

test('line chart: every chart has "Show as table"; the table is a real table with a caption and row headers', () => {
  const view = mount(
    <LineChart title="Hóa đơn 7 ngày" data={two} format={format} labels={labels} />,
  );
  assert.equal(view.container.querySelector('table'), null);
  click(byText(view.container, 'button', 'Xem dạng bảng'));
  const table = view.container.querySelector('table')!;
  assert.ok(table);
  assert.equal(table.querySelector('caption')?.textContent, 'Hóa đơn 7 ngày');
  assert.deepEqual(
    [...table.querySelectorAll('thead th')].map((node) => node.textContent),
    ['Ngày', 'Hóa đơn đã thanh toán', 'Lượt khách'],
  );
  assert.equal(table.querySelectorAll('tbody tr').length, 3);
  assert.equal(table.querySelector('tbody tr th')?.getAttribute('scope'), 'row');
  assert.equal(plain(table.querySelector('tbody tr td')?.textContent), '1.200.000 ₫');
  assert.equal(
    view.container.querySelector('svg.ls-chart-svg'),
    null,
    'the chart is replaced by its table',
  );
  assert.equal(
    byText(view.container, 'button', 'Xem dạng biểu đồ')?.getAttribute('aria-pressed'),
    'true',
  );
  click(byText(view.container, 'button', 'Xem dạng biểu đồ'));
  assert.ok(view.container.querySelector('svg.ls-chart-svg'));
  view.unmount();
});

// A controllable layout: the plot's clientWidth is `layout.width` and every ResizeObserver can be fired by hand.
const layout = { width: 1000 };
const observed: { element: Element; callback: (entries: unknown[]) => void; live: boolean }[] = [];
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return this.classList.contains('ls-chart-plot') ? layout.width : 0;
  },
});
(globalThis as Record<string, unknown>).ResizeObserver = class {
  private watchers: typeof observed = [];
  constructor(private readonly callback: (entries: unknown[]) => void) {}
  observe(element: Element) {
    const watcher = { element, callback: this.callback, live: true };
    this.watchers.push(watcher);
    observed.push(watcher);
  }
  disconnect() {
    for (const watcher of this.watchers) watcher.live = false;
  }
};
const resizeLive = (width: number) =>
  act(() => {
    for (const watcher of observed.filter((item) => item.live)) {
      watcher.callback([{ contentRect: { width } }]);
    }
  });
const svgWidth = (container: Element) =>
  Number(container.querySelector('svg.ls-chart-svg')?.getAttribute('width'));

for (const [name, Chart] of [
  ['line', LineChart],
  ['bar', BarChart],
] as const) {
  test(`${name} chart: back from the table the plot is re-measured to the container width, and follows a resize`, () => {
    layout.width = 1000;
    const view = mount(<Chart title="t" data={two} format={format} labels={labels} />);
    assert.equal(svgWidth(view.container), 1000);
    click(byText(view.container, 'button', 'Xem dạng bảng'));
    layout.width = 1240; // the card is wider by the time the chart is shown again
    click(byText(view.container, 'button', 'Xem dạng biểu đồ'));
    assert.equal(svgWidth(view.container), 1240, 'measured again, not the stale or fallback width');
    resizeLive(480);
    assert.equal(svgWidth(view.container), 480, 'the new plot element is the one observed');
    assert.equal(observed.filter((item) => item.live).length, 1, 'no observer on a detached plot');
    view.unmount();
    layout.width = 0; // later tests run unmeasured, on the fallback width
  });
}

test('line chart: arrow keys walk the points, show the tooltip and announce the values; Escape clears', () => {
  const view = mount(<LineChart title="t" data={one} format={format} labels={labels} />);
  const plot = view.container.querySelector('.ls-chart-plot')!;
  assert.equal(view.container.querySelector('.ls-chart-tooltip'), null);
  key(plot, 'ArrowRight');
  assert.match(
    plain(view.container.querySelector('.ls-chart-tooltip')?.textContent),
    /1\.200\.000 ₫/,
  );
  assert.match(
    plain(view.container.querySelector('[aria-live="polite"]')?.textContent),
    /1 tháng 9, 2026: Hóa đơn đã thanh toán 1\.200\.000 ₫/,
  );
  key(plot, 'ArrowRight');
  assert.match(plain(view.container.querySelector('.ls-chart-tooltip')?.textContent), /900\.000 ₫/);
  key(plot, 'End');
  assert.match(plain(view.container.querySelector('.ls-chart-tooltip')?.textContent), /700\.000 ₫/);
  assert.ok(view.container.querySelector('.ls-chart-crosshair'));
  key(plot, 'Escape');
  assert.equal(view.container.querySelector('.ls-chart-tooltip'), null);
  view.unmount();
});

test('line chart: the tooltip shows both values and the change against the previous period', () => {
  const view = mount(
    <LineChart
      title="t"
      data={{
        current: one.current,
        previous: [
          series('paid', 'Hóa đơn đã thanh toán', [1_000_000, 900_000, 1_500_000, 1_000_000], 1),
        ],
      }}
      format={format}
      labels={labels}
    />,
  );
  key(view.container.querySelector('.ls-chart-plot')!, 'ArrowRight');
  const text = plain(view.container.querySelector('.ls-chart-tooltip')?.textContent);
  assert.match(text, /1\.200\.000 ₫/);
  assert.match(text, /1\.000\.000 ₫/);
  assert.match(text, /\+20,0% tăng/, 'signed percent with words, never color alone');
  view.unmount();
});

// ---- BarChart, DonutChart ------------------------------------------------------------------

test('bar chart: rounded data ends, texture overlay for forced colors, legend for stacked series', () => {
  const html = renderToStaticMarkup(
    <BarChart title="t" data={two} format={format} labels={labels} mode="stacked" />,
  );
  assert.match(html, /ls-chart-bar ls-chart-s1 ls-chart-bar-stacked/);
  assert.match(html, /class="ls-chart-texture"/);
  assert.match(html, /<pattern/);
  assert.match(html, /ls-chart-legend/);
  const horizontal = renderToStaticMarkup(
    <BarChart title="t" data={one} format={format} labels={labels} orientation="horizontal" />,
  );
  assert.match(horizontal, /ls-chart-bar/);
});

test('bar chart: keyboard and table twin work like the line chart', () => {
  const view = mount(<BarChart title="Theo ngày" data={two} format={format} labels={labels} />);
  key(view.container.querySelector('.ls-chart-plot')!, 'ArrowRight');
  assert.ok(view.container.querySelector('.ls-chart-band-active'));
  assert.match(plain(view.container.querySelector('.ls-chart-tooltip')?.textContent), /Lượt khách/);
  click(byText(view.container, 'button', 'Xem dạng bảng'));
  assert.equal(view.container.querySelectorAll('tbody tr').length, 3);
  view.unmount();
});

const donutLabels = {
  other: 'Khác',
  total: 'Tổng',
  showTable: 'Xem dạng bảng',
  showChart: 'Xem dạng biểu đồ',
  plotHint: 'Dùng phím mũi tên để chuyển giữa các phần.',
  nameHeader: 'Dịch vụ',
  valueHeader: 'Doanh thu',
  shareHeader: 'Tỷ lệ',
};

test('donut: legend with value and share, the total in the middle, at most 6 slices then Other', () => {
  const slices = Array.from({ length: 8 }, (_, index) => ({
    id: `s${index}`,
    label: `Dịch vụ ${index + 1}`,
    value: (index + 1) * 100_000,
  }));
  const html = renderToStaticMarkup(
    <DonutChart title="Theo dịch vụ" slices={slices} format={format} labels={donutLabels} />,
  );
  assert.equal((html.match(/ls-chart-legend-item/g) ?? []).length, 6);
  assert.match(html, /Khác/);
  assert.match(html, /ls-chart-sother/);
  assert.match(html, /Tổng/);
  assert.match(plain(html), /3\.600\.000 ₫/);
});

test('donut: arrows move between slices; the table lists share; a pie has no total', () => {
  const slices = [
    { id: 'a', label: 'Massage', value: 3 },
    { id: 'b', label: 'Gội đầu', value: 1 },
  ];
  const view = mount(
    <DonutChart
      title="t"
      slices={slices}
      format={{ valueFormat: 'count', locale: 'vi' }}
      labels={donutLabels}
    />,
  );
  key(view.container.querySelector('.ls-chart-plot')!, 'ArrowRight');
  assert.match(view.container.querySelector('.ls-chart-tooltip')?.textContent ?? '', /Massage/);
  assert.match(
    view.container.querySelector('[aria-live="polite"]')?.textContent ?? '',
    /Massage: 3, 75,0%/,
  );
  click(byText(view.container, 'button', 'Xem dạng bảng'));
  assert.deepEqual(
    [...view.container.querySelectorAll('tbody tr:first-child > *')].map(
      (node) => node.textContent,
    ),
    ['Massage', '3', '75,0%'],
  );
  view.unmount();
  const pie = renderToStaticMarkup(
    <DonutChart title="t" slices={slices} format={format} labels={donutLabels} innerRadius={0} />,
  );
  assert.doesNotMatch(pie, /ls-chart-center-value/);
});

// ---- KpiCard, Sparkline, ChartFrame --------------------------------------------------------

const kpiLabels = { up: 'tăng', down: 'giảm', flat: 'không đổi', comparedTo: 'so với kỳ trước' };

test('KPI card: value, change with an icon and words, sparkline, as-of time, info tooltip', () => {
  const html = renderToStaticMarkup(
    <KpiCard
      label="Hóa đơn đã thanh toán"
      value={1_200_000}
      format={format}
      previous={1_000_000}
      sparkline={[1, 3, 2, 4]}
      asOf="Lúc 14:05"
      info="Tổng các hóa đơn đã thanh toán, không phải doanh thu."
      labels={kpiLabels}
    />,
  );
  assert.match(plain(html), /1\.200\.000 ₫/);
  assert.match(html, /\+20,0% tăng/);
  assert.match(html, /so với kỳ trước/);
  assert.match(html, /data-tone="up"/, 'blue for up when the metric has no good direction');
  assert.match(html, /ls-sparkline/);
  assert.match(html, /Lúc 14:05/);
  assert.match(html, /aria-label="Tổng các hóa đơn/);
  assert.match(html, /<svg[^>]*aria-hidden="true"[^>]*>[^]*?<path/, 'the arrow icon is decorative');
});

test('KPI card: good/bad tone only when the screen says which direction is good; no base hides the change', () => {
  const good = renderToStaticMarkup(
    <KpiCard
      label="Chờ"
      value={5}
      format={{ valueFormat: 'count', locale: 'vi' }}
      previous={10}
      goodDirection="down"
      labels={kpiLabels}
    />,
  );
  assert.match(good, /data-tone="good"/);
  assert.match(good, /-50,0% giảm/);
  const bad = renderToStaticMarkup(
    <KpiCard
      label="Chờ"
      value={15}
      format={{ valueFormat: 'count', locale: 'vi' }}
      previous={10}
      goodDirection="down"
      labels={kpiLabels}
    />,
  );
  assert.match(bad, /data-tone="bad"/);
  const none = renderToStaticMarkup(
    <KpiCard
      label="Chờ"
      value={15}
      format={{ valueFormat: 'count', locale: 'vi' }}
      previous={0}
      labels={kpiLabels}
    />,
  );
  assert.doesNotMatch(none, /ls-kpi-delta/);
});

test('sparkline is decorative unless it has a label', () => {
  assert.match(renderToStaticMarkup(<Sparkline values={[1, 2, 3]} />), /aria-hidden="true"/);
  assert.match(
    renderToStaticMarkup(<Sparkline values={[1, 2, 3]} label="Xu hướng 7 ngày" />),
    /role="img" aria-label="Xu hướng 7 ngày"/,
  );
  assert.doesNotMatch(renderToStaticMarkup(<Sparkline values={[1]} />), /<path/);
});

test('chart frame: title, subtitle, actions, and loading / empty / error in the chart footprint', () => {
  const frameLabels = { loading: 'Đang tải biểu đồ', retry: 'Thử lại' };
  const ready = renderToStaticMarkup(
    <ChartFrame
      title="Hóa đơn"
      subtitle="7 ngày"
      actions={<button>Xuất</button>}
      labels={frameLabels}
    >
      <p>nội dung</p>
    </ChartFrame>,
  );
  assert.match(ready, /<h2 class="ls-chart-title">Hóa đơn<\/h2>/);
  assert.match(ready, /7 ngày/);
  assert.match(ready, /nội dung/);
  const loading = renderToStaticMarkup(
    <ChartFrame title="t" state="loading" labels={frameLabels} height={200}>
      <p>nội dung</p>
    </ChartFrame>,
  );
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /min-height:200px/, 'the card keeps its height while loading');
  assert.doesNotMatch(loading, /nội dung/);
  const empty = renderToStaticMarkup(
    <ChartFrame title="t" state="empty" emptyMessage="Chưa có hóa đơn." labels={frameLabels}>
      <p>nội dung</p>
    </ChartFrame>,
  );
  assert.match(empty, /Chưa có hóa đơn\./);
  const failed = renderToStaticMarkup(
    <ChartFrame
      title="t"
      state="error"
      errorMessage="Không tải được."
      errorReference="REQ-1"
      referenceLabel="Mã yêu cầu"
      onRetry={() => undefined}
      labels={frameLabels}
    >
      <p>nội dung</p>
    </ChartFrame>,
  );
  assert.match(failed, /Không tải được\./);
  assert.match(failed, /Mã yêu cầu: REQ-1/);
  assert.match(failed, /Thử lại/);
});

// ---- ComparisonToggle ----------------------------------------------------------------------

test('comparison toggle: None | Previous period | Same period last year, arrow keys change the mode', () => {
  const seen: string[] = [];
  function Harness() {
    const [mode, setMode] = useState<'none' | 'previous' | 'lastYear'>('none');
    return (
      <ComparisonToggle
        value={mode}
        onChange={(next) => {
          seen.push(next);
          setMode(next);
        }}
        labels={{
          label: 'So sánh với',
          none: 'Không',
          previous: 'Kỳ trước',
          lastYear: 'Cùng kỳ năm trước',
        }}
      />
    );
  }
  const view = mount(<Harness />);
  const group = view.container.querySelector('[role="radiogroup"]')!;
  assert.equal(group.getAttribute('aria-label'), 'So sánh với');
  assert.deepEqual(
    [...group.querySelectorAll('[role="radio"]')].map((node) => node.textContent),
    ['Không', 'Kỳ trước', 'Cùng kỳ năm trước'],
  );
  const first = group.querySelector('[role="radio"]')!;
  first.dispatchEvent(new window.FocusEvent('focus'));
  key(first, 'ArrowRight');
  assert.deepEqual(seen, ['previous']);
  view.unmount();
});

// ---- DateRangePicker -----------------------------------------------------------------------

const pickerLabels = {
  title: 'Khoảng ngày',
  placeholder: 'Chọn ngày',
  presets: {
    today: 'Hôm nay',
    yesterday: 'Hôm qua',
    last7: '7 ngày qua',
    last30: '30 ngày qua',
    thisMonth: 'Tháng này',
    lastMonth: 'Tháng trước',
  },
  custom: 'Tùy chọn',
  apply: 'Áp dụng',
  cancel: 'Hủy',
  close: 'Đóng',
  previousMonth: 'Tháng trước',
  nextMonth: 'Tháng sau',
  pickEnd: 'Chọn ngày cuối.',
  maxRange: 'Tối đa {days} ngày.',
};
const TODAY = '2026-09-30';

function pickerHarness(
  seen: { from: string; to: string }[],
  initial: { from: string; to: string } | null = { from: '2026-09-24', to: TODAY },
  extra: { maxDays?: number } = {},
) {
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <DateRangePicker
        value={value}
        today={TODAY}
        locale="vi"
        labels={pickerLabels}
        onChange={(range) => {
          seen.push(range);
          setValue(range);
        }}
        {...extra}
      />
    );
  }
  return <Harness />;
}
const day = (date: string) => window.document.querySelector(`[data-date="${date}"]`) as HTMLElement;

test('date range picker: the trigger shows the range; the popover has presets and two months of the branch calendar', () => {
  const view = mount(pickerHarness([]));
  const trigger = view.container.querySelector('button')!;
  assert.match(trigger.textContent ?? '', /24 thg 9, 2026 – 30 thg 9, 2026|24 Thg 9 2026/i);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  click(trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  const dialog = window.document.querySelector('[role="dialog"]')!;
  assert.equal(dialog.querySelectorAll('table[role="grid"]').length, 2);
  assert.deepEqual(
    [...dialog.querySelectorAll('.ls-daterange-presets .ls-btn')].map((node) => node.textContent),
    ['Hôm nay', 'Hôm qua', '7 ngày qua', '30 ngày qua', 'Tháng này', 'Tháng trước', 'Tùy chọn'],
  );
  assert.equal(
    byText(dialog, '.ls-daterange-presets .ls-btn', '7 ngày qua')?.getAttribute('aria-pressed'),
    'true',
    'the active preset is marked',
  );
  assert.equal(day(TODAY).getAttribute('aria-current'), 'date');
  assert.equal(day(TODAY).getAttribute('data-today'), 'true');
  assert.match(day('2026-09-30').getAttribute('aria-label') ?? '', /Thứ Tư/);
  view.unmount();
});

test('date range picker: a preset applies at once and closes; Escape closes without changing', () => {
  const seen: { from: string; to: string }[] = [];
  const view = mount(pickerHarness(seen));
  const trigger = view.container.querySelector('button')!;
  click(trigger);
  click(byText(window.document.body, '.ls-daterange-presets .ls-btn', 'Hôm qua'));
  assert.deepEqual(seen, [{ from: '2026-09-29', to: '2026-09-29' }]);
  assert.equal(window.document.querySelector('[role="dialog"]'), null);
  click(trigger);
  act(() => {
    window.document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  });
  assert.equal(window.document.querySelector('[role="dialog"]'), null);
  assert.equal(seen.length, 1);
  view.unmount();
});

test('date range picker: a custom range is two picks plus Apply; the end can come before the start', () => {
  const seen: { from: string; to: string }[] = [];
  const view = mount(pickerHarness(seen, null));
  assert.match(view.container.querySelector('button')?.textContent ?? '', /Chọn ngày/);
  click(view.container.querySelector('button'));
  const apply = () =>
    byText(window.document.body, '.ls-daterange-buttons .ls-btn', 'Áp dụng') as HTMLButtonElement;
  assert.equal(apply().disabled, true, 'nothing to apply yet');
  click(day('2026-09-20'));
  assert.match(
    window.document.querySelector('.ls-daterange-summary')?.textContent ?? '',
    /Chọn ngày cuối/,
  );
  assert.equal(apply().disabled, true);
  click(day('2026-09-10'));
  assert.equal(apply().disabled, false);
  assert.equal(
    window.document.querySelectorAll('.ls-calendar-in-range').length,
    11,
    '10..20 September are in the range',
  );
  click(apply());
  assert.deepEqual(seen, [{ from: '2026-09-10', to: '2026-09-20' }]);
  view.unmount();
});

test('date range picker: days beyond the maximum length cannot be picked', () => {
  const view = mount(pickerHarness([], null, { maxDays: 7 }));
  click(view.container.querySelector('button'));
  assert.match(
    window.document.querySelector('.ls-daterange-summary')?.textContent ?? '',
    /Tối đa 7 ngày/,
  );
  click(day('2026-09-10'));
  assert.equal(day('2026-09-16').getAttribute('aria-disabled'), null, '7 days including the first');
  assert.equal(day('2026-09-17').getAttribute('aria-disabled'), 'true');
  assert.equal(day('2026-09-04').getAttribute('aria-disabled'), null);
  assert.equal(day('2026-09-03').getAttribute('aria-disabled'), 'true');
  click(day('2026-09-17'));
  assert.match(
    window.document.querySelector('.ls-daterange-summary')?.textContent ?? '',
    /Chọn ngày cuối/,
    'a blocked day does nothing',
  );
  view.unmount();
});

test('date range picker: the calendar is a grid with one tab stop and arrow-key navigation', () => {
  const view = mount(pickerHarness([]));
  click(view.container.querySelector('button'));
  const stops = [...window.document.querySelectorAll('.ls-calendar-day')].filter(
    (node) => node.getAttribute('tabindex') === '0',
  );
  assert.equal(stops.length, 1, 'roving tabindex');
  assert.equal(stops[0]!.getAttribute('data-date'), TODAY);
  key(day(TODAY), 'ArrowLeft');
  assert.equal(
    window.document.querySelector('[tabindex="0"].ls-calendar-day')?.getAttribute('data-date'),
    '2026-09-29',
  );
  key(day('2026-09-29'), 'ArrowUp');
  assert.equal(
    window.document.querySelector('[tabindex="0"].ls-calendar-day')?.getAttribute('data-date'),
    '2026-09-22',
  );
  key(day('2026-09-22'), 'PageDown');
  assert.equal(
    window.document.querySelector('[tabindex="0"].ls-calendar-day')?.getAttribute('data-date'),
    '2026-10-22',
  );
  view.unmount();
});

test('date range picker: on a phone it is a full-height sheet with one month', () => {
  dom.setPhone(true);
  const view = mount(pickerHarness([]));
  click(view.container.querySelector('button'));
  const sheet = window.document.querySelector('.ls-daterange-sheet')!;
  assert.ok(sheet, 'drawer sheet');
  assert.equal(sheet.querySelectorAll('table[role="grid"]').length, 1);
  assert.equal(sheet.getAttribute('aria-modal'), 'true');
  view.unmount();
  dom.setPhone(false);
});
