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
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  LoadingState,
  Notice,
  NumberInput,
  PasswordInput,
  ProgressBar,
  RadioGroup,
  SearchInput,
  Select,
  Skeleton,
  Spinner,
  Switch,
  TextInput,
  Textarea,
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

function Surfaces() {
  return (
    <div className="g-stack">
      <Card>
        <CardHeader title="Gói chăm sóc da mặt" description="60 phút, có tư vấn da." />
        <p>Làm sạch sâu, đắp mặt nạ và massage thư giãn vùng mặt, cổ và vai.</p>
      </Card>
      <div className="g-row">
        <Badge tone="brand">Bán chạy</Badge>
        <Badge tone="neutral">Mới</Badge>
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
      <Notice tone="info">Lịch hẹn được giữ trong 15 phút.</Notice>
      <Notice tone="success">Đã đặt lịch thành công.</Notice>
      <Notice tone="warning">Chi nhánh nghỉ lễ ngày 20/10.</Notice>
      <Notice tone="danger">Không tải được lịch trống. Thử lại sau ít phút.</Notice>
      <div className="g-row">
        <Spinner />
        <Skeleton lines={3} />
      </div>
      <LoadingState label="Đang tải dịch vụ" rows={3} />
      <ProgressBar value={60} label="Tiến độ đặt lịch" />
      <ProgressBar label="Đang xử lý" />
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

function Overlays() {
  return <div className="g-stack">Overlays are added with C6.</div>;
}

const SECTIONS: Record<string, () => ReactNode> = {
  controls: Controls,
  surfaces: Surfaces,
  overlays: Overlays,
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
  const body = <Specimen />;
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
  .g-row { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; }
  .g-dialog { position: static; transform: none; margin: 0; }
  .g-stage { position: relative; min-height: 620px; transform: translateZ(0); overflow: hidden; }
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
