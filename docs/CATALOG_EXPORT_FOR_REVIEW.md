# Lấy thực đơn thật từ production để duyệt giao diện (chỉ đọc, chỉ danh mục)

**Mục đích:** mọi ảnh duyệt giao diện phải dùng đúng thực đơn của Lucy Spa, không dùng dịch vụ tự bịa. Cách an toàn nhất là xuất **hai bảng danh mục** (`service_categories` và `services`) từ production ra một tệp JSON nhỏ, rồi nạp vào cơ sở dữ liệu thử (scratch) trên máy dev.

**Không có trong tệp:** khách hàng, nhân viên, lịch hẹn, hóa đơn, thanh toán, mật khẩu, ảnh. Chỉ có mã, tên (VI/EN), mô tả, giá, thời lượng và trạng thái hoạt động của nhóm và dịch vụ. Lệnh chạy ở chế độ **chỉ đọc**: cơ sở dữ liệu từ chối mọi lệnh ghi (đã thử: `cannot execute UPDATE in a read-only transaction`). Không dùng `pg_dump`, không đụng bảng nào khác.

Làm trên terminal iNET, từng lệnh một.

## Bước 1. Tạo tệp truy vấn (chỉ có lệnh `select`)

```
cat > /root/catalog-export.sql <<'SQL'
select json_build_object(
  'categories', (select coalesce(json_agg(json_build_object('code', code, 'nameVi', name_vi, 'nameEn', name_en, 'sortOrder', sort_order, 'isActive', is_active) order by sort_order, code), '[]'::json) from service_categories),
  'services', (select coalesce(json_agg(json_build_object('code', s.code, 'categoryCode', c.code, 'nameVi', s.name_vi, 'nameEn', s.name_en, 'descriptionVi', s.description_vi, 'descriptionEn', s.description_en, 'priceVnd', s.price_vnd::text, 'priceMaxVnd', s.price_max_vnd::text, 'pricingUnit', s.pricing_unit, 'maxQuantity', s.max_quantity, 'durationMinutes', s.duration_minutes, 'estimatedMinMinutes', s.estimated_min_minutes, 'estimatedMaxMinutes', s.estimated_max_minutes, 'isActive', s.is_active) order by c.sort_order, c.code, s.price_vnd, s.code), '[]'::json) from services s join service_categories c on c.id = s.category_id)
);
SQL
```

## Bước 2. Chạy ở chế độ chỉ đọc

```
docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' < /root/catalog-export.sql > /root/catalog-export.json
```

## Bước 3. Kiểm tra

```
ls -l /root/catalog-export.json
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from service_categories) as nhom, (select count(*) from services) as dich_vu"'
```

**Mong đợi:** tệp vài KB đến vài chục KB, và một dòng dạng `6|52` (số nhóm|số dịch vụ). Ghi lại hai số này.

## Bước 4. Gửi tệp

Chạy `cat /root/catalog-export.json`, copy toàn bộ một dòng JSON in ra và dán vào cuộc trò chuyện cùng hai con số ở Bước 3. Nếu quá dài, chia theo nhóm.

## Bước 5. Dọn trên máy chủ

```
rm /root/catalog-export.json /root/catalog-export.sql
```

## Sau đó (phía dev)

Tệp được lưu vào `.local/catalog-export.json` (không commit). `node .local/p3-import-catalog.mjs --dry-run` kiểm tra tệp và số lượng, rồi chạy không có `--dry-run` để nạp **chỉ vào DB scratch**: nhóm và dịch vụ được thêm hoặc cập nhật theo mã, mọi dịch vụ khác trong scratch bị ẩn (không xóa, vì lịch hẹn thử còn tham chiếu), mỗi dịch vụ được mở ở các chi nhánh thử. Không bao giờ ghi vào DB dev hay production. Mô tả nhóm nổi bật không được tự viết: Chủ tiệm tự nhập trong Admin > Website > Thông tin tiệm.
