/**
 * The 20 products of the first real sample of haruohui.com (the supplier's own titles and category names, read 2026-10-10/11 by the sample scan;
 * the supplier gave the Owner permission to use its content). A test fixture for the automatic brand and category rules.
 */
export const HARUOHUI_SAMPLE: readonly {
  key: string;
  name: string;
  categories: readonly string[];
  sku: string | null;
}[] = [
  {
    key: '323',
    name: 'Nước hoa hồng tái sinh da Ohui The First Skin Softener',
    categories: ['Chăm Sóc Da Mặt', 'Nước Hoa Hồng', 'OHUI', 'Ohui Tái sinh The First'],
    sku: '50709298',
  },
  {
    key: '324',
    name: 'Sữa rửa mặt chống lão hóa da tái sinh da OHUI The First Geniture Foam Cleanser',
    categories: ['Chăm Sóc Da Mặt', 'OHUI', 'Ohui Tái sinh The First', 'Sữa rửa mặt'],
    sku: '50708207',
  },
  {
    key: '325',
    name: 'Sữa dưỡng chống lão hóa tái sinh da Ohui The First Emulsion',
    categories: ['Chăm Sóc Da Mặt', 'OHUI', 'Ohui Tái sinh The First', 'Sữa Dưỡng'],
    sku: '50709299',
  },
  {
    key: '330',
    name: 'Sữa dưỡng cải thiện nếp nhăn Ohui Age Recovery Emulsion',
    categories: ['Chăm Sóc Da Mặt', 'OHUI', 'Ohui Tím Age Recovery', 'Sữa Dưỡng'],
    sku: '50708586',
  },
  {
    key: '332',
    name: 'Tinh chất cải thiện nếp nhăn Ohui Age Recovery Essence',
    categories: ['Chăm Sóc Da Mặt', 'OHUI', 'Ohui Tím Age Recovery', 'Tinh Chất'],
    sku: '50708587',
  },
  {
    key: '333',
    name: 'Sữa Rửa Mặt Ohui Age Recovery Soft Amino Foam',
    categories: ['Chăm Sóc Da Mặt', 'OHUI', 'Ohui Tím Age Recovery', 'Sữa rửa mặt'],
    sku: '50709045',
  },
  {
    key: '335',
    name: 'Dầu tẩy trang giàu ẩm Ohui Miracle Moisture Cleansing Oil',
    categories: ['Chăm Sóc Da Mặt', 'OHUI', 'OHUI hồng Miracle Moisture', 'Tẩy Trang'],
    sku: '50709546',
  },
  {
    key: '336',
    name: 'Sữa rửa mặt dưỡng ẩm Ohui Miracle Moisture Cleansing Foam',
    categories: ['Chăm Sóc Da Mặt', 'OHUI', 'OHUI hồng Miracle Moisture', 'Sữa rửa mặt'],
    sku: '50709513',
  },
  {
    key: '337',
    name: 'Sữa dưỡng da ẩm mượt Ohui Miracle Moisture Emulsion',
    categories: ['Chăm Sóc Da Mặt', 'OHUI', 'OHUI hồng Miracle Moisture', 'Sữa Dưỡng'],
    sku: '50709422',
  },
  {
    key: '339',
    name: 'Nước cân bằng dưỡng ẩm Ohui Miracle Moisture Skin Softener (Moist)',
    categories: ['Chăm Sóc Da Mặt', 'Nước Hoa Hồng', 'OHUI', 'OHUI hồng Miracle Moisture'],
    sku: '50709421',
  },
  {
    key: '340',
    name: 'Set Tinh chất siêu cấp ẩm Ohui Miracle Moisture Ampoule 777 14 Ống',
    categories: ['Ampoule huyết thanh', 'Chăm Sóc Da Mặt', 'OHUI', 'OHUI hồng Miracle Moisture'],
    sku: '50709434',
  },
  {
    key: '341',
    name: 'Kem dưỡng ẩm sâu Ohui Miracle Moisture Cream',
    categories: ['Chăm Sóc Da Mặt', 'Kem Dưỡng', 'OHUI', 'OHUI hồng Miracle Moisture'],
    sku: '50709423',
  },
  {
    key: '342',
    name: 'Sữa Rửa Mặt Dưỡng Sáng Da Ohui Miracle Toning Jelly Cleanser',
    categories: ['Chăm Sóc Da Mặt', 'OHUI', 'Ohui Vàng Miracle Toning', 'Sữa rửa mặt'],
    sku: '50709431',
  },
  {
    key: '343',
    name: 'Tinh Chất Dưỡng Sáng Ohui Miracle Toning Glow Serum',
    categories: ['Chăm Sóc Da Mặt', 'OHUI', 'Ohui Vàng Miracle Toning', 'Tinh Chất'],
    sku: '50709303',
  },
  {
    key: '344',
    name: 'Bông dưỡng đa năng Ohui Miracle Toning Water Pad',
    categories: ['Chăm Sóc Da Mặt', 'Mặt Nạ', 'OHUI', 'Ohui Vàng Miracle Toning'],
    sku: '50709370',
  },
  {
    key: '345',
    name: 'Nước hoa hồng dưỡng trắng da Ohui Extreme White Skin Softener',
    categories: ['Chăm Sóc Da Mặt', 'Nước Hoa Hồng', 'OHUI', 'Ohui Trắng Da Extreme White'],
    sku: 'nuoc-hoa-hong-duong-trang-da-ohui-extreme-white-skin-softener',
  },
  {
    key: '346',
    name: 'Tẩy tế bào chết dưỡng trắng da Ohui Extreme White Bright Peeling',
    categories: ['Chăm Sóc Da Mặt', 'OHUI', 'Ohui Trắng Da Extreme White', 'Tẩy Tế Bào Da Chết'],
    sku: '50709442',
  },
  {
    key: '348',
    name: 'Mặt nạ dưỡng trắng Ohui Extreme White 3D Black Mask',
    categories: ['Chăm Sóc Da Mặt', 'Mặt Nạ', 'OHUI', 'Ohui Trắng Da Extreme White'],
    sku: 'mat-na-duong-trang-ohui-extreme-white-3d-black-mask',
  },
  {
    key: '350',
    name: 'Sữa dưỡng trắng da Ohui Extreme White Emulsion',
    categories: ['Chăm Sóc Da Mặt', 'OHUI', 'Ohui Trắng Da Extreme White', 'Sữa Dưỡng'],
    sku: '50707736',
  },
  {
    key: '351',
    name: 'Kem Dưỡng Da Ohui Extreme White MelaToning Cream 60ml',
    categories: ['Chăm Sóc Da Mặt', 'Kem Dưỡng', 'OHUI', 'Ohui Trắng Da Extreme White'],
    sku: '50709236',
  },
];
