// Component gallery for the redesign gates (DESIGN.md 14, redesign group 1 C4-C6): renders the real kit components to a static
// HTML file that links the same stylesheets in the same order as the web layout, so the parts can be shot at 360/768/1440 in
// light and dark before there is a page that uses them. Not part of the package build.
//
//   cd packages/ui && node --import tsx scripts/v2-gallery.tsx <controls|surfaces|overlays> <out.html>
//
// Every section is drawn in five frames: the base band, the alternate band, a card on each band and a dialog surface (the fill of a
// field depends on what it sits on), plus a last frame WITHOUT `data-ui="v2"` (the staff look), which must not change.
import { writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Accordion,
  Badge,
  Breadcrumbs,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  ErrorState,
  Field,
  FilterChips,
  Icon,
  IconButton,
  ImageFrame,
  LoadingState,
  Notice,
  NumberInput,
  Pagination,
  PasswordInput,
  ProgressBar,
  RadioGroup,
  SearchInput,
  Select,
  SegmentedControl,
  Skeleton,
  Spinner,
  Steps,
  Switch,
  Tabs,
  TextInput,
  Textarea,
  Tooltip,
} from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..', 'src');
const [section = 'controls', out = 'gallery.html'] = process.argv.slice(2);
const outPath = resolve(process.cwd(), out);
// GALLERY_FRAMES=1,3 draws only those frames (a 360 px shot of all six would be far taller than a screen capture allows).
const frames = (process.env.GALLERY_FRAMES ?? '1,2,3,4,5,6').split(',').map(Number);

// The order of `apps/web/src/app/[locale]/layout.tsx`.
const SHEETS = [
  'tokens.css',
  'season.css',
  'season-decor.css',
  'season-art.css',
  'season-preview.css',
  'base.css',
  'components.css',
  'shell.css',
  'staff.css',
  'site.css',
  'customer-tokens.css',
  'customer.css',
  'customer-pages.css',
  ...(process.env.GALLERY_V2 === '0' ? [] : ['components-v2.css']),
];

const noop = () => undefined;

function Controls() {
  return (
    <div className="g-stack">
      <div className="g-row">
        <Button variant="primary">Đặt lịch</Button>
        <Button variant="secondary">Xem dịch vụ</Button>
        <Button variant="ghost">Bỏ qua</Button>
        <Button variant="danger-outline">Hủy lịch</Button>
        <Button variant="primary" icon="plus">
          Thêm vào giỏ
        </Button>
      </div>
      <div className="g-row">
        <Button variant="primary" disabled>
          Đã hết chỗ
        </Button>
        <Button variant="secondary" disabled>
          Không khả dụng
        </Button>
        <Button variant="primary" loading>
          Đang lưu...
        </Button>
        <Button variant="primary" size="lg">
          Đặt lịch ngay
        </Button>
        <Button variant="primary" compact>
          Lưu
        </Button>
        <Button variant="secondary" compact>
          Hủy
        </Button>
      </div>
      <div className="g-row">
        <ButtonLink href="#" variant="primary">
          Đặt lịch
        </ButtonLink>
        <ButtonLink href="#" variant="secondary" icon="chevron-right">
          Tìm hiểu thêm
        </ButtonLink>
        <IconButton icon="close" label="Đóng" />
        <IconButton icon="search" label="Tìm kiếm" variant="secondary" />
        <IconButton icon="close" label="Đóng" compact />
        <IconButton icon="plus" label="Thêm" variant="primary" />
      </div>
      <div className="g-row g-row-wrap">
        <Button variant="primary" fullWidth>
          Nút chiếm hết chiều ngang của khung chứa nó, nhãn dài vẫn xuống dòng gọn gàng
        </Button>
      </div>
      <div className="g-form">
        <Field
          label="Họ và tên"
          required
          requiredLabel="bắt buộc"
          hint="Như trên giấy tờ tùy thân."
        >
          {(control) => <TextInput {...control} placeholder="Nguyễn Thị Lan" />}
        </Field>
        <Field label="Số điện thoại" error="Số điện thoại cần 10 chữ số, ví dụ 0901 234 567.">
          {(control) => <TextInput {...control} defaultValue="09012" inputMode="tel" />}
        </Field>
        <Field label="Dịch vụ">
          {(control) => (
            <Select
              {...control}
              placeholder="Chọn dịch vụ"
              options={[
                { value: 'a', label: 'Massage thư giãn toàn thân' },
                { value: 'b', label: 'Chăm sóc da mặt' },
              ]}
            />
          )}
        </Field>
        <Field label="Mật khẩu" hint="Ít nhất 8 ký tự.">
          {(control) => (
            <PasswordInput
              {...control}
              defaultValue="matkhau123"
              showLabel="Hiện mật khẩu"
              hideLabel="Ẩn mật khẩu"
            />
          )}
        </Field>
        <Field label="Số lượng">{(control) => <NumberInput {...control} defaultValue={2} />}</Field>
        <Field label="Ghi chú cho kỹ thuật viên">
          {(control) => <Textarea {...control} placeholder="Ví dụ: đau vai bên trái" />}
        </Field>
        <Field label="Ngày hẹn (đã khóa)">
          {(control) => <TextInput {...control} defaultValue="15/10/2026" disabled />}
        </Field>
        <Field label="Tìm kiếm">
          {() => (
            <SearchInput
              label="Tìm dịch vụ"
              clearLabel="Xóa"
              placeholder="Tìm dịch vụ"
              defaultValue="massage"
              onSearch={noop}
            />
          )}
        </Field>
        <Field label="Nhỏ gọn" width="md">
          {(control) => <TextInput {...control} defaultValue="Ô nhập nhỏ gọn" compact />}
        </Field>
      </div>
      <div className="g-form">
        <Checkbox label="Tôi đồng ý với điều khoản" hint="Bạn có thể rút lại bất cứ lúc nào." />
        <Checkbox label="Đã chọn" defaultChecked />
        <Checkbox label="Đã khóa" disabled />
        <Checkbox label="Chưa chọn, có lỗi" invalid />
        <RadioGroup
          legend="Phương thức thanh toán"
          name={`pay-${section}`}
          value="cash"
          onValueChange={noop}
          options={[
            { value: 'cash', label: 'Tiền mặt tại quầy' },
            { value: 'card', label: 'Chuyển khoản' },
            { value: 'off', label: 'Ví điện tử (tạm dừng)', disabled: true },
          ]}
        />
        <RadioGroup
          legend="Khung giờ"
          name={`slot-${section}`}
          value="am"
          layout="inline"
          onValueChange={noop}
          options={[
            { value: 'am', label: 'Sáng' },
            { value: 'pm', label: 'Chiều' },
          ]}
        />
        <Switch checked label="Nhắc lịch qua email" onCheckedChange={noop} />
        <Switch checked={false} label="Nhận tin khuyến mãi" onCheckedChange={noop} />
        <Switch checked disabled label="Thông báo bắt buộc" onCheckedChange={noop} />
      </div>
    </div>
  );
}

const PICTURE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 30'%3E%3Crect width='40' height='30' fill='%23cdbfb4'/%3E%3Ccircle cx='28' cy='11' r='5' fill='%23e9dfd6'/%3E%3Cpath d='M0 30 L14 14 L24 24 L30 18 L40 30Z' fill='%23a8998c'/%3E%3C/svg%3E";

function Surfaces({ inCard }: { inCard: boolean }) {
  return (
    <div className="g-stack">
      {inCard ? null : (
        <Card>
          <CardHeader title="Gói chăm sóc da mặt" description="60 phút, có tư vấn da." />
          <p>Làm sạch sâu, đắp mặt nạ và massage thư giãn vùng mặt, cổ và vai.</p>
        </Card>
      )}
      <div className="g-row">
        <Badge tone="accent">Bán chạy</Badge>
        <Badge tone="outline">Mới</Badge>
        <Badge tone="ink">-20 %</Badge>
        <Badge tone="brand">Đang chọn</Badge>
        <Badge tone="neutral">Nháp</Badge>
      </div>
      <div className="g-row">
        <Badge tone="success" icon="check-circle">
          Đã xác nhận
        </Badge>
        <Badge tone="warning" icon="alert-triangle">
          Chờ thanh toán
        </Badge>
        <Badge tone="danger" icon="x-circle">
          Đã hủy
        </Badge>
        <Badge tone="info" icon="info">
          Sắp diễn ra
        </Badge>
      </div>
      <Tabs
        label="Lịch hẹn"
        defaultValue="upcoming"
        tabs={[
          { id: 'upcoming', label: 'Sắp tới', panel: <p>Nội dung tab sắp tới.</p> },
          { id: 'done', label: 'Đã xong', panel: null },
          { id: 'cancelled', label: 'Đã hủy', panel: null },
          { id: 'off', label: 'Tạm khóa', panel: null, disabled: true },
        ]}
      />
      <SegmentedControl
        label="Hiển thị"
        value="grid"
        onChange={noop}
        options={[
          { value: 'grid', label: 'Lưới' },
          { value: 'list', label: 'Danh sách' },
        ]}
      />
      <FilterChips
        chips={[
          { key: 'a', label: 'Chăm sóc da' },
          { key: 'b', label: 'Dưới 500.000 ₫' },
        ]}
        onRemove={noop}
        removeLabel="Bỏ lọc {filter}"
      />
      <nav className="ls-pills" aria-label="Nhóm dịch vụ">
        <a href="#a" aria-current="true">
          Tất cả
        </a>
        <a href="#b">Massage</a>
        <a href="#c">Chăm sóc da</a>
      </nav>
      <div className="g-row">
        <div className="g-thumb">
          <ImageFrame src={PICTURE} alt="Phòng trị liệu" ratio="4/3" />
        </div>
        <div className="g-thumb">
          <ImageFrame src={null} alt="Chưa có ảnh dịch vụ" ratio="1/1" />
        </div>
      </div>
      <Notice tone="info">Lịch hẹn được giữ trong 15 phút.</Notice>
      <Notice tone="success" onDismiss={noop} dismissLabel="Đóng thông báo">
        Đã đặt lịch thành công.
      </Notice>
      <Notice tone="warning">Chi nhánh nghỉ lễ ngày 20/10.</Notice>
      <Notice tone="danger">Không tải được lịch trống. Thử lại sau ít phút.</Notice>
      <div className="g-row">
        <Spinner />
        <Spinner size={24} />
        <Tooltip content="Thêm vào giỏ">
          <IconButton icon="plus" label="Thêm vào giỏ" variant="secondary" />
        </Tooltip>
      </div>
      <Skeleton lines={3} />
      <LoadingState label="Đang tải dịch vụ" rows={3} />
      <EmptyState
        icon="info"
        title="Chưa có lịch hẹn"
        action={
          <ButtonLink href="#" variant="primary">
            Đặt lịch
          </ButtonLink>
        }
      >
        Khi bạn đặt lịch, lịch hẹn sẽ hiện ở đây.
      </EmptyState>
      <ErrorState
        message="Không tải được danh sách. Kiểm tra kết nối rồi thử lại."
        reference="REQ-1042"
        referenceLabel="Mã yêu cầu"
        onRetry={noop}
        retryLabel="Thử lại"
      />
    </div>
  );
}

function Stage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="g-caption">{title}</p>
      <div className="g-stage">{children}</div>
    </div>
  );
}

function Overlays() {
  return (
    <div className="g-stack">
      <Stage title="Dialog (md): task title, form, Cancel then Save">
        <Dialog
          title="Thông tin liên hệ"
          description="Chúng tôi dùng số này để nhắc lịch hẹn."
          closeLabel="Đóng"
          onClose={noop}
          footer={
            <>
              <Button variant="neutral">Hủy</Button>
              <Button variant="primary">Lưu thay đổi</Button>
            </>
          }
        >
          <Field label="Họ và tên" required requiredLabel="bắt buộc">
            {(control) => <TextInput {...control} defaultValue="Nguyễn Thị Lan" />}
          </Field>
          <Field label="Số điện thoại" error="Số điện thoại cần 10 chữ số.">
            {(control) => <TextInput {...control} defaultValue="09012" />}
          </Field>
        </Dialog>
      </Stage>
      <Stage title="Confirm dialog (alertdialog): focus starts on Cancel">
        <ConfirmDialog
          title="Hủy lịch hẹn?"
          description="Lịch hẹn lúc 14:00 ngày 20/10 sẽ được hủy. Bạn có thể đặt lại sau."
          facts={[
            { label: 'Dịch vụ', value: 'Massage thư giãn toàn thân' },
            { label: 'Giờ hẹn', value: '14:00, 20/10/2026' },
          ]}
          confirmLabel="Hủy lịch hẹn"
          cancelLabel="Giữ lịch hẹn"
          describeError={() => ({ message: 'Không hủy được lịch hẹn.' })}
          onConfirm={() => Promise.resolve()}
          onCancel={noop}
        />
      </Stage>
      <Stage title="Drawer from the trailing edge (512)">
        <Drawer
          open
          title="Bộ lọc dịch vụ"
          closeLabel="Đóng"
          onClose={noop}
          footer={
            <>
              <Button variant="neutral">Xóa lọc</Button>
              <Button variant="primary">Áp dụng</Button>
            </>
          }
        >
          <Field label="Nhóm dịch vụ">
            {(control) => (
              <Select
                {...control}
                placeholder="Tất cả"
                options={[
                  { value: 'a', label: 'Massage' },
                  { value: 'b', label: 'Chăm sóc da' },
                ]}
              />
            )}
          </Field>
          <Checkbox label="Chỉ dịch vụ đang giảm giá" />
        </Drawer>
      </Stage>
      <Stage title="Bottom sheet">
        <Drawer
          open
          side="bottom"
          title="Sắp xếp"
          closeLabel="Đóng"
          onClose={noop}
          footer={<Button variant="primary">Xong</Button>}
        >
          <RadioGroup
            legend="Sắp xếp theo"
            name="sort-sheet"
            value="price"
            onValueChange={noop}
            options={[
              { value: 'price', label: 'Giá thấp đến cao' },
              { value: 'new', label: 'Mới nhất' },
            ]}
          />
        </Drawer>
      </Stage>
      <Stage title="Menu and popover">
        <div className="g-pop">
          <div className="ls-popover" style={{ position: 'static' }} role="menu">
            <div className="ls-menu-panel">
              <button type="button" role="menuitem" className="ls-menu-item">
                <Icon name="edit" />
                <span className="ls-menu-item-text">Đổi lịch hẹn</span>
              </button>
              <button type="button" role="menuitem" className="ls-menu-item">
                <Icon name="user" />
                <span className="ls-menu-item-text">Hồ sơ của tôi</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="ls-menu-item ls-menu-item-disabled"
                aria-disabled="true"
              >
                <Icon name="trash" />
                <span className="ls-menu-item-text">
                  Xóa tài khoản
                  <span className="ls-menu-item-reason">Liên hệ chi nhánh để xóa</span>
                </span>
              </button>
              <div className="ls-menu-divider" role="separator" />
              <button type="button" role="menuitem" className="ls-menu-item ls-menu-item-danger">
                <Icon name="close" />
                <span className="ls-menu-item-text">Đăng xuất</span>
              </button>
            </div>
          </div>
        </div>
      </Stage>
      <Stage title="Toasts (success, info, warning, danger)">
        <div className="ls-toast-region" role="region" aria-label="Thông báo">
          {(
            [
              ['success', 'check-circle', 'Đã lưu', 'Thông tin đã được cập nhật.'],
              ['info', 'info', 'Lịch hẹn mới', 'Bạn có lịch hẹn lúc 14:00 ngày 20/10.'],
              ['warning', 'alert-triangle', 'Sắp hết giờ', 'Lịch hẹn được giữ thêm 2 phút.'],
              ['danger', 'x-circle', 'Không lưu được', 'Kiểm tra kết nối rồi thử lại.'],
            ] as const
          ).map(([tone, icon, title, message]) => (
            <div key={tone} className={`ls-toast ls-toast-${tone}`} role="status">
              <Icon name={icon} className="ls-toast-icon" />
              <div className="ls-toast-body">
                <p className="ls-toast-title">{title}</p>
                <p>{message}</p>
              </div>
              <button type="button" className="ls-notice-close" aria-label="Đóng">
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
        </div>
      </Stage>
    </div>
  );
}

const pagerLabels = {
  nav: 'Các trang',
  first: 'Trang đầu',
  previous: 'Trang trước',
  next: 'Trang sau',
  last: 'Trang cuối',
  pageNumber: 'Trang {page}',
  summary: 'Hiển thị {from}–{to} trong {total}',
  pageSize: 'Số dòng mỗi trang',
  pageSizeOption: '{size} dòng',
  pageOf: 'Trang {page} / {pages}',
};

const invoices = [
  {
    id: 'HD-2041',
    name: 'Massage thư giãn toàn thân',
    date: '20/10/2026',
    status: 'paid',
    amount: '1.200.000 ₫',
  },
  {
    id: 'HD-2040',
    name: 'Chăm sóc da mặt',
    date: '18/10/2026',
    status: 'pending',
    amount: '850.000 ₫',
  },
  {
    id: 'HD-2039',
    name: 'Gói 5 buổi gội đầu dưỡng sinh',
    date: '12/10/2026',
    status: 'paid',
    amount: '2.450.000 ₫',
  },
  {
    id: 'HD-2038',
    name: 'Tẩy da chết toàn thân',
    date: '05/10/2026',
    status: 'cancelled',
    amount: '600.000 ₫',
  },
];

function DataParts({ inCard }: { inCard: boolean }) {
  return (
    <div className="g-stack">
      <Breadcrumbs
        label="Đường dẫn"
        items={[
          { label: 'Tài khoản', href: '#' },
          { label: 'Hóa đơn', href: '#' },
          { label: 'HD-2041' },
        ]}
      />
      <DataTable
        caption="Hóa đơn của tôi"
        mode="server"
        rows={inCard ? invoices.slice(0, 2) : invoices}
        rowKey={(row) => row.id}
        columns={[
          { key: 'name', header: 'Dịch vụ', mobileTitle: true, cell: (row) => row.name },
          { key: 'date', header: 'Ngày', cell: (row) => row.date },
          {
            key: 'status',
            header: 'Trạng thái',
            cell: (row) =>
              row.status === 'paid' ? (
                <Badge tone="success" icon="check-circle">
                  Đã thanh toán
                </Badge>
              ) : row.status === 'pending' ? (
                <Badge tone="warning" icon="alert-triangle">
                  Chờ thanh toán
                </Badge>
              ) : (
                <Badge tone="danger" icon="x-circle">
                  Đã hủy
                </Badge>
              ),
          },
          { key: 'amount', header: 'Số tiền', numeric: true, cell: (row) => row.amount },
        ]}
        paging={{ page: 2, pageSize: 4, total: 132, onPageChange: noop, labels: pagerLabels }}
      />
      <Pagination
        page={7}
        pageSize={20}
        total={310}
        onPageChange={noop}
        onPageSizeChange={noop}
        labels={pagerLabels}
      />
      <Accordion
        defaultOpen={['b']}
        items={[
          {
            id: 'a',
            title: 'Tôi có thể đổi lịch hẹn không?',
            content: <p>Có, đổi trước giờ hẹn 2 tiếng.</p>,
          },
          {
            id: 'b',
            title: 'Spa có nhận thanh toán chuyển khoản không?',
            content: (
              <p>
                Có. Bạn chọn chuyển khoản ở bước thanh toán, hệ thống xác nhận ngay khi nhận tiền.
              </p>
            ),
          },
          {
            id: 'c',
            title: 'Trẻ em có dùng dịch vụ được không?',
            content: <p>Chỉ với một số dịch vụ.</p>,
          },
        ]}
      />
      <Steps
        label="Các bước đặt lịch"
        current="time"
        steps={[
          { key: 'service', label: 'Chọn dịch vụ', shortLabel: 'Dịch vụ' },
          { key: 'time', label: 'Chọn giờ', shortLabel: 'Giờ' },
          { key: 'info', label: 'Thông tin', shortLabel: 'Thông tin' },
          { key: 'confirm', label: 'Xác nhận', shortLabel: 'Xác nhận' },
        ]}
      />
      <ProgressBar value={60} label="Tiến độ" />
      <ProgressBar label="Đang xử lý" />
      <div className="ls-qty" role="group" aria-label="Số lượng">
        <IconButton icon="minus" variant="secondary" label="Giảm" disabled />
        <NumberInput className="ls-qty-input" aria-label="Số lượng" defaultValue={1} />
        <IconButton icon="plus" variant="secondary" label="Tăng" />
      </div>
    </div>
  );
}

const SECTIONS: Record<string, (props: { inCard: boolean }) => ReactNode> = {
  controls: Controls,
  surfaces: Surfaces,
  overlays: Overlays,
  data: DataParts,
};
const Specimen = SECTIONS[section] ?? Controls;

function Frame({
  title,
  v2 = true,
  band = 'base',
  wrap,
}: {
  title: string;
  v2?: boolean;
  band?: 'base' | 'alt';
  wrap?: 'card' | 'dialog';
}) {
  const body = <Specimen inCard={wrap === 'card'} />;
  const inner =
    wrap === 'card' ? (
      <Card>{body}</Card>
    ) : wrap === 'dialog' ? (
      <div className="ls-dialog ls-dialog-lg g-dialog" role="dialog" aria-label={title}>
        <header className="ls-dialog-header">
          <h2 className="ls-dialog-title">Thông tin liên hệ</h2>
        </header>
        <div className="ls-dialog-body">{body}</div>
      </div>
    ) : (
      body
    );
  return (
    <section
      className={v2 ? 'ls-site g-cell' : 'g-cell'}
      {...(v2 ? { 'data-ui': 'v2' } : {})}
      aria-label={title}
    >
      <div className={v2 ? `g-frame ls-band--${band}` : 'g-frame'}>
        <h2 className="g-title">{title}</h2>
        {inner}
      </div>
    </section>
  );
}

const sheetLinks = SHEETS.map(
  (sheet) =>
    `<link rel="stylesheet" href="${relative(dirname(outPath), resolve(src, sheet)).replaceAll('\\', '/')}">`,
).join('\n');

const gallery = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>v2 gallery: ${section}</title>
<link rel="stylesheet" href="${relative(dirname(outPath), resolve(process.cwd(), '..', '..', '.local', 'g2', 'fonts.css')).replaceAll('\\', '/')}">
${sheetLinks}
<style>
  /* Gallery chrome only (not a product style). */
  body { margin: 0; font-family: var(--ls-font-sans); }
  .g-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 400px), 1fr)); }
  .g-cell { min-width: 0; }
  .g-frame { min-height: 100%; padding: 24px 16px; color: var(--ls-text); }
  .g-cell:not([data-ui]) .g-frame { background: var(--ls-bg-page); }
  .g-title { margin: 0 0 16px; font-size: 14px; font-weight: 600; color: var(--ls-text-muted); }
  .g-stack { display: grid; gap: 24px; }
  .g-form { display: grid; gap: 24px; }
  .g-caption { margin: 0 0 8px; font-size: 12px; color: var(--ls-text-muted); }
  .g-stage { position: relative; height: 640px; overflow: hidden; transform: translateZ(0); border: 1px dashed var(--ls-border); }
  .g-pop { padding: 24px; }
  .g-thumb { width: 160px; }
  .g-row { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
  .g-dialog { position: static; transform: none; margin: 0; }
</style>
</head>
<body>
<div class="g-grid">
${renderToStaticMarkup(
  <>
    {frames.includes(1) ? <Frame title="1. Base band" band="base" /> : null}
    {frames.includes(2) ? <Frame title="2. Alternate band" band="alt" /> : null}
    {frames.includes(3) ? <Frame title="3. Card on the base band" band="base" wrap="card" /> : null}
    {frames.includes(4) ? (
      <Frame title="4. Card on the alternate band" band="alt" wrap="card" />
    ) : null}
    {frames.includes(5) ? <Frame title="5. Dialog surface" band="base" wrap="dialog" /> : null}
    {frames.includes(6) ? (
      <Frame title="6. Staff look (no data-ui): must not change" v2={false} />
    ) : null}
  </>,
)}
</div>
</body>
</html>
`;
writeFileSync(outPath, gallery);
console.log('wrote', outPath);
