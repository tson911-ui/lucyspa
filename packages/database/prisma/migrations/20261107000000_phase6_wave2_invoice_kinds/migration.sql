-- Phase 6 P6-8 (Wave 2: product lines on invoices), migration 1 of 2: enum values only.
-- A new enum value cannot be used in the transaction that adds it, so the two values are committed on their own here (as
-- 20261101000000_phase5_combo_sale_line_kind did) and the migration that follows (20261107000001) builds everything that
-- refers to them. Nothing else changes; every existing invoice stays a VISIT or a COMBO_SALE.
--   * InvoiceKind PRODUCT_SALE: an invoice that holds product lines only and is not tied to a Visit (design 5.1, T20).
--   * InvoiceLineKind PRODUCT: a line for a product variant (design 5.2).

ALTER TYPE "InvoiceKind" ADD VALUE 'PRODUCT_SALE';
ALTER TYPE "InvoiceLineKind" ADD VALUE 'PRODUCT';
