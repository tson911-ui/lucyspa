import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ActionBar,
  Badge,
  Button,
  ButtonLink,
  Checkbox,
  Combobox,
  ConfirmDialog,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  FormActions,
  FormSection,
  IconButton,
  ImageUploader,
  Menu,
  MoneyInput,
  Notice,
  ProgressBar,
  RadioGroup,
  RowActions,
  SearchInput,
  Select,
  Skeleton,
  Spinner,
  Switch,
  TextInput,
  Textarea,
  ToastProvider,
  Tooltip,
  arrangeMenu,
  type MenuItem,
} from './index';

// Longest-Vietnamese-label rule (contract section 5): every component must carry a long label
// unchanged (no truncation in markup) and never fix its own width.
const LONG =
  'Xác nhận hủy lịch hẹn của khách hàng đã đặt trước qua điện thoại và ghi chú thêm yêu cầu đặc biệt';

const html = renderToStaticMarkup;

test('Button: variants, loading state and blocked state expose the right ARIA', () => {
  const primary = html(<Button variant="primary">{LONG}</Button>);
  assert.match(primary, /<button [^>]*type="button"/, 'never submits by accident');
  assert.match(primary, /ls-btn-primary/);
  assert.ok(primary.includes(LONG));

  const submit = html(
    <Button type="submit" variant="primary" loading>
      {LONG}
    </Button>,
  );
  assert.match(submit, /aria-busy="true"/);
  assert.match(submit, /disabled=""/, 'a busy button cannot be pressed twice');
  assert.ok(submit.includes('ls-spinner'), 'spinner shown');
  assert.ok(submit.includes(LONG), 'the text stays while busy');

  const blocked = html(
    <Button disabled disabledReason="Không thể xóa: đang được dùng bởi 12 lịch hẹn.">
      Xóa
    </Button>,
  );
  assert.match(blocked, /aria-disabled="true"/, 'stays focusable so the reason can be read');
  assert.doesNotMatch(blocked, /<button[^>]* disabled=""/);
  const describedby = /aria-describedby="([^"]+)"/.exec(blocked)?.[1];
  assert.ok(describedby && blocked.includes(`id="${describedby}"`), 'reason is linked and visible');
  assert.ok(blocked.includes('đang được dùng bởi 12 lịch hẹn'));
});

test('Button: labels wrap instead of using a fixed width', () => {
  const markup = html(
    <>
      <Button size="lg">{LONG}</Button>
      <ButtonLink href="/x" icon="plus">
        {LONG}
      </ButtonLink>
    </>,
  );
  assert.doesNotMatch(markup, /style="[^"]*width/);
  assert.match(markup, /<a [^>]*href="\/x"/);
  assert.equal(markup.split(LONG).length - 1, 2);
});

test('IconButton: the label is the accessible name and the tooltip repeats it visually', () => {
  const markup = html(<IconButton icon="trash" label={LONG} />);
  assert.match(markup, /aria-label="Xác nhận hủy/);
  assert.match(markup, /class="ls-tooltip"[^>]*aria-hidden="true"/, 'not announced twice');
  assert.doesNotMatch(markup, /<svg[^>]*role="img"/, 'the icon itself is decorative');
});

test('Tooltip describes its trigger for assistive technology', () => {
  const markup = html(
    <Tooltip content="Chỉ quản lý mới được sửa">
      <button type="button">Sửa</button>
    </Tooltip>,
  );
  const id = /aria-describedby="([^"]+)"/.exec(markup)?.[1];
  assert.ok(id && markup.includes(`id="${id}" role="tooltip"`));
});

test('Badge, Notice, ErrorState: status is text, roles are right', () => {
  assert.match(html(<Badge tone="danger">{LONG}</Badge>), /ls-badge-danger">.*Xác nhận/);
  assert.ok(html(<Badge tone="success">Đã thanh toán</Badge>).includes('Đã thanh toán'));
  assert.match(html(<Notice tone="danger">x</Notice>), /role="alert"/);
  assert.match(html(<Notice tone="success">x</Notice>), /role="status"/);
  const dismissible = html(
    <Notice tone="info" onDismiss={() => undefined} dismissLabel="Đóng thông báo">
      x
    </Notice>,
  );
  assert.match(dismissible, /aria-label="Đóng thông báo"/);
  const failure = html(
    <ErrorState
      message="Có lỗi xảy ra."
      reference="req-42"
      referenceLabel="Mã yêu cầu"
      onRetry={() => undefined}
      retryLabel="Tải lại"
    />,
  );
  assert.ok(failure.includes('Mã yêu cầu: req-42'));
  assert.ok(failure.includes('Tải lại'));
  assert.match(failure, /role="alert"/);
});

test('EmptyState, Skeleton, Spinner, ProgressBar', () => {
  const empty = html(
    <EmptyState title="Chưa có dịch vụ" action={<Button variant="primary">Thêm dịch vụ</Button>}>
      Thêm dịch vụ đầu tiên để bắt đầu.
    </EmptyState>,
  );
  assert.ok(empty.includes('Chưa có dịch vụ') && empty.includes('Thêm dịch vụ đầu tiên'));
  assert.ok(empty.includes('Thêm dịch vụ</span>'), 'the primary action is offered');
  assert.match(html(<Skeleton lines={3} />), /aria-hidden="true"/);
  assert.equal(html(<Skeleton lines={3} />).split('ls-skeleton"').length - 1, 3);
  assert.match(html(<Spinner label="Đang tải" />), /role="status"[^>]*aria-label="Đang tải"/);
  assert.match(html(<Spinner />), /aria-hidden="true"/);
  const bar = html(<ProgressBar value={140} label="Đang tải lên" />);
  assert.match(bar, /role="progressbar"/);
  assert.match(bar, /aria-valuenow="100"/, 'clamped');
  assert.doesNotMatch(html(<ProgressBar label="Đang tải lên" />), /aria-valuenow/, 'indeterminate');
});

test('Field wires label, hint and error to the control', () => {
  const markup = html(
    <Field
      id="phone"
      label="Số điện thoại"
      required
      requiredLabel="bắt buộc"
      hint="Bắt đầu bằng 0"
      error="Số điện thoại không hợp lệ"
    >
      {(control) => <TextInput {...control} type="tel" />}
    </Field>,
  );
  assert.match(markup, /<label for="phone" class="ls-label">Số điện thoại/);
  assert.ok(markup.includes('(bắt buộc)'), 'required in words, not only a star');
  assert.match(markup, /<input[^>]*id="phone"/);
  assert.match(markup, /aria-describedby="phone-hint phone-error"/);
  assert.match(markup, /aria-invalid="true"/);
  assert.match(markup, /required=""/);
  assert.match(markup, /id="phone-error"[^>]*>.*Số điện thoại không hợp lệ/, 'error has text');
  assert.ok(markup.includes('<svg'), 'and an icon');
  const plain = html(
    <Field id="a" label="Tên">
      <input id="a" />
    </Field>,
  );
  assert.doesNotMatch(plain, /aria-describedby|ls-error/);
  assert.match(
    html(
      <Field id="b" label="Tên" required>
        <input id="b" />
      </Field>,
    ),
    /aria-hidden="true"> \*</,
    'without a word the star is decorative',
  );
});

test('Select, Textarea, MoneyInput, Checkbox, RadioGroup, Switch', () => {
  const select = html(
    <Select
      id="s"
      placeholder="Chọn chi nhánh"
      options={[
        { value: 'a', label: 'Chi nhánh Quận 1' },
        { value: 'b', label: 'Chi nhánh Quận 3', disabled: true },
      ]}
      invalid
    />,
  );
  assert.match(select, /<option value="">Chọn chi nhánh<\/option>/);
  assert.match(select, /aria-invalid="true"/);
  assert.match(select, /<option value="b" disabled="">/);
  assert.match(
    html(<Textarea invalid rows={3} />),
    /ls-textarea[^>]*aria-invalid="true"|aria-invalid="true"[^>]*ls-textarea/,
  );

  const money = html(<MoneyInput value={1234567} onValueChange={() => undefined} unit="₫" />);
  assert.match(money, /inputMode="numeric"/);
  assert.match(money, /value="1.234.567"/);
  assert.match(money, /ls-money-unit" aria-hidden="true">₫/);

  const check = html(<Checkbox label={LONG} hint="Gửi tin nhắn nhắc lịch" />);
  assert.match(check, /type="checkbox"/);
  assert.ok(check.includes(LONG));
  assert.match(check, /aria-describedby="[^"]+"/);

  const radios = html(
    <RadioGroup
      legend="Hình thức"
      name="mode"
      value="a"
      onValueChange={() => undefined}
      options={[
        { value: 'a', label: 'Nhân viên toàn thời gian' },
        { value: 'b', label: LONG },
      ]}
    />,
  );
  assert.match(radios, /<fieldset/);
  assert.match(radios, /<legend[^>]*>Hình thức<\/legend>/);
  assert.equal(radios.split('type="radio"').length - 1, 2);
  assert.match(radios, /checked="" value="a"/);

  const off = html(<Switch checked={false} onCheckedChange={() => undefined} label={LONG} />);
  assert.match(off, /role="switch"/);
  assert.match(off, /aria-checked="false"/);
  assert.ok(off.includes(LONG), 'the visible text is the name');
});

test('Combobox exposes the ARIA 1.2 combobox pattern', () => {
  const markup = html(
    <Combobox
      id="who"
      options={[
        { value: '1', label: 'Nguyễn Văn An' },
        { value: '2', label: 'Lê Hoàng' },
      ]}
      value="2"
      onValueChange={() => undefined}
      emptyLabel="Không có kết quả"
      resultsLabel={(count) => `${count} kết quả`}
    />,
  );
  assert.match(markup, /role="combobox"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /aria-controls="who-list"/);
  assert.match(markup, /aria-autocomplete="list"/);
  assert.match(markup, /value="Lê Hoàng"/, 'shows the selected label when closed');
  assert.doesNotMatch(markup, /role="listbox"/, 'list is not rendered while closed');
});

test('SearchInput has an accessible name and no clear button while empty', () => {
  const empty = html(
    <SearchInput label="Tìm nhân viên" clearLabel="Xóa tìm kiếm" onSearch={() => undefined} />,
  );
  assert.match(
    empty,
    /type="search"[^>]*aria-label="Tìm nhân viên"|aria-label="Tìm nhân viên"[^>]*type="search"/,
  );
  assert.doesNotMatch(empty, /Xóa tìm kiếm/);
  const filled = html(
    <SearchInput
      value="an"
      label="Tìm nhân viên"
      clearLabel="Xóa tìm kiếm"
      onSearch={() => undefined}
    />,
  );
  assert.match(filled, /aria-label="Xóa tìm kiếm"/);
});

test('FormSection and FormActions keep Save before Cancel', () => {
  const section = html(
    <FormSection title="Thông tin liên hệ" description="Hiển thị cho khách">
      <span>x</span>
    </FormSection>,
  );
  assert.match(section, /<fieldset[^>]*>.*<legend[^>]*>Thông tin liên hệ<\/legend>/);
  const actions = html(
    <FormActions
      primary={
        <Button type="submit" variant="primary">
          Lưu
        </Button>
      }
      cancel={<Button variant="ghost">Hủy</Button>}
    />,
  );
  assert.ok(actions.indexOf('Lưu') < actions.indexOf('Hủy'));
});

test('Dialog is a labelled modal and renders nothing when closed', () => {
  const markup = html(
    <Dialog
      title={LONG}
      description="Mô tả ngắn"
      onClose={() => undefined}
      closeLabel="Đóng"
      footer="f"
    >
      body
    </Dialog>,
  );
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  const labelled = /aria-labelledby="([^"]+)"/.exec(markup)?.[1];
  assert.ok(labelled && markup.includes(`id="${labelled}"`));
  assert.ok(/aria-describedby="[^"]+"/.test(markup));
  assert.match(markup, /aria-label="Đóng"/);
  assert.doesNotMatch(markup, /style="[^"]*width/);
  assert.equal(html(<Dialog open={false} title="t" onClose={() => undefined} />), '');
  const busy = html(<Dialog title="t" busy closeLabel="Đóng" onClose={() => undefined} />);
  assert.match(busy, /aria-busy="true"/);
  assert.match(
    busy,
    /aria-label="Đóng"[^>]*disabled=""|disabled=""[^>]*aria-label="Đóng"/,
    'cannot close while busy',
  );
});

test('Drawer is a labelled modal side sheet', () => {
  const markup = html(
    <Drawer open title="Bộ lọc" side="start" closeLabel="Đóng" onClose={() => undefined}>
      x
    </Drawer>,
  );
  assert.match(markup, /ls-drawer-start/);
  assert.match(markup, /role="dialog"[^>]*aria-modal="true"/);
  assert.equal(
    html(<Drawer open={false} title="t" closeLabel="c" onClose={() => undefined} />),
    '',
  );
});

test('ConfirmDialog: alertdialog with facts, both buttons and no request on render', () => {
  let sent = 0;
  const markup = html(
    <ConfirmDialog
      title="Xóa dịch vụ?"
      description="Dịch vụ sẽ bị xóa vĩnh viễn và không thể khôi phục."
      facts={[
        { label: 'Tên', value: 'Sơn gel' },
        { label: 'Mã', value: 'NAIL_GEL' },
      ]}
      confirmLabel="Xóa dịch vụ"
      cancelLabel="Hủy"
      describeError={() => ({ message: 'x' })}
      onConfirm={() => {
        sent += 1;
        return Promise.resolve();
      }}
      onCancel={() => undefined}
    />,
  );
  assert.match(markup, /role="alertdialog"/);
  assert.ok(markup.includes('Sơn gel') && markup.includes('NAIL_GEL'));
  assert.ok(
    markup.indexOf('Hủy') < markup.indexOf('Xóa dịch vụ</span>'),
    'Cancel first, then the action',
  );
  assert.match(markup, /ls-btn-danger[^-]/, 'destructive confirmation is the solid danger button');
  assert.equal(sent, 0);
  assert.equal(
    html(
      <ConfirmDialog
        open={false}
        title="t"
        description="d"
        confirmLabel="c"
        cancelLabel="x"
        describeError={() => ({ message: 'x' })}
        onConfirm={() => Promise.resolve()}
        onCancel={() => undefined}
      />,
    ),
    '',
  );
});

test('ConfirmDialog: neutral tone is not red, reason and typing fields render', () => {
  const markup = html(
    <ConfirmDialog
      tone="warning"
      title="Hủy lịch hẹn?"
      description={LONG}
      confirmLabel="Hủy lịch hẹn"
      cancelLabel="Giữ lại"
      reasonField={{ label: 'Lý do', required: true, requiredLabel: 'bắt buộc' }}
      requireTyping={{ code: 'BK-1', label: 'Nhập BK-1 để xác nhận' }}
      describeError={() => ({ message: 'x' })}
      onConfirm={() => Promise.resolve()}
      onCancel={() => undefined}
    />,
  );
  assert.doesNotMatch(markup, /ls-btn-danger/);
  assert.match(markup, /ls-btn-primary/);
  assert.ok(markup.includes('Lý do') && markup.includes('(bắt buộc)'));
  assert.ok(markup.includes('Nhập BK-1 để xác nhận'));
  assert.match(
    markup,
    /ls-btn-primary[^>]*disabled=""|disabled=""[^>]*ls-btn-primary/,
    'confirm waits for the code',
  );
});

const items: MenuItem[] = [
  { id: 'end', label: 'Kết thúc hợp đồng', tone: 'danger', onSelect: () => undefined },
  { id: 'copy', label: 'Nhân bản', onSelect: () => undefined },
];

test('Menu: closed trigger announces a popup; entries are arranged safe-first with a divider', () => {
  const markup = html(<Menu label="Thao tác khác" items={arrangeMenu(items)} />);
  assert.match(markup, /aria-haspopup="menu"/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /aria-label="Thao tác khác"/);
  const arranged = arrangeMenu(items);
  assert.deepEqual(
    arranged.map((entry) => entry.id),
    ['copy', '__divider', 'end'],
  );
  assert.deepEqual(
    arrangeMenu([items[1]!]).map((entry) => entry.id),
    ['copy'],
    'no divider without a destructive item',
  );
});

test('RowActions: one ⋮ button and no second visible button; ActionBar: safe, destructive, primary last', () => {
  const row = html(<RowActions menuLabel="Thao tác cho Nguyễn Thị Lan" items={items} />);
  assert.equal(row.match(/<button/g)?.length, 1, 'a single trigger');
  assert.match(row, /aria-haspopup="menu"/);
  assert.match(row, /aria-label="Thao tác cho Nguyễn Thị Lan"/);
  assert.match(row, /M12 5\.25v1\.5M12 11\.25v1\.5M12 17\.25v1\.5/, 'vertical ellipsis icon');
  assert.equal(html(<RowActions menuLabel="m" items={[]} />), '', 'nothing without items');

  const bar = html(
    <ActionBar
      label="Thao tác nhân viên"
      moreLabel="Thêm"
      actions={items}
      primary={<Button variant="primary">Lưu thay đổi</Button>}
    />,
  );
  assert.match(
    bar,
    /role="group"[^>]*aria-label="Thao tác nhân viên"|aria-label="Thao tác nhân viên"[^>]*role="group"/,
  );
  const inline = bar.slice(bar.indexOf('ls-actionbar-inline'), bar.indexOf('ls-actionbar-compact'));
  assert.ok(
    inline.indexOf('Nhân bản') < inline.indexOf('Kết thúc hợp đồng'),
    'destructive after safe',
  );
  assert.match(inline, /ls-btn-danger-outline/, 'destructive outside dialogs is outlined');
  assert.ok(bar.lastIndexOf('Lưu thay đổi') > bar.indexOf('ls-actionbar-compact'), 'primary last');
});

test('ToastProvider renders a named live region', () => {
  const markup = html(
    <ToastProvider regionLabel="Thông báo" dismissLabel="Đóng">
      <p>page</p>
    </ToastProvider>,
  );
  assert.match(
    markup,
    /role="region"[^>]*aria-label="Thông báo"|aria-label="Thông báo"[^>]*role="region"/,
  );
});

const labels = {
  choose: 'Chọn ảnh',
  replace: 'Thay ảnh',
  remove: 'Gỡ ảnh',
  cancel: 'Hủy tải lên',
  retry: 'Thử lại',
  drop: 'hoặc kéo thả ảnh vào đây',
  uploading: 'Đang tải ảnh lên',
  errorType: 'Chỉ nhận ảnh JPG, PNG hoặc WebP.',
  errorSize: 'Ảnh vượt quá dung lượng cho phép.',
  errorDimensions: 'Ảnh quá nhỏ.',
  errorUpload: 'Không tải được ảnh.',
};

test('ImageUploader: empty state is a keyboard button with the accepted types in text', () => {
  const markup = html(
    <ImageUploader
      value={null}
      onChange={() => undefined}
      upload={() => Promise.reject(new Error('unused'))}
      labels={labels}
      hint="JPG, PNG hoặc WebP, tối đa 10 MB. Khuyến nghị 1920 x 800 px."
      maxBytes={10_000_000}
    />,
  );
  assert.match(markup, /<button type="button" class="ls-dropzone-button"[^>]*aria-describedby=/);
  assert.ok(markup.includes('Chọn ảnh') && markup.includes('hoặc kéo thả ảnh vào đây'));
  assert.ok(markup.includes('1920 x 800 px'));
  assert.match(markup, /<input[^>]*type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
});

test('ImageUploader: uploaded state shows name, size, dimensions, Replace and Remove', () => {
  const markup = html(
    <ImageUploader
      value={{
        url: '/media/a.webp',
        name: 'banner-tet.webp',
        sizeBytes: 1_536_000,
        width: 1920,
        height: 800,
      }}
      onChange={() => undefined}
      upload={() => Promise.reject(new Error('unused'))}
      labels={labels}
      hint="hint"
      maxBytes={10_000_000}
      decimalSeparator=","
    />,
  );
  assert.ok(markup.includes('banner-tet.webp'));
  assert.ok(markup.includes('1,5 MB · 1920 × 800'));
  assert.ok(markup.includes('Thay ảnh') && markup.includes('Gỡ ảnh'));
  assert.match(markup, /<img[^>]*alt=""/, 'the name is the text; the thumbnail is decorative');
});
