import type {
  InventoryContextResponse,
  InventoryItem,
  InventoryOverviewResponse,
  InventoryVariantDetailResponse,
  StockCountResponse,
  StockReceiptListResponse,
  StockReceiptResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inventoryDictionary } from '../../../i18n/inventory';
import { INVENTORY_LIST_DEFAULTS } from '../../../lib/workforce/inventory';
import { owner, render } from '../../../test/support';
import { InventoryView } from './inventory';
import { CountView } from './inventory-counts';
import { ReceiptsList, ReceiptView } from './inventory-receipts';
import { InventoryItemView, StockList } from './inventory-stock';

const text = inventoryDictionary('vi');
const noop = () => Promise.resolve();
const resource = <T,>(data: T) => ({ data, error: null, loading: false, reload: noop });
const list = { ...INVENTORY_LIST_DEFAULTS };
const update = () => undefined;

const item = (patch: Partial<InventoryItem> = {}): InventoryItem => ({
  variantId: 'v1',
  sku: 'KEM-50',
  productId: 'p1',
  productNameVi: 'Kem dưỡng ẩm',
  productNameEn: 'Moisturizer',
  labelVi: '50 ml',
  labelEn: '50 ml',
  coverMediaId: null,
  variantActive: true,
  onHand: 10,
  reserved: 0,
  available: 10,
  expiredQuantity: 0,
  lowStockThreshold: 3,
  lowStock: false,
  lotCount: 1,
  nextExpiry: null,
  expiryAlert: false,
  ...patch,
});

const stock = (items: InventoryItem[]) =>
  render(
    <StockList
      branchId="A"
      overview={resource<InventoryOverviewResponse>({
        branchId: 'A',
        expiryWarningDays: 90,
        items,
      })}
      branchControl={null}
      list={list}
      updateList={update}
    />,
    owner,
  );

test('the stock table shows the columns, a link to the item and a state in words for every row', () => {
  const markup = stock([
    item(),
    item({ variantId: 'v2', sku: 'SRM-30', productNameVi: 'Tinh chất', onHand: 2, lowStock: true }),
    item({
      variantId: 'v3',
      sku: 'MSK-1',
      productNameVi: 'Mặt nạ',
      onHand: 0,
      available: 0,
      lowStock: true,
    }),
    item({
      variantId: 'v4',
      sku: 'OLD-1',
      productNameVi: 'Toner',
      expiredQuantity: 2,
      expiryAlert: true,
      nextExpiry: '2026-09-01',
    }),
    item({
      variantId: 'v5',
      sku: 'TNR-1',
      productNameVi: 'Sữa rửa mặt',
      expiryAlert: true,
      nextExpiry: '2026-11-15',
    }),
  ]);
  for (const header of [
    text.stock.columns.product,
    text.stock.columns.sku,
    text.stock.columns.onHand,
    text.stock.columns.available,
    text.stock.columns.nextExpiry,
    text.stock.columns.status,
  ]) {
    assert.ok(markup.includes(header), header);
  }
  assert.ok(markup.includes('Kem dưỡng ẩm (50 ml)'));
  assert.ok(
    markup.includes('/vi/workforce/inventory/items/v1?branch=A'),
    'the item page keeps the branch',
  );
  for (const badge of [
    text.stock.badges.ok,
    text.stock.badges.low,
    text.stock.badges.out,
    text.stock.badges.expired,
    text.stock.badges.expiring,
  ]) {
    assert.ok(markup.includes(badge), badge);
  }
  assert.ok(markup.includes('15/11/2026'), 'the next expiry is a shop date');
  assert.ok(!/Giá nhập|giá vốn|unitCost/i.test(markup), 'the stock list never shows a cost');
  assert.equal(
    markup.match(/<h1/g)?.length ?? 0,
    0,
    'the page header belongs to the screen, not the list',
  );
});

test('an empty branch and a filter that matches nothing say different things', () => {
  assert.ok(stock([]).includes(text.stock.empty));
  const filtered = render(
    <StockList
      branchId="A"
      overview={resource<InventoryOverviewResponse>({
        branchId: 'A',
        expiryWarningDays: 90,
        items: [item()],
      })}
      branchControl={null}
      list={{ ...list, q: 'khong co gi' }}
      updateList={update}
    />,
    owner,
  );
  assert.ok(filtered.includes(text.stock.noMatch));
});

const receiptList = (withCost: boolean): StockReceiptListResponse => ({
  branchId: 'A',
  receipts: [
    {
      id: 'r1',
      code: 'PN000001',
      receiptDate: '2026-10-05',
      status: 'DRAFT',
      supplierName: 'NCC Hoa Sen',
      lineCount: 2,
      totalQuantity: 14,
      createdByName: 'Lan',
      createdAt: '2026-10-05T01:00:00.000Z',
      confirmedAt: null,
      ...(withCost ? { totalCostVnd: '1680000' } : {}),
    },
    {
      id: 'r2',
      code: 'PN000002',
      receiptDate: '2026-10-06',
      status: 'CONFIRMED',
      supplierName: null,
      lineCount: 1,
      totalQuantity: 3,
      createdByName: 'Lan',
      createdAt: '2026-10-06T01:00:00.000Z',
      confirmedAt: '2026-10-06T02:00:00.000Z',
      ...(withCost ? { totalCostVnd: '0' } : {}),
    },
  ],
});

test('the receipts table links each receipt and shows the cost column only when the API sent a cost', () => {
  const view = (withCost: boolean) =>
    render(
      <ReceiptsList
        receipts={resource(receiptList(withCost))}
        branchControl={null}
        list={list}
        updateList={update}
      />,
      owner,
    );
  const without = view(false);
  assert.ok(without.includes('/vi/workforce/inventory/receipts/r1'));
  assert.ok(without.includes(text.receipts.statuses.DRAFT));
  assert.ok(without.includes(text.receipts.statuses.CONFIRMED));
  assert.ok(without.includes(text.receipts.columns.quantity));
  assert.ok(!without.includes(text.receipts.columns.cost), 'no cost column without a cost');
  assert.ok(!without.includes('1.680.000'));
  const withCost = view(true);
  assert.ok(withCost.includes(text.receipts.columns.cost));
  assert.ok(withCost.includes('1.680.000'));
});

const receipt = (patch: Partial<StockReceiptResponse> = {}): StockReceiptResponse => ({
  id: 'r1',
  code: 'PN000001',
  branchId: 'A',
  branchName: 'Chi nhánh A',
  supplierId: 's1',
  supplierName: 'NCC Hoa Sen',
  receiptDate: '2026-10-05',
  notes: null,
  status: 'DRAFT',
  rowVersion: 2,
  createdByName: 'Lan',
  createdAt: '2026-10-05T01:00:00.000Z',
  confirmedByName: null,
  confirmedAt: null,
  cancelledByName: null,
  cancelledAt: null,
  cancelReason: null,
  cost: false,
  lines: [
    {
      lineNo: 1,
      variantId: 'v1',
      sku: 'KEM-50',
      productNameVi: 'Kem dưỡng ẩm',
      productNameEn: 'Moisturizer',
      labelVi: '50 ml',
      labelEn: '50 ml',
      quantity: 10,
      lotCode: 'LOT-1',
      expiryDate: '2027-01-31',
    },
  ],
  ...patch,
});

const view = (r: StockReceiptResponse) => render(<ReceiptView receipt={r} reload={noop} />, owner);

test('a draft receipt has the confirm action, edit and a cancel menu; the status is not in the heading', () => {
  const markup = view(receipt());
  assert.equal(markup.match(/<h1/g)?.length, 1);
  assert.ok(
    markup.includes(`ls-btn-label">${text.receipt.confirm}</span>`),
    'the one primary action',
  );
  assert.ok(markup.includes(`ls-btn-label">${text.receipt.edit}</span>`));
  assert.ok(markup.includes(text.receipt.moreActions), 'the menu that holds "Hủy phiếu"');
  assert.ok(markup.includes(text.receipt.draftHint));
  const heading = markup.slice(markup.indexOf('<h1'), markup.indexOf('</h1>'));
  assert.ok(!heading.includes(text.receipts.statuses.DRAFT));
  assert.ok(markup.includes(text.receipts.statuses.DRAFT), 'the status is in the information card');
  assert.ok(markup.includes('/vi/workforce/inventory'), 'breadcrumbs lead back');
  assert.ok(markup.includes('LOT-1') && markup.includes('31/01/2027'));
  assert.ok(!markup.includes('<details'));
});

test('a confirmed or cancelled receipt is read-only', () => {
  const confirmed = view(
    receipt({
      status: 'CONFIRMED',
      confirmedByName: 'Hà',
      confirmedAt: '2026-10-06T02:00:00.000Z',
    }),
  );
  const cancelled = view(
    receipt({
      status: 'CANCELLED',
      cancelledByName: 'Hà',
      cancelledAt: '2026-10-06T02:00:00.000Z',
      cancelReason: 'Nhập nhầm',
    }),
  );
  for (const markup of [confirmed, cancelled]) {
    assert.ok(!markup.includes(`ls-btn-label">${text.receipt.confirm}</span>`));
    assert.ok(!markup.includes(`ls-btn-label">${text.receipt.edit}</span>`));
    assert.ok(!markup.includes(text.receipt.moreActions));
    assert.ok(!markup.includes(text.receipt.draftHint));
  }
  assert.ok(confirmed.includes(text.receipts.statuses.CONFIRMED));
  assert.ok(cancelled.includes('Nhập nhầm'), 'the reason of a cancelled receipt is shown');
});

test('a receipt line shows a unit cost only when the API said the caller may see costs', () => {
  const costed = (cost: boolean) =>
    view(
      receipt({
        cost,
        lines: [{ ...receipt().lines[0]!, ...(cost ? { unitCostVnd: '120000' } : {}) }],
      }),
    );
  assert.ok(!costed(false).includes(text.receipt.lineColumns.cost));
  assert.ok(!costed(false).includes('120.000'));
  const withCost = costed(true);
  assert.ok(withCost.includes(text.receipt.lineColumns.cost));
  assert.ok(withCost.includes('120.000'));
});

const count = (patch: Partial<StockCountResponse> = {}): StockCountResponse => ({
  id: 'c1',
  code: 'KK000001',
  branchId: 'A',
  branchName: 'Chi nhánh A',
  status: 'OPEN',
  notes: 'Cuối tháng',
  rowVersion: 3,
  createdByName: 'Lan',
  createdAt: '2026-10-07T01:00:00.000Z',
  approvedByName: null,
  approvedAt: null,
  cancelledAt: null,
  canAdjust: true,
  lines: [
    {
      variantId: 'v1',
      sku: 'KEM-50',
      productNameVi: 'Kem dưỡng ẩm',
      productNameEn: 'Moisturizer',
      labelVi: '50 ml',
      labelEn: '50 ml',
      countedQuantity: 8,
      systemQuantity: null,
      difference: null,
      currentOnHand: 10,
    },
  ],
  ...patch,
});
const countView = (c: StockCountResponse) => render(<CountView count={c} reload={noop} />, owner);

test('an open count can be edited, approved and cancelled by someone who may adjust', () => {
  const markup = countView(count());
  assert.ok(markup.includes('aria-label="Số đếm của KEM-50"'), 'each counted box is labelled');
  assert.ok(markup.includes('value="8"'));
  assert.ok(markup.includes(`ls-btn-label">${text.count.approve}</span>`), 'the primary action');
  assert.ok(markup.includes(`ls-btn-label">${text.count.add}</span>`));
  assert.ok(markup.includes(`ls-btn-label">${text.count.save}</span>`));
  assert.ok(markup.includes(text.count.moreActions));
  assert.ok(
    markup.includes('-2'),
    'the difference is counted minus the live quantity, with its sign',
  );
  assert.equal(markup.match(/<h1/g)?.length, 1);
});

test('an approved, cancelled or view-only count has no inputs and no actions', () => {
  const approved = countView(
    count({
      status: 'APPROVED',
      approvedByName: 'Hà',
      approvedAt: '2026-10-07T03:00:00.000Z',
      lines: [{ ...count().lines[0]!, systemQuantity: 10, difference: -2, currentOnHand: null }],
    }),
  );
  const cancelled = countView(
    count({ status: 'CANCELLED', cancelledAt: '2026-10-07T03:00:00.000Z' }),
  );
  const viewOnly = countView(count({ canAdjust: false }));
  for (const markup of [approved, cancelled, viewOnly]) {
    assert.ok(!markup.includes('<input'), 'nothing to type');
    assert.ok(!markup.includes(`ls-btn-label">${text.count.approve}</span>`));
    assert.ok(!markup.includes(`ls-btn-label">${text.count.add}</span>`));
    assert.ok(!markup.includes(text.count.moreActions));
  }
  assert.ok(approved.includes('-2') && approved.includes(text.counts.statuses.APPROVED));
  assert.ok(approved.includes(text.count.closedHint));
  assert.ok(cancelled.includes(text.counts.statuses.CANCELLED));
});

const detail = (
  patch: Partial<InventoryVariantDetailResponse> = {},
): InventoryVariantDetailResponse => ({
  branchId: 'A',
  branchName: 'Chi nhánh A',
  item: item({ expiredQuantity: 2, expiryAlert: true, nextExpiry: '2026-09-01' }),
  expiryWarningDays: 90,
  canAdjust: true,
  lots: [
    {
      id: 'L1',
      lotCode: 'LOT-OLD',
      expiryDate: '2026-09-01',
      quantityOnHand: 2,
      receivedQuantity: 5,
      expired: true,
      receiptCode: 'PN000001',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
    {
      id: 'L2',
      lotCode: 'LOT-NEW',
      expiryDate: null,
      quantityOnHand: 8,
      receivedQuantity: 8,
      expired: false,
      receiptCode: null,
      createdAt: '2026-10-01T00:00:00.000Z',
    },
  ],
  movements: [
    {
      id: 'm1',
      kind: 'ADJUSTMENT',
      quantityDelta: -1,
      reason: 'DAMAGED',
      note: 'Vỡ',
      lotCode: 'LOT-OLD',
      actorName: 'Lan',
      createdAt: '2026-10-02T03:00:00.000Z',
      receiptCode: null,
      countCode: null,
    },
  ],
  ...patch,
});
const itemView = (d: InventoryVariantDetailResponse) =>
  render(<InventoryItemView detail={d} reload={noop} />, owner);

test('the item page: the adjustment is the one primary action; lots and history in their own sections', () => {
  const markup = itemView(detail());
  assert.equal(markup.match(/<h1/g)?.length, 1);
  assert.ok(markup.includes(`ls-btn-label">${text.item.adjust}</span>`));
  assert.ok(markup.includes(text.item.lots) && markup.includes(text.item.history));
  assert.ok(markup.includes('LOT-OLD') && markup.includes(text.item.expiredBadge));
  assert.ok(
    markup.includes(text.item.reasons.DAMAGED) && markup.includes(text.item.kinds.ADJUSTMENT),
  );
  assert.ok(markup.includes('-1'));
  assert.ok(!markup.includes(text.item.lotColumns.cost), 'no cost column without a cost');
  assert.ok(
    !itemView(detail({ canAdjust: false })).includes(`ls-btn-label">${text.item.adjust}</span>`),
  );
  const costed = itemView(
    detail({
      lots: [
        { ...detail().lots[0]!, unitCostVnd: '90000' },
        { ...detail().lots[1]!, unitCostVnd: null },
      ],
    }),
  );
  assert.ok(costed.includes(text.item.lotColumns.cost) && costed.includes('90.000'));
});

const context = (patch: Partial<InventoryContextResponse> = {}): InventoryContextResponse => ({
  branches: [
    { id: 'A', code: 'A', name: 'Chi nhánh A', view: true, receipts: false, adjust: false },
  ],
  manageProducts: false,
  cost: false,
  ...patch,
});

test('the inventory page offers only the tabs and actions the context allows', () => {
  const viewer = render(<InventoryView context={context()} />, owner);
  assert.equal(viewer.match(/<h1/g)?.length, 1);
  assert.ok(viewer.includes(text.tabs.stock) && viewer.includes(text.tabs.counts));
  assert.ok(!viewer.includes(text.tabs.receipts) && !viewer.includes(text.tabs.suppliers));
  assert.ok(
    !viewer.includes(`ls-btn-label">${text.settings}</span>`),
    'settings need MANAGE_PRODUCTS',
  );
  assert.ok(!viewer.includes(`ls-btn-label">${text.receipts.add}</span>`));

  const receiver = render(
    <InventoryView
      context={context({
        branches: [
          { id: 'A', code: 'A', name: 'Chi nhánh A', view: false, receipts: true, adjust: false },
        ],
      })}
    />,
    owner,
  );
  assert.ok(receiver.includes(text.tabs.receipts) && receiver.includes(text.tabs.suppliers));
  assert.ok(!receiver.includes(text.tabs.stock));
  assert.ok(
    receiver.includes(`ls-btn-label">${text.receipts.add}</span>`),
    'the primary action of the receipts tab',
  );

  const manager = render(
    <InventoryView context={context({ branches: [], manageProducts: true })} />,
    owner,
  );
  assert.ok(manager.includes(text.tabs.suppliers) && !manager.includes(text.tabs.stock));
  assert.ok(manager.includes(`ls-btn-label">${text.settings}</span>`));
  assert.ok(manager.includes(`ls-btn-label">${text.suppliers.add}</span>`));

  const nothing = render(<InventoryView context={context({ branches: [] })} />, owner);
  assert.ok(nothing.includes(text.noAccess));
});

test('with several branches the toolbar offers a branch chooser, with one it does not', () => {
  const two = render(
    <InventoryView
      context={context({
        branches: [
          { id: 'A', code: 'A', name: 'Chi nhánh A', view: true, receipts: false, adjust: false },
          { id: 'B', code: 'B', name: 'Chi nhánh B', view: true, receipts: false, adjust: false },
        ],
      })}
    />,
    owner,
  );
  assert.ok(two.includes(`aria-label="${text.branch}"`));
  assert.ok(two.includes('Chi nhánh B'));
  assert.ok(
    !render(<InventoryView context={context()} />, owner).includes(`aria-label="${text.branch}"`),
  );
});
