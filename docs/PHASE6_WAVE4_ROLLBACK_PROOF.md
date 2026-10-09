# Phase 6 Đợt 4: bằng chứng quay lui (2026-10-09, chạy trên máy này, chỉ cơ sở dữ liệu thử)

**Câu hỏi:** nếu sau khi deploy Đợt 4 (một lần: migration `20261120000000` rồi `20261121000000` đến `20261124000000`, 95 thành 101; quyền vẫn **66**) phải đưa phần mềm về bản đang chạy thật (`43a1b29`, Đợt 3b), bản cũ có chạy được không, cái gì hỏng, và cổng nào chặn? **Trả lời ngắn: có, nhưng chỉ khi chưa có đơn online nào và không có khuyến mãi đã đăng còn hiệu lực.** Chỉ cần **một** đơn online (chưa trả tiền hay đã hủy cũng vậy) thì bản cũ hỏng: bảng POS, mọi hóa đơn, hàng đợi đặt trước của chi nhánh nhận đơn online đều lỗi 503. Khi đó phải **sửa tiếp (đi tới)** hoặc khôi phục sao lưu (mất dữ liệu sau lúc sao lưu). Không có bước xóa dòng quyền (khác Đợt 3b): đã kiểm không migration nào thêm quyền, bản cũ in "0 inserted, 66 already present".

## Đã chạy gì

- Bản cũ `43a1b29` ở `D:/lucy-spa-wave3b-old`, không có `.env`; mọi tiến trình chỉ trỏ vào cơ sở dữ liệu thử (kiểm bằng `pg_stat_activity`), Redis chỉ số 7 cho các tiến trình dịch vụ. Bản mới: API dựng sẵn; worker **tôi dựng lại riêng** (bản dựng sẵn cũ hơn mã: thiếu quét 08:00 và hủy đơn quá hạn).
- Sáu cơ sở dữ liệu: **sạch** (101 migration, chưa dữ liệu), **tắt** (bản sao dữ liệu 3b 95 migration + 6 migration mới + API và worker mới chạy 90 giây, "Bán online" tắt), **mở rồi đóng** (thêm 2 giỏ, 1 hãng vận chuyển, rồi tắt; chưa đơn nào), **có dữ liệu Đợt 4**, bản sao của nó thêm 3 đơn chưa xử lý, và bản giống thật (20.000 hóa đơn, 300.000 thông báo) cho Cách B.
- Dữ liệu Đợt 4 tạo bằng API mới qua HTTP (`.local/w4-rollback/seed-w4.mjs`): 10 đơn online (2 chưa trả, 2 đã trả, 1 đã giao rồi khách trả hàng có phí gửi trả, 1 khách tự xác nhận nhận hàng, 1 đã gửi, 1 giao thất bại rồi hàng về rồi quyết toán, 1 khách hủy chưa trả, 1 nhân viên hủy dòng đã trả có hoàn tiền), 1 khuyến mãi đã đăng đang chạy định giá 1 đơn, 16 thông báo `ONLINE_ORDER_*`, 1 hoàn tiền một phần của migration 96.

## Kết quả

| Việc                                                                                                                               | Kết quả                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration 95 thành 101 trên bản sao có dữ liệu 3b, và trên bản giống thật 20.000 hóa đơn                                           | thành công; 4 giây trên bản giống thật; quyền vẫn 66                                                                                                             |
| Bộ kiểm thử cơ sở dữ liệu của **bản cũ** trên cơ sở dữ liệu **sạch** 101 migration                                                 | 135 bài: **133 đạt, 1 lỗi** (đổi câu chữ: "...handed over, sold **or delivered**"; ràng buộc vẫn chặn đúng)                                                      |
| Bộ kiểm thử API của bản cũ trên cùng cơ sở dữ liệu sạch                                                                            | 886 bài: **883 đạt, 1 lỗi, 1 bỏ qua**; lỗi là bài tạo hóa đơn `ONLINE` không có đơn bằng cách tắt trigger, điều Đợt 4 cấm (đồ thử, không phải hành vi chạy thật) |
| Máy khách Prisma cũ đọc mọi bảng: sạch / tắt / 20.000 hóa đơn                                                                      | **141 trên 141** cả ba                                                                                                                                           |
| Cùng phép đọc trên cơ sở dữ liệu có dữ liệu Đợt 4                                                                                  | 139 trên 141; hỏng `ProductOrderLine` và `ProductOrderEvent` ("Value 'SHIPPED' not found in enum")                                                               |
| API cũ chạy trên cơ sở dữ liệu **tắt** (19 phép đọc: bảng POS, 5 tab hàng đợi, kho, sản phẩm, quà, thông báo) và worker cũ 80 giây | tất cả 19 trả 200; worker chỉ 4 lỗi "Inventory sales job failed" đã có sẵn trong dữ liệu xem thử (worker mới cho đúng số lỗi đó), không lỗi mới                  |
| API và worker cũ trên cơ sở dữ liệu sạch và trên bản khôi phục từ sao lưu                                                          | `/health/ready`, sản phẩm công khai, dịch vụ đều 200; không lỗi, không cảnh báo mới                                                                              |
| `db:permissions:sync` của bản cũ trên sạch, tắt, có dữ liệu                                                                        | "0 inserted, 66 already present"                                                                                                                                 |

**API cũ trên cơ sở dữ liệu có dữ liệu Đợt 4 (tài khoản Owner và khách, chỉ đọc; 26 trả 200, 19 trả 503):**

| Hỏng (503)                                                                                                                                                                                                                | Nguyên nhân                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Bảng POS của chi nhánh nhận đơn online; chi tiết **cả 10** hóa đơn online (kể cả chưa trả và đã hủy)                                                                                                                      | dòng hàng online không có người bán (`seller_user_id` giờ cho trống); mã cũ đọc `seller.fullName` |
| Cả 5 tab hàng đợi đặt trước của chi nhánh đó; chi tiết đơn có dòng đã gửi hay giao thất bại; hóa đơn của khách cho đơn đã gửi                                                                                             | như trên và giá trị `SHIPPED`, `DELIVERY_FAILED` mà bản cũ không biết                             |
| **Vẫn 200:** bảng POS của chi nhánh khác, kho, sản phẩm, quà, hộp thông báo (loại `ONLINE_ORDER_*` đi qua; **web cũ hiển thị ra sao chưa thử**), danh sách hóa đơn và điểm của khách, hoàn tiền một phần của migration 96 |                                                                                                   |

Worker cũ trên đơn online mới: **hóa đơn đã trả mà chưa gửi kẹt mãi** ở việc kho (ràng buộc mới: hàng online chỉ "bán" khi dòng đã gửi; lỗi lặp mỗi vòng), và sự kiện **đã gửi không có ai xử lý**: kho của hàng đã giao không bao giờ trừ (lệch sổ kho). **Khuyến mãi:** `lucy_variant_price_at` đã đọc bảng khuyến mãi, nên quầy cũ vẫn bán giá khuyến mãi (136.000 thay 170.000, `onPromotion` false) và **không có màn nào để tắt**; không phụ thuộc công tắc "Bán online". Bản nháp thì không ảnh hưởng. Chưa chạy thao tác ghi bán hàng ở quầy cũ trên dữ liệu khuyến mãi (chỉ thấy giá niêm yết).

**Công tắc tắt thì không có dữ liệu Đợt 4**, trừ vài hàng vô hại: worker mới ghi `online_order_scans` mỗi chi nhánh mỗi ngày ("NOTHING_TO_REPORT", đã thấy), nên **không** đưa bảng đó vào cổng.

## Thứ tự quay lui đã kiểm

0. **Cổng kiểm** (chép nguyên; chạy khi Đợt 4 đã áp, tức đủ 101 migration). Quay lui chỉ khi **cả mười một số bằng 0**: đơn online, hóa đơn online, dòng không người bán, dòng đã gửi hay giao thất bại, vận đơn, nhật ký giao hàng, quyết toán giao thất bại, phí trả hàng, hoàn tiền theo quyết toán, khuyến mãi đã đăng còn hiệu lực hay sắp chạy, thông báo online:

```
docker exec lucy-spa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "select (select count(*) from product_orders where channel = \$\$ONLINE\$\$) as don_online, (select count(*) from invoices where channel = \$\$ONLINE\$\$) as hoa_don_online, (select count(*) from invoice_line_products where seller_user_id is null) as dong_khong_nguoi_ban, (select count(*) from product_order_lines where status = \$\$SHIPPED\$\$ or cancel_cause = \$\$DELIVERY_FAILED\$\$ or shipped_at is not null or delivered_at is not null) as dong_da_giao, (select count(*) from online_shipments) as van_don, (select count(*) from online_order_logs) as nhat_ky_giao_hang, (select count(*) from online_failed_delivery_settlements) as quyet_toan_giao_that_bai, (select count(*) from online_return_costs) as phi_tra_hang, (select count(*) from product_refunds where settlement_id is not null) as hoan_tien_quyet_toan, (select count(*) from product_campaigns where published_at is not null and coalesce(ended_early_at, ends_at) > now()) as khuyen_mai_con_hieu_luc, (select count(*) from notifications where type like \$\$ONLINE_ORDER_%\$\$) as thong_bao_online"'
```

Đã chạy đúng câu này (chỉ đổi `"$POSTGRES_DB"` thành tên cơ sở dữ liệu thử): **sạch, tắt, mở rồi đóng: `0|0|0|0|0|0|0|0|0|0|0`**; có dữ liệu Đợt 4: `10|10|10|4|4|5|1|1|1|1|16` (chặn đúng; kết thúc sớm khuyến mãi thì số thứ mười một về 0); bản sao thêm 3 đơn: `13|13|13|5|5|5|1|1|1|1|17`.

1. Tắt "Bán online" ở màn quản lý (chặn đơn mới), chạy cổng lần 1. **Dừng** `lucyspa-api`, `lucyspa-worker`, `lucyspa-web`, chạy cổng **lần 2** (không còn tiến trình nào ghi). Cả hai lần phải `0`.
2. Chờ hai bộ xử lý nền hết việc (hai câu cuối Bước 7 của hướng dẫn 3b về `0`).
3. `git checkout 43a1b29...` (mã đầy đủ trong hướng dẫn), `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm build`, khởi động lại ba tiến trình, `pnpm db:permissions:sync` in "0 inserted, 66 already present". **Không có bước xóa quyền.**
4. **Không quay cơ sở dữ liệu.** Bảng, cột, hàm, kiểu mới ở lại (chỉ thêm); lần deploy sau không cần migration. Còn lại vô hại: bảng rỗng, giỏ và địa chỉ đã lưu, hãng vận chuyển, bản nháp khuyến mãi, hàng `online_order_scans`, khuyến mãi đã hết hạn hay đã kết thúc, hóa đơn đã được khuyến mãi định giá (bản cũ đọc được).

**Cách B (khôi phục sao lưu trước deploy) đã thử:** `pg_dump -Fc` bản giống thật (95 migration, 66 quyền, 20.000 hóa đơn, 300.000 thông báo) 10 giây, 45 MB; khôi phục vào bản sao, `db:deploy` 4 giây lên 101; rồi `dropdb`, `createdb`, `pg_restore` 16 giây, thoát 0, về đúng 95 migration, 66 quyền, 20.000 hóa đơn; API và worker cũ chạy sạch trên đó. **Mất mọi dữ liệu phát sinh sau lúc sao lưu.**

## Không thể hoàn tác / chưa chứng minh

- Đơn online đã có **không xóa được** và bản cũ **không đọc được hết**: sau đơn online đầu tiên, quay lui phần mềm không còn là lựa chọn. Khuyến mãi đã đăng: kết thúc sớm bằng bản mới trước khi quay lui.
- **Chưa thử:** web cũ (Next) và pm2 trên máy chủ Linux thật; ghi ở quầy cũ trên dữ liệu khuyến mãi hay trên chi nhánh có đơn online (chỉ đọc, và đoán từ phép đọc hỏng); hộp thông báo của web cũ với loại mới; hoàn tiền một phần (migration 96) chỉ thử đọc bằng API cũ; chạy Windows, không phải Linux. Cổng kiểm là bảo hiểm cho những điều đó.
- Hai bài lỗi của bản cũ ở trên là đồ thử lỗi thời, đã giải thích; lỗi worker còn lại có sẵn trong dữ liệu xem thử.
