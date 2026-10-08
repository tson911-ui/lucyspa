import type {
  ProductReturnCaseResponse,
  ProductReturnContextResponse,
  ProductReturnListItem,
  ProductReturnListResponse,
  ProductReturnLookupResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productReturnsDictionary } from '../../../i18n/product-returns';
import { RETURN_LIST_DEFAULTS } from '../../../lib/workforce/product-returns';
import { owner, render } from '../../../test/support';
import {
  ProductReturnCaseView,
  ProductReturnForm,
  ProductReturnsList,
  ProductReturnsScreen,
} from './product-returns';

const text = productReturnsDictionary('vi');
const noop = () => Promise.resolve();
const resource = <T,>(data: T) => ({ data, error: null, loading: false, reload: noop });
const update = () => undefined;

const context = (patch: Partial<ProductReturnContextResponse['branches'][number]> = {}) =>
  ({
    owner: false,
    branches: [{ id: 'A', code: 'A', name: 'Chi nhánh A', manage: true, decide: false, ...patch }],
  }) satisfies ProductReturnContextResponse;

const row = (patch: Partial<ProductReturnListItem> = {}): ProductReturnListItem => ({
  id: 'c1',
  code: 'TH000001',
  invoiceCode: 'HD000042',
  sku: 'KEM-50',
  productNameVi: 'Kem dưỡng',
  productNameEn: 'Moisturizer',
  variantLabelVi: '50 ml',
  variantLabelEn: '50 ml',
  quantity: 2,
  reason: 'PERSONAL_PREFERENCE',
  requestedOutcome: 'EXCHANGE',
  status: 'OPEN',
  openedAt: '2026-10-08T05:00:00.000Z',
  openedByName: 'Lan',
  photoCount: 0,
  ...patch,
});

const page = (items: ProductReturnListItem[], total = items.length): ProductReturnListResponse => ({
  branchId: 'A',
  items,
  page: 1,
  pageSize: 20,
  total,
});

const list = (
  data: ProductReturnListResponse | null,
  ctx: ProductReturnContextResponse = context(),
  state = RETURN_LIST_DEFAULTS,
) =>
  render(
    <ProductReturnsList context={ctx} list={state} updateList={update} cases={resource(data)} />,
    owner,
  );

test('the list shows the columns, a link to each case, the words of each status, and one primary action', () => {
  const markup = list(
    page([
      row(),
      row({
        id: 'c2',
        code: 'TH000002',
        status: 'ACCEPTED',
        reason: 'WRONG_OR_DAMAGED',
        photoCount: 2,
      }),
      row({ id: 'c3', code: 'TH000003', status: 'DECLINED', reason: 'SKIN_IRRITATION' }),
      row({ id: 'c4', code: 'TH000004', status: 'CANCELLED', requestedOutcome: 'REFUND' }),
    ]),
  );
  for (const header of Object.values(text.list.columns)) assert.ok(markup.includes(header), header);
  assert.ok(markup.includes('/vi/workforce/product-returns/c1'), 'a link to the case');
  for (const status of Object.values(text.statuses)) assert.ok(markup.includes(status), status);
  assert.ok(markup.includes('Kem dưỡng · 50 ml'));
  assert.ok(markup.includes('HD000042'));
  assert.equal(markup.match(/<h1/g)?.length, 1, 'one h1');
  assert.equal(
    markup.match(new RegExp(`>${text.list.add}<`, 'g'))?.length,
    1,
    'one primary action',
  );
  assert.ok(!/class="[^"]*ls-btn-primary[^"]*"[^>]*>[^<]*<[^>]*>[^<]*Hủy/.test(markup));
});

test('the list pages 20 at a time and says how many there are', () => {
  const items = Array.from({ length: 20 }, (_, index) =>
    row({ id: `c${index}`, code: `TH${String(index + 1).padStart(6, '0')}` }),
  );
  const markup = list(page(items, 47));
  assert.ok(markup.includes('TH000020'));
  assert.ok(markup.includes('47'), 'the total shows in the pager');
  assert.match(markup, /1.{1,12}20/, 'the shown range');
});

test('an empty branch, a filter that matches nothing and a person with no access say different things', () => {
  assert.ok(list(page([])).includes(text.list.empty));
  assert.ok(
    list(page([]), context(), { ...RETURN_LIST_DEFAULTS, status: 'OPEN' }).includes(
      text.list.noMatch,
    ),
  );
  const nobody = list(null, { owner: false, branches: [] });
  assert.ok(nobody.includes(text.noAccess));
  assert.ok(!nobody.includes(text.list.add));
});

test('a person who only decides cannot open a case; the action needs the manage permission at the branch', () => {
  const decideOnly = list(page([row()]), context({ manage: false, decide: true }));
  assert.ok(!decideOnly.includes(`>${text.list.add}<`));
  assert.ok(decideOnly.includes('TH000001'));
  assert.ok(list(page([row()])).includes(`>${text.list.add}<`));
});

test('with more than one branch the list offers a branch choice, with one it does not', () => {
  const two: ProductReturnContextResponse = {
    owner: false,
    branches: [
      { id: 'A', code: 'A', name: 'Chi nhánh A', manage: true, decide: false },
      { id: 'B', code: 'B', name: 'Chi nhánh B', manage: true, decide: false },
    ],
  };
  assert.ok(list(page([row()]), two).includes('Chi nhánh B'));
  assert.ok(!list(page([row()])).includes('Chi nhánh B'));
});

test('the page shows its first paint (loading) before the context arrives', () => {
  const markup = render(<ProductReturnsScreen />, owner);
  assert.ok(markup.length > 0);
  assert.ok(!markup.includes(text.noAccess));
});

// ----------------------------------------------------------------------------------------------- the new case form

const found = (): ProductReturnLookupResponse => ({
  invoice: {
    id: 'i1',
    code: 'HD000042',
    paidAt: '2026-10-08T03:00:00.000Z',
    customerName: 'Nguyễn Lan',
  },
  lines: [
    {
      lineId: 'l1',
      sequence: 1,
      sku: 'KEM-50',
      productNameVi: 'Kem dưỡng',
      productNameEn: 'Moisturizer',
      variantLabelVi: '50 ml',
      variantLabelEn: '50 ml',
      quantity: 3,
      claimedQuantity: 1,
      availableQuantity: 2,
      reasons: {
        PERSONAL_PREFERENCE: { open: true, endsAt: '2026-10-15T03:00:00.000Z' },
        WRONG_OR_DAMAGED: { open: false, endsAt: '2026-10-10T03:00:00.000Z' },
        SKIN_IRRITATION: { open: true, endsAt: null },
      },
    },
    {
      lineId: 'l2',
      sequence: 2,
      sku: 'SRM-30',
      productNameVi: 'Tinh chất',
      productNameEn: 'Serum',
      variantLabelVi: null,
      variantLabelEn: null,
      quantity: 1,
      claimedQuantity: 1,
      availableQuantity: 0,
      reasons: {
        PERSONAL_PREFERENCE: { open: true, endsAt: '2026-10-15T03:00:00.000Z' },
        WRONG_OR_DAMAGED: { open: true, endsAt: '2026-10-10T03:00:00.000Z' },
        SKIN_IRRITATION: { open: true, endsAt: null },
      },
    },
  ],
});

test('the new-case page starts with the invoice only; nothing else is asked yet', () => {
  const markup = render(<ProductReturnForm context={context()} />, owner);
  assert.equal(markup.match(/<h1/g)?.length, 1);
  assert.ok(markup.includes(text.form.invoiceCode));
  assert.ok(markup.includes(text.form.find));
  assert.ok(!markup.includes(text.form.linesTitle));
  assert.ok(!markup.includes(`>${text.form.submit}<`), 'no submit before a product is chosen');
});

test('a person who may not open cases anywhere is told so instead of seeing a form', () => {
  const markup = render(
    <ProductReturnForm context={context({ manage: false, decide: true })} />,
    owner,
  );
  assert.ok(markup.includes(text.form.noBranch));
  assert.ok(!markup.includes(text.form.find));
});

test('after the lookup: the products with what is left, the reasons whose window is over disabled, the seal asked for a change of mind', () => {
  const markup = render(
    <ProductReturnForm
      context={context()}
      preset={{
        found: found(),
        draft: { invoiceCode: 'HD000042', lineId: 'l1', reason: 'PERSONAL_PREFERENCE' },
      }}
    />,
    owner,
  );
  assert.ok(markup.includes('HD000042'));
  assert.ok(markup.includes('Nguyễn Lan'));
  assert.ok(markup.includes('Kem dưỡng · 50 ml (KEM-50)'));
  assert.ok(markup.includes('Đã mua 3, còn trả được 2'));
  assert.ok(markup.includes('Đã mua 1, không còn gì để trả'), 'a fully claimed line says so');
  for (const reason of Object.values(text.reasons)) assert.ok(markup.includes(reason), reason);
  // The reason that is over is disabled and says when it closed (no override).
  const damaged = markup.slice(
    markup.indexOf(text.reasons.WRONG_OR_DAMAGED) - 400,
    markup.indexOf(text.reasons.WRONG_OR_DAMAGED),
  );
  assert.match(damaged, /disabled/);
  assert.ok(markup.includes('Đã hết hạn lúc'));
  assert.ok(markup.includes(text.form.seal));
  assert.ok(markup.includes(text.form.sealHint));
  assert.ok(markup.includes(text.form.quantity));
  assert.ok(markup.includes(text.form.notesHint));
  assert.ok(markup.includes(`>${text.form.submit}<`));
  assert.ok(markup.includes('max="2"'), 'the quantity is bounded by what is left');
  assert.ok(!/<label[^>]*>[^<]*chẩn đoán/i.test(markup), 'a diagnosis is never asked for');
});

test('a skin irritation asks no seal; it says it is decided case by case without a diagnosis', () => {
  const markup = render(
    <ProductReturnForm
      context={context()}
      preset={{ found: found(), draft: { lineId: 'l1', reason: 'SKIN_IRRITATION' } }}
    />,
    owner,
  );
  assert.ok(!markup.includes(text.form.seal));
  assert.ok(markup.includes('không chẩn đoán'));
});

test('an invoice with no product says services and combos are not returnable', () => {
  const markup = render(
    <ProductReturnForm context={context()} preset={{ found: { ...found(), lines: [] } }} />,
    owner,
  );
  assert.ok(markup.includes(text.form.noProducts));
  assert.ok(!markup.includes(`>${text.form.submit}<`));
});

// ------------------------------------------------------------------------------------------------- the case page

const item = (patch: Partial<ProductReturnCaseResponse> = {}): ProductReturnCaseResponse => ({
  id: 'c1',
  code: 'TH000001',
  branchId: 'A',
  branchName: 'Chi nhánh A',
  invoice: { id: 'i1', code: 'HD000042', paidAt: '2026-10-08T03:00:00.000Z', customerName: null },
  line: {
    id: 'l1',
    sequence: 1,
    sku: 'KEM-50',
    productNameVi: 'Kem dưỡng',
    productNameEn: 'Moisturizer',
    variantLabelVi: '50 ml',
    variantLabelEn: '50 ml',
    soldQuantity: 3,
  },
  reason: 'PERSONAL_PREFERENCE',
  requestedOutcome: 'EXCHANGE',
  quantity: 2,
  sealIntact: true,
  notes: 'Khách đổi ý',
  handoverAt: '2026-10-08T03:00:00.000Z',
  windowEndsAt: '2026-10-15T03:00:00.000Z',
  windowException: null,
  status: 'OPEN',
  decidedOutcome: null,
  closedByName: null,
  closedAt: null,
  closingNote: null,
  openedByName: 'Lan',
  openedAt: '2026-10-08T05:00:00.000Z',
  rowVersion: 1,
  photos: [],
  events: [
    {
      id: 'e1',
      kind: 'OPENED',
      actorName: 'Lan',
      note: 'Khách đổi ý',
      photoId: null,
      occurredAt: '2026-10-08T05:00:00.000Z',
    },
  ],
  can: {
    note: true,
    addPhoto: true,
    decide: true,
    cancel: true,
    removePhoto: false,
    refunds: false,
  },
  ...patch,
});

const view = (c: ProductReturnCaseResponse) =>
  render(<ProductReturnCaseView item={c} reload={noop} />, owner);

test('an open case: the facts, one primary action, the others in the menu, the history, private evidence', () => {
  const markup = view(item());
  assert.equal(markup.match(/<h1/g)?.length, 1);
  assert.ok(markup.includes('TH000001'));
  assert.ok(markup.includes(text.reasons.PERSONAL_PREFERENCE));
  assert.ok(markup.includes(text.outcomes.EXCHANGE));
  assert.ok(markup.includes('Kem dưỡng · 50 ml (KEM-50)'));
  assert.ok(markup.includes('2 trên 3'));
  assert.ok(markup.includes(text.view.guest), 'a guest customer');
  assert.ok(markup.includes(text.view.sealYes));
  assert.ok(markup.includes(text.statuses.OPEN));
  assert.equal(
    markup.match(new RegExp(`>${text.view.accept}<`, 'g'))?.length,
    1,
    'one primary action',
  );
  assert.ok(
    !markup.includes(`>${text.view.decline}<`),
    'decline and cancel are in the menu, not on the page',
  );
  assert.ok(markup.includes(text.view.history));
  assert.ok(markup.includes(text.events.OPENED));
  assert.ok(markup.includes(text.view.addNote));
  assert.ok(markup.includes(text.view.privateNote));
  assert.ok(markup.includes(text.view.photosEmpty));
  assert.ok(markup.includes(text.view.addPhoto), 'the drop zone');
});

test('who may do what comes from the case: no decision, no note, no photo without the flags', () => {
  const nothing = view(
    item({
      can: {
        note: false,
        addPhoto: false,
        decide: false,
        cancel: false,
        removePhoto: false,
        refunds: false,
      },
    }),
  );
  assert.ok(!nothing.includes(`>${text.view.accept}<`));
  assert.ok(!nothing.includes(text.view.addNote));
  assert.ok(!nothing.includes(text.view.dropHint));
  assert.ok(!nothing.includes(text.view.moreActions));
});

test('a wrong or damaged case says a photo is needed until one inside the window is present', () => {
  const without = view(
    item({ reason: 'WRONG_OR_DAMAGED', windowEndsAt: '2026-10-10T03:00:00.000Z' }),
  );
  assert.ok(without.includes(text.view.photoNeeded));
  const photo = {
    id: 'p1',
    width: 10,
    height: 10,
    uploadedAt: '2026-10-09T03:00:00.000Z',
    uploadedByName: 'Lan',
    removedAt: null,
    removedByName: null,
    removalNote: null,
  };
  const withPhoto = view(
    item({ reason: 'WRONG_OR_DAMAGED', windowEndsAt: '2026-10-10T03:00:00.000Z', photos: [photo] }),
  );
  assert.ok(!withPhoto.includes(text.view.photoNeeded));
});

test('evidence is shown only through the permission-checked route, with a tile menu for the Owner alone', () => {
  const photo = (id: string) => ({
    id,
    width: 10,
    height: 10,
    uploadedAt: '2026-10-09T03:00:00.000Z',
    uploadedByName: 'Lan',
    removedAt: null,
    removedByName: null,
    removalNote: null,
  });
  const markup = view(item({ photos: [photo('p1'), photo('p2')] }));
  assert.ok(markup.includes('/api/v1/product-returns/cases/c1/photos/p1/thumb'));
  assert.ok(markup.includes('/api/v1/product-returns/cases/c1/photos/p2/thumb'));
  assert.ok(
    !/\/api\/v1\/website\/media|\/uploads\/|\/returns\//.test(markup),
    'never a public path',
  );
  assert.ok(markup.includes('Ảnh 1') && markup.includes('Ảnh 2'));
  assert.ok(
    !markup.includes(text.view.removePhoto),
    'no removal menu for a person who is not the Owner',
  );
  const asOwner = view(
    item({
      photos: [photo('p1')],
      can: {
        note: true,
        addPhoto: true,
        decide: true,
        cancel: true,
        removePhoto: true,
        refunds: false,
      },
    }),
  );
  assert.ok(
    asOwner.includes('aria-haspopup') ||
      asOwner.includes(text.view.removePhoto) ||
      asOwner.includes('⋮'),
  );
});

test('a removed photo leaves a line saying so and no picture', () => {
  const markup = view(
    item({
      photos: [
        {
          id: 'p1',
          width: 10,
          height: 10,
          uploadedAt: '2026-10-09T03:00:00.000Z',
          uploadedByName: 'Lan',
          removedAt: '2026-10-20T03:00:00.000Z',
          removedByName: 'Chủ',
          removalNote: 'Khách yêu cầu',
        },
      ],
      events: [
        {
          id: 'e2',
          kind: 'PHOTO_REMOVED',
          actorName: 'Chủ',
          note: 'Khách yêu cầu',
          photoId: 'p1',
          occurredAt: '2026-10-20T03:00:00.000Z',
        },
      ],
    }),
  );
  assert.ok(!markup.includes('/photos/p1/'), 'no picture of a removed photo is requested');
  assert.ok(markup.includes('1 ảnh đã bị xóa theo yêu cầu của khách'));
  assert.ok(markup.includes(text.events.PHOTO_REMOVED));
  assert.ok(markup.includes('Khách yêu cầu'));
});

test('an accepted case says no money or stock has moved yet; a declined or cancelled one is final', () => {
  const accepted = view(
    item({
      status: 'ACCEPTED',
      decidedOutcome: 'REFUND',
      closedAt: '2026-10-08T06:00:00.000Z',
      closedByName: 'Chủ',
      closingNote: 'Đủ điều kiện',
      can: {
        note: true,
        addPhoto: false,
        decide: false,
        cancel: false,
        removePhoto: false,
        refunds: false,
      },
    }),
  );
  assert.ok(accepted.includes(text.view.acceptedNotice));
  assert.ok(accepted.includes(text.outcomes.REFUND));
  assert.ok(accepted.includes('Đủ điều kiện'));
  assert.ok(!accepted.includes(`>${text.view.accept}<`));
  const declined = view(
    item({
      status: 'DECLINED',
      closedAt: '2026-10-08T06:00:00.000Z',
      closedByName: 'Chủ',
      closingNote: 'Hộp đã mở',
      can: {
        note: false,
        addPhoto: false,
        decide: false,
        cancel: false,
        removePhoto: false,
        refunds: false,
      },
    }),
  );
  assert.ok(declined.includes(text.view.closedNotice));
  assert.ok(declined.includes('Hộp đã mở'));
  assert.ok(declined.includes(text.statuses.DECLINED));
});

test('a skin-irritation case shows no window and no diagnosis field', () => {
  const markup = view(item({ reason: 'SKIN_IRRITATION', windowEndsAt: null, sealIntact: null }));
  assert.ok(markup.includes(text.view.windowNone));
  assert.ok(markup.includes(text.view.sealUnknown));
  assert.ok(!/<label[^>]*>[^<]*chẩn đoán/i.test(markup));
});

// ------------------------------------------------------------------------- the Owner's exception (P6-12 follow-up, 2026-10-08)

const ownerContext = (): ProductReturnContextResponse => ({ ...context(), owner: true });
const pastWindow = (reason: 'PERSONAL_PREFERENCE' | 'WRONG_OR_DAMAGED' = 'WRONG_OR_DAMAGED') => ({
  found: found(),
  draft: { invoiceCode: 'HD000042', lineId: 'l1', reason } as const,
});

test('the Owner may choose a reason whose window is over; it asks for a written reason and says why', () => {
  const markup = render(
    <ProductReturnForm context={ownerContext()} preset={pastWindow()} />,
    owner,
  );
  const damaged = markup.slice(
    markup.indexOf(text.reasons.WRONG_OR_DAMAGED) - 400,
    markup.indexOf(text.reasons.WRONG_OR_DAMAGED),
  );
  assert.doesNotMatch(damaged, /disabled/, 'the Owner can choose it');
  assert.ok(markup.includes('Chủ được duyệt ngoại lệ kèm lý do'));
  assert.ok(markup.includes(text.form.exceptionBody));
  assert.ok(markup.includes(text.form.exceptionReason));
});

test('nobody else sees the exception: the reason stays disabled and no reason is asked for', () => {
  const markup = render(<ProductReturnForm context={context()} preset={pastWindow()} />, owner);
  const damaged = markup.slice(
    markup.indexOf(text.reasons.WRONG_OR_DAMAGED) - 400,
    markup.indexOf(text.reasons.WRONG_OR_DAMAGED),
  );
  assert.match(damaged, /disabled/);
  assert.ok(!markup.includes(text.form.exceptionReason));
  assert.ok(!markup.includes(text.form.exceptionBody));
});

test('the Owner sees no exception field while the reason is still inside its window', () => {
  const markup = render(
    <ProductReturnForm context={ownerContext()} preset={pastWindow('PERSONAL_PREFERENCE')} />,
    owner,
  );
  assert.ok(!markup.includes(text.form.exceptionReason));
});

test('a case opened by the Owner after its window shows who approved it, when and why, and the history says so', () => {
  const markup = view(
    item({
      windowException: {
        byName: 'Chủ tiệm',
        at: '2026-10-20T03:00:00.000Z',
        reason: 'Khách ở xa, về nước muộn',
      },
      events: [
        {
          id: 'e1',
          kind: 'OPENED',
          actorName: 'Chủ tiệm',
          note: null,
          photoId: null,
          occurredAt: '2026-10-20T03:00:00.000Z',
        },
        {
          id: 'e2',
          kind: 'WINDOW_EXCEPTION',
          actorName: 'Chủ tiệm',
          note: 'Khách ở xa, về nước muộn',
          photoId: null,
          occurredAt: '2026-10-20T03:00:00.000Z',
        },
      ],
    }),
  );
  assert.ok(markup.includes(text.view.fields.exception));
  assert.ok(markup.includes('Khách ở xa, về nước muộn'));
  assert.ok(markup.includes(text.events.WINDOW_EXCEPTION));
  assert.ok(!view(item()).includes(text.view.fields.exception), 'an ordinary case has no such row');
});

test('the English page says the same things', () => {
  const markup = render(<ProductReturnCaseView item={item()} reload={noop} />, owner, 'en');
  const en = productReturnsDictionary('en');
  assert.ok(markup.includes(en.reasons.PERSONAL_PREFERENCE));
  assert.ok(markup.includes(en.view.accept));
  assert.ok(markup.includes(en.statuses.OPEN));
});
