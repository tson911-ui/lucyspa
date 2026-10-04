# Lấy thực đơn thật và chi nhánh từ production để duyệt giao diện (chỉ đọc)

**Mục đích:** mọi ảnh duyệt giao diện phải dùng đúng thực đơn và tên chi nhánh của Lucy Spa, không dùng dữ liệu tự bịa. Cách an toàn nhất là xuất **ba danh sách** ra một tệp JSON nhỏ, rồi nạp vào cơ sở dữ liệu thử (scratch) trên máy dev.

**Trong tệp có:**

- chi nhánh: **chỉ mã, tên và trạng thái hoạt động** (không có địa chỉ, quản lý, nhân viên);
- nhóm dịch vụ: mã, tên (VI/EN), thứ tự, trạng thái;
- dịch vụ: mã, nhóm, tên (VI/EN), mô tả (VI/EN), giá, đơn vị tính, thời lượng và trạng thái.

**Không có trong tệp:** khách hàng, nhân viên, tài khoản, mật khẩu, lịch hẹn, hóa đơn, thanh toán, ảnh, số điện thoại, email. Lệnh chỉ đọc: cơ sở dữ liệu từ chối mọi lệnh ghi (đã thử: `cannot execute UPDATE in a read-only transaction`). Không dùng `pg_dump`, không tạo tệp truy vấn trên máy chủ.

Làm trên terminal iNET, **mỗi bước là đúng một lệnh**, chạy lần lượt.

## Bước 1. Xuất dữ liệu (một lệnh, chế độ chỉ đọc)

```
docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' > /root/catalog-export.json <<'SQL'
select json_build_object(
  'branches', (select coalesce(json_agg(json_build_object('code', code, 'name', name, 'isActive', is_active) order by code), '[]'::json) from branches),
  'categories', (select coalesce(json_agg(json_build_object('code', code, 'nameVi', name_vi, 'nameEn', name_en, 'sortOrder', sort_order, 'isActive', is_active) order by sort_order, code), '[]'::json) from service_categories),
  'services', (select coalesce(json_agg(json_build_object('code', s.code, 'categoryCode', c.code, 'nameVi', s.name_vi, 'nameEn', s.name_en, 'descriptionVi', s.description_vi, 'descriptionEn', s.description_en, 'priceVnd', s.price_vnd::text, 'priceMaxVnd', s.price_max_vnd::text, 'pricingUnit', s.pricing_unit, 'maxQuantity', s.max_quantity, 'durationMinutes', s.duration_minutes, 'estimatedMinMinutes', s.estimated_min_minutes, 'estimatedMaxMinutes', s.estimated_max_minutes, 'isActive', s.is_active) order by c.sort_order, c.code, s.price_vnd, s.code), '[]'::json) from services s join service_categories c on c.id = s.category_id)
);
SQL
```

Lệnh này không in gì ra màn hình; kết quả nằm trong `/root/catalog-export.json`.

## Bước 2. Kiểm tra tệp đã tạo

```
ls -l /root/catalog-export.json
```

**Mong đợi:** một dòng, dung lượng vài KB đến vài chục KB (không phải 0).

## Bước 3. Lấy ba con số để đối chiếu

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from branches) as chi_nhanh, (select count(*) from service_categories) as nhom, (select count(*) from services) as dich_vu"'
```

**Mong đợi:** một dòng dạng `2|6|52` (chi nhánh|nhóm|dịch vụ). Ghi lại.

## Bước 4. In nội dung để gửi

```
cat /root/catalog-export.json
```

Copy toàn bộ một dòng JSON in ra, dán vào cuộc trò chuyện cùng ba con số ở Bước 3. Nếu quá dài để dán, báo để chia nhỏ theo nhóm.

## Bước 5. Xóa tệp trên máy chủ

```
rm /root/catalog-export.json
```

## Sau đó (phía dev)

Tệp được lưu vào `.local/catalog-export.json` (không commit). `node .local/p3-import-catalog.mjs --dry-run` kiểm tra tệp và số lượng (cả ba danh sách), rồi chạy không có `--dry-run` để nạp **chỉ vào DB scratch**:

- nhóm và dịch vụ được thêm hoặc cập nhật theo mã; mọi dịch vụ khác trong scratch bị ẩn (không xóa, vì lịch hẹn thử còn tham chiếu); mỗi dịch vụ được mở ở các chi nhánh thử;
- chi nhánh thật (đang hoạt động, xếp theo mã) lần lượt thay tên và mã của các chi nhánh thử **tại chỗ** (nhân viên và lịch hẹn thử vẫn dùng được); chi nhánh thử dư bị ẩn; chi nhánh thật nhiều hơn được thêm với giờ mở cửa sao từ chi nhánh thử đầu tiên.

Không bao giờ ghi vào DB dev hay production. Mô tả nhóm nổi bật không được tự viết: Chủ tiệm tự nhập trong Admin > Website > Thông tin tiệm. Giờ mở cửa và nhân viên trong scratch vẫn là dữ liệu thử.
