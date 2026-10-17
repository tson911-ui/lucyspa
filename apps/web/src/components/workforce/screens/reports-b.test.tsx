import type {
  BookingFunnelReport,
  CustomerVisitsReport,
  ExpiryReport,
  LoyaltyReport,
  LowStockReport,
  OnlineOrderReport,
  ProductRevenueReport,
  ReportRegistryResponse,
  ServiceRevenueReport,
  SlowMoverReport,
  StaffActivityReport,
  StockMovementReport,
  StockReceiptReport,
  StockValueReport,
  TopCustomersReport,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportsBDictionary } from '../../../i18n/reports-b';
import { owner, render } from '../../../test/support';
import { BookingsBody, customersTabs, LoyaltyBody, TopBody, VisitsBody } from './reports-customers';
import { ReportView } from './reports-kit';
import { OnlineBody, ProductsBody, salesTabs, ServicesBody } from './reports-sales';
import { StaffBody } from './reports-staff';
import {
  ExpiryBody,
  LowBody,
  MovementsBody,
  ReceiptsBody,
  SlowBody,
  stockTabs,
  ValueBody,
} from './reports-stock';
import { reportsDictionary } from '../../../i18n/reports';

const b = reportsBDictionary('vi');
const w = reportsDictionary('vi');
const branchA = { id: 'a', code: 'A', name: 'Nguyễn Quang Bích' };
const branchB = { id: 'b', code: 'B', name: 'Quận 1' };
const at = '2026-10-12T03:00:00.000Z';
const period = { from: '2026-10-01', to: '2026-10-12', previous: null };

const registry = (ids: string[], patch: { exportable?: boolean } = {}): ReportRegistryResponse => ({
  generatedAt: at,
  branches: [branchA, branchB],
  reports: ids.map((id) => ({
    id,
    area: 'revenue',
    wave: 'B',
    available: true,
    exportable: patch.exportable ?? true,
    exportReauth: id === 'staff-activity',
    branchIds: ['a', 'b'],
  })),
});

const buttons = (html: string, cls: string) =>
  html.match(new RegExp(`ls-btn-${cls}`, 'g'))?.length ?? 0;

test('Sales page: one h1, one primary action, the five tabs; a single available report shows no tab bar', () => {
  const all = render(
    <ReportView
      title={b.sales.title}
      intro={b.sales.intro}
      tabs={salesTabs(b)}
      registry={registry([
        'revenue-by-service',
        'revenue-by-product',
        'combos',
        'discounts-campaigns',
        'online-orders',
      ])}
    />,
    owner,
  );
  assert.match(all, /<h1[^>]*>Chi tiết bán hàng<\/h1>/);
  assert.equal(buttons(all, 'primary'), 1);
  assert.match(all, /role="search"/);
  for (const label of Object.values(b.sales.tabs)) assert.match(all, new RegExp(label));
  const single = render(
    <ReportView
      title={b.sales.title}
      intro={b.sales.intro}
      tabs={salesTabs(b)}
      registry={registry(['combos'])}
    />,
    owner,
  );
  assert.doesNotMatch(single, /role="tablist"/);
  const readOnly = render(
    <ReportView
      title={b.sales.title}
      intro={b.sales.intro}
      tabs={salesTabs(b)}
      registry={registry(['combos'], { exportable: false })}
    />,
    owner,
  );
  assert.equal(buttons(readOnly, 'primary'), 0);
});

test('a person who may read none of the reports gets the explanation, not an empty page of tabs', () => {
  const none = render(
    <ReportView
      title={b.stock.title}
      intro={b.stock.intro}
      tabs={stockTabs(b)}
      registry={{ ...registry([]), reports: [] }}
    />,
    owner,
  );
  assert.match(none, new RegExp(w.revenue.emptyBranches));
  assert.doesNotMatch(none, /role="tablist"/);
});

test('Customers page lists its four tabs and carries no number in a heading', () => {
  const html = render(
    <ReportView
      title={b.customers.title}
      intro={b.customers.intro}
      tabs={customersTabs(b, w)}
      registry={registry(['customers-visits', 'bookings-funnel', 'loyalty', 'top-customers'])}
    />,
    owner,
  );
  for (const label of Object.values(b.customers.tabs)) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /<h[1-3][^>]*>[^<]*[0-9][^<]*<\/h[1-3]>/);
});

const services: ServiceRevenueReport = {
  generatedAt: at,
  period,
  branches: [branchA],
  truncated: false,
  rows: [
    {
      serviceId: 's1',
      code: 'MASSAGE',
      nameVi: 'Massage thư giãn',
      nameEn: 'Relaxing massage',
      categoryNameVi: 'Massage',
      categoryNameEn: 'Massage',
      quantity: 4,
      netVnd: '800000',
      shareBp: 8000,
    },
    {
      serviceId: null,
      code: null,
      nameVi: '',
      nameEn: '',
      categoryNameVi: null,
      categoryNameEn: null,
      quantity: 1,
      netVnd: '200000',
      shareBp: 2000,
    },
  ],
  totals: { netVnd: '1000000', quantity: 5 },
};

test('services: the total, each service with its share, and the row of money no service could be named for', () => {
  const html = render(<ServicesBody data={services} />, owner);
  assert.match(html, /1\.000\.000/);
  assert.match(html, /Massage thư giãn/);
  // Shares through Intl with one decimal everywhere (session 10: "77%" and "12,7%" no longer mix in one column).
  assert.match(html, /80,0%/);
  assert.match(html, new RegExp(`>${b.sales.other}<`));
  const cut = render(<ServicesBody data={{ ...services, truncated: true }} />, owner);
  // The row limit is grouped like every other count (Intl): "5.000".
  assert.match(cut, /Chỉ hiện 5\.000 dòng đầu/);
});

test('products: the SKU, brand and group columns only when viewed by item', () => {
  const row = {
    key: 'v1',
    sku: 'KEM-01',
    nameVi: 'Kem dưỡng',
    nameEn: 'Cream',
    brandNameVi: 'Lucy',
    brandNameEn: 'Lucy',
    categoryNameVi: 'Dưỡng da',
    categoryNameEn: 'Skin care',
    unitsSold: 3,
    unitsRefunded: 1,
    netVnd: '200000',
    shareBp: 10000,
  };
  const data = (by: ProductRevenueReport['by']): ProductRevenueReport => ({
    generatedAt: at,
    period,
    branches: [branchA],
    truncated: false,
    by,
    rows: [row],
    totals: { netVnd: '200000', unitsSold: 3, unitsRefunded: 1 },
  });
  const item = render(<ProductsBody data={data('variant')} />, owner);
  assert.match(item, /KEM-01/);
  assert.match(item, new RegExp(b.col['brand']!));
  const brand = render(<ProductsBody data={data('brand')} />, owner);
  assert.doesNotMatch(brand, /KEM-01/);
  assert.doesNotMatch(brand, new RegExp(`>${b.col['sku']!}<`));
});

test('online orders: the state in words, the phone in full, money held and the staff code', () => {
  const data: OnlineOrderReport = {
    generatedAt: at,
    period,
    branches: [branchA],
    summary: {
      orders: 3,
      delivered: 1,
      awaitingDelivery: 1,
      cancelled: 1,
      heldVnd: '450000',
      collectedVnd: '900000',
      refundedVnd: '0',
      failedDeliveryRefundsVnd: '0',
      staffCodeOrders: 1,
      staffCodeCollectedVnd: '450000',
    },
    page: 1,
    pageSize: 20,
    total: 1,
    rows: [
      {
        orderCode: 'ON-1',
        invoiceCode: 'INV-1',
        branch: branchA,
        date: '2026-10-11',
        state: 'AWAITING_DELIVERY',
        contactName: 'Chị Hoa',
        contactPhone: '+84901234567',
        totalVnd: '450000',
        collectedVnd: '450000',
        refundedVnd: '0',
        deliveredOn: null,
        staffCode: 'KTV234',
      },
    ],
  };
  const html = render(<OnlineBody data={data} page={1} onPage={() => undefined} />, owner);
  assert.match(html, /Chờ giao/);
  assert.match(html, /\+84901234567/);
  assert.match(html, /450\.000/);
  assert.match(html, new RegExp(b.sales.kpi.held));
});

test('visits: the figures, and the unidentified note only when there are such customers', () => {
  const data = (unidentified: number): CustomerVisitsReport => ({
    generatedAt: at,
    period,
    branches: [branchA, branchB],
    bucket: 'day',
    series: [{ start: '2026-10-12', visits: 4, people: 3, newPeople: 1, returningPeople: 2 }],
    totals: {
      visits: 4,
      bookedVisits: 1,
      walkInVisits: 3,
      people: 3,
      newPeople: 1,
      returningPeople: 2,
      unidentified,
    },
    byBranch: [
      { branch: branchA, visits: 3, people: 2 },
      { branch: branchB, visits: 1, people: 1 },
    ],
  });
  const none = render(<VisitsBody data={data(0)} />, owner);
  assert.match(none, new RegExp(b.customers.kpi.newPeople));
  assert.doesNotMatch(none, new RegExp(b.customers.kpi.unidentified));
  assert.match(none, new RegExp(b.customers.byBranch));
  const some = render(<VisitsBody data={data(2)} />, owner);
  assert.match(some, new RegExp(b.customers.kpi.unidentified));
});

test('bookings: rates as percents, and the channel table in words', () => {
  const data: BookingFunnelReport = {
    generatedAt: at,
    period,
    branches: [branchA],
    bucket: 'day',
    series: [
      {
        start: '2026-10-12',
        bookings: 6,
        checkedIn: 2,
        cancelled: 2,
        lateCancelled: 1,
        noShow: 1,
        open: 1,
      },
    ],
    totals: { bookings: 6, checkedIn: 2, cancelled: 2, lateCancelled: 1, noShow: 1, open: 1 },
    cameBp: 5000,
    noShowBp: 2500,
    byChannel: [
      { channel: 'ONLINE', bookings: 3, checkedIn: 1, cancelled: 1, noShow: 0 },
      { channel: 'DESK', bookings: 3, checkedIn: 1, cancelled: 1, noShow: 1 },
    ],
  };
  const html = render(<BookingsBody data={data} />, owner);
  assert.match(html, /50,0%/);
  assert.match(html, /25,0%/);
  assert.match(html, /Theo ngày/);
  assert.match(html, /Đặt online/);
  assert.match(html, /Tại quầy/);
});

test('loyalty: points by kind in the loyalty words, tiers, and the note about points that belong to no branch', () => {
  const data = (includesBranchless: boolean): LoyaltyReport => ({
    generatedAt: at,
    period,
    branches: [branchA],
    points: [
      { wallet: 'SPA', kind: 'EARN', points: 200, entries: 1 },
      { wallet: 'BEAUTY', kind: 'MANUAL_ADJUSTMENT', points: 600, entries: 1 },
    ],
    tiers: [
      { tier: 'NONE', spa: 5, beauty: 7 },
      { tier: 'SILVER', spa: 1, beauty: 1 },
    ],
    outstanding: { spa: 1400, beauty: 600 },
    referrals: { bound: 1, rewarded: 0 },
    rewardRedemptions: 2,
    birthday: { redeemed: 1, amountVnd: '50000' },
    includesBranchless,
  });
  const html = render(<LoyaltyBody data={data(false)} />, owner);
  assert.match(html, /Tích điểm từ hóa đơn/);
  assert.match(html, /Điều chỉnh thủ công/);
  assert.match(html, /Điểm Lucy Spa/);
  assert.match(html, /Chưa có hạng/);
  assert.match(html, new RegExp(b.customers.branchless.slice(0, 22)));
  assert.doesNotMatch(
    render(<LoyaltyBody data={data(true)} />, owner),
    new RegExp(b.customers.branchless.slice(0, 22)),
  );
});

test('top customers: the phone number in full and the limit in the note', () => {
  const data: TopCustomersReport = {
    generatedAt: at,
    period,
    branches: [branchA],
    limit: 50,
    rows: [
      {
        userId: 'u1',
        name: 'Chị Lan',
        phone: '+84907654321',
        invoices: 2,
        collectedVnd: '300000',
        visits: 1,
      },
    ],
  };
  const html = render(<TopBody data={data} />, owner);
  assert.match(html, /\+84907654321/);
  assert.match(html, /Tối đa 50 khách/);
});

const staffRow = {
  userId: 'e1',
  name: 'Thu Hà',
  employeeCode: 'NV01',
  servicesPerformed: 6,
  customersServed: 5,
  actualMinutes: 450,
  plannedMinutes: 420,
  serviceSalesVnd: '1200000',
  productSalesVnd: '300000',
  referralOrders: 1,
  referralInvoiceVnd: '150000',
  tipsVnd: '20000',
  tourVnd: '30000',
  commissionVnd: '5000',
  attendanceDays: 1,
  attendanceMinutes: 480,
  leaveDays: 0,
};

test('staff: the sales and pay columns follow the permissions the API reported, and nobody is ranked', () => {
  const data = (sales: boolean, pay: boolean): StaffActivityReport => ({
    generatedAt: at,
    period,
    branches: [branchA],
    columns: { sales, pay },
    rows: [staffRow],
  });
  const full = render(<StaffBody data={data(true, true)} />, owner);
  assert.match(full, new RegExp(b.col['serviceSales']!));
  assert.match(full, new RegExp(`>${b.col['tips']!}<`));
  assert.match(full, /7 giờ 30 phút/);
  assert.match(full, /1\.200\.000/);
  const work = render(<StaffBody data={data(false, false)} />, owner);
  assert.doesNotMatch(work, new RegExp(b.col['serviceSales']!));
  assert.doesNotMatch(work, new RegExp(`>${b.col['tips']!}<`));
  assert.match(work, /Thu Hà/);
  assert.doesNotMatch(work, /ls-th-sort/);
});

const item = {
  variantId: 'v1',
  sku: 'KEM-01',
  nameVi: 'Kem dưỡng',
  nameEn: 'Cream',
};

test('low stock and slow movers: the figures, "never sold" in words, and no cost column without the permission', () => {
  const low: LowStockReport = {
    generatedAt: at,
    branches: [branchA],
    truncated: false,
    rows: [{ ...item, branch: branchA, onHand: 4, reserved: 1, available: 3, threshold: 5 }],
  };
  const lowHtml = render(<LowBody data={low} />, owner);
  assert.match(lowHtml, /KEM-01/);
  assert.match(lowHtml, new RegExp(b.col['threshold']!));
  const slow = (costColumn: boolean): SlowMoverReport => ({
    generatedAt: at,
    branches: [branchA],
    truncated: false,
    days: 60,
    costColumn,
    rows: [
      {
        ...item,
        branch: branchA,
        onHand: 5,
        lastSoldOn: null,
        daysSinceSale: null,
        costValueVnd: costColumn ? '50000' : null,
      },
      {
        ...item,
        variantId: 'v2',
        sku: 'MN-02',
        branch: branchA,
        onHand: 8,
        lastSoldOn: '2026-07-04',
        daysSinceSale: 100,
        costValueVnd: null,
      },
    ],
  });
  const withCost = render(<SlowBody data={slow(true)} />, owner);
  assert.match(withCost, new RegExp(b.stock.neverSold));
  assert.match(withCost, new RegExp(b.col['costValue']!));
  assert.match(withCost, /50\.000/);
  assert.match(withCost, new RegExp(b.stock.noCost));
  const without = render(<SlowBody data={slow(false)} />, owner);
  assert.doesNotMatch(without, new RegExp(b.col['costValue']!));
  assert.match(without, new RegExp(b.stock.noCostColumn));
});

test('expiry: an expired lot says so in words, a lot to come shows the days left', () => {
  const data: ExpiryReport = {
    generatedAt: at,
    branches: [branchA],
    truncated: false,
    days: 60,
    rows: [
      {
        ...item,
        branch: branchA,
        lotCode: 'L1',
        expiryDate: '2026-10-07',
        daysLeft: -5,
        quantity: 4,
      },
      {
        ...item,
        variantId: 'v2',
        sku: 'TN-02',
        branch: branchA,
        lotCode: 'L2',
        expiryDate: '2026-11-11',
        daysLeft: 30,
        quantity: 5,
      },
    ],
  };
  const html = render(<ExpiryBody data={data} />, owner);
  assert.match(html, new RegExp(b.stock.expired));
  assert.match(html, /L2/);
  assert.match(html, />30</);
});

test('stock value: the total at cost, the share of stock that has a cost, and the items missing one', () => {
  const data: StockValueReport = {
    generatedAt: at,
    branches: [branchA],
    truncated: false,
    rows: [{ ...item, branch: branchA, onHand: 18, unitsWithCost: 18, valueVnd: '720000' }],
    totals: {
      onHand: 35,
      unitsWithCost: 23,
      valueVnd: '770000',
      coverageBp: 6571,
      variantsWithoutCost: 2,
    },
  };
  const html = render(<ValueBody data={data} />, owner);
  assert.match(html, /770\.000/);
  assert.match(html, /65,7%/);
  assert.match(html, new RegExp(b.stock.kpi.coverage));
  assert.match(html, /720\.000/);
});

test('movements and receipts: kinds in the inventory words, a receipt with no supplier says so', () => {
  const movements: StockMovementReport = {
    generatedAt: at,
    branches: [branchA],
    truncated: false,
    period,
    rows: [
      { branch: branchA, kind: 'RECEIPT', reason: null, entries: 4, unitsIn: 39, unitsOut: 0 },
      {
        branch: branchA,
        kind: 'ADJUSTMENT',
        reason: 'DAMAGED',
        entries: 1,
        unitsIn: 0,
        unitsOut: 2,
      },
    ],
  };
  const html = render(<MovementsBody data={movements} />, owner);
  assert.match(html, /Nhập kho/);
  assert.match(html, /Hư hỏng/);
  const receipts = (costColumn: boolean): StockReceiptReport => ({
    generatedAt: at,
    branches: [branchA],
    truncated: false,
    period,
    costColumn,
    rows: [
      {
        supplierId: 's1',
        supplierName: 'Nhà cung cấp A',
        receipts: 1,
        units: 5,
        costVnd: costColumn ? '50000' : null,
        linesWithoutCost: 0,
      },
      {
        supplierId: null,
        supplierName: null,
        receipts: 3,
        units: 34,
        costVnd: costColumn ? '0' : null,
        linesWithoutCost: 3,
      },
    ],
  });
  const costed = render(<ReceiptsBody data={receipts(true)} />, owner);
  assert.match(costed, /Nhà cung cấp A/);
  assert.match(costed, new RegExp(b.stock.noSupplier));
  assert.match(costed, new RegExp(b.col['receiptCost']!));
  const plain = render(<ReceiptsBody data={receipts(false)} />, owner);
  assert.doesNotMatch(plain, new RegExp(b.col['receiptCost']!));
  assert.match(plain, new RegExp(b.stock.noCostColumn));
});

test('English: the same pages in English', () => {
  const en = reportsBDictionary('en');
  const html = render(
    <ReportView
      title={en.stock.title}
      intro={en.stock.intro}
      tabs={stockTabs(en)}
      registry={registry(['stock-low', 'stock-best-sellers'])}
    />,
    owner,
    'en',
  );
  assert.match(html, /<h1[^>]*>Stock report<\/h1>/);
  assert.match(html, /Running low/);
  assert.match(html, /Export/);
});
