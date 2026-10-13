-- Claude integration Wave B, migration 2 of 2 (design `docs/PHASE_CLAUDE_INTEGRATION.md` sections 6.3, 7, 9.4; Owner message of 2026-10-13):
--   1. the catalog semantics of the three new permission codes;
--   2. the per-feature switches and models of the AI settings (chat, SEO and English drafts, report assistant, customer brief);
--   3. `chat_callback_requests`: what the website chat stores when it cannot answer ("Để lại số điện thoại, tiệm sẽ gọi lại");
--   4. the notification type that tells the holders of MANAGE_CHAT_REQUESTS.
-- Additive: no existing row can violate a widened check, nothing is granted to anybody, every new switch starts off.

-- ------------------------------------------------------------------------------------------------------------ catalog semantics
-- MANAGE_CHAT_REQUESTS and USE_AI_ASSISTANT are GLOBAL_ONLY; VIEW_CUSTOMER_BRIEF is BRANCH_CAPABLE (a branch-scoped holder sees only
-- the bookings of that branch, on top of the "assigned staff, time window" rule). All three are STANDARD, like every other code that is in
-- no data-classification list (a brief is read through the relationship rule, never through the classification).
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_catalog_semantics";
ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_catalog_semantics" CHECK (
    (("code" IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS',
          'MANAGE_WEBSITE_CONTENT', 'ADJUST_LOYALTY_POINTS', 'MANAGE_COMBOS', 'RESTORE_COMBO_SESSIONS',
          'MANAGE_BIRTHDAY_REWARDS', 'MANAGE_REWARD_CATALOG', 'VIEW_LOYALTY_EXCEPTIONS', 'ACTIVATE_LOYALTY',
          'CHANGE_REFERRER', 'MANAGE_PRODUCTS', 'MANAGE_PRODUCT_PRICES', 'VIEW_PRODUCT_COST', 'IMPORT_PRODUCT_DATA',
          'MANAGE_PRODUCT_CAMPAIGNS', 'MANAGE_SUPPLIER_SOURCES', 'REVIEW_SUPPLIER_IMPORTS',
          'MANAGE_PAY_RULES', 'MANAGE_PAYROLL', 'APPROVE_PAYROLL', 'VIEW_PROFIT', 'MANAGE_AI_SETTINGS', 'USE_AI_CONTENT',
          'MANAGE_CHAT_REQUESTS', 'USE_AI_ASSISTANT')
        AND "scope_capability" = 'GLOBAL_ONLY')
      OR ("code" NOT IN ('MANAGE_SERVICE_PRICES', 'MANAGE_BOOKING_SETTINGS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS',
          'MANAGE_WEBSITE_CONTENT', 'ADJUST_LOYALTY_POINTS', 'MANAGE_COMBOS', 'RESTORE_COMBO_SESSIONS',
          'MANAGE_BIRTHDAY_REWARDS', 'MANAGE_REWARD_CATALOG', 'VIEW_LOYALTY_EXCEPTIONS', 'ACTIVATE_LOYALTY',
          'CHANGE_REFERRER', 'MANAGE_PRODUCTS', 'MANAGE_PRODUCT_PRICES', 'VIEW_PRODUCT_COST', 'IMPORT_PRODUCT_DATA',
          'MANAGE_PRODUCT_CAMPAIGNS', 'MANAGE_SUPPLIER_SOURCES', 'REVIEW_SUPPLIER_IMPORTS',
          'MANAGE_PAY_RULES', 'MANAGE_PAYROLL', 'APPROVE_PAYROLL', 'VIEW_PROFIT', 'MANAGE_AI_SETTINGS', 'USE_AI_CONTENT',
          'MANAGE_CHAT_REQUESTS', 'USE_AI_ASSISTANT')
        AND "scope_capability" = 'BRANCH_CAPABLE'))
    AND (("code" IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY', 'MANAGE_PAY_RULES', 'MANAGE_PAYROLL', 'APPROVE_PAYROLL') AND "data_classification" = 'EMPLOYEE_PAY')
      OR ("code" IN ('VIEW_INVOICES', 'MANAGE_INVOICES', 'COLLECT_PAYMENTS', 'APPLY_DISCOUNTS',
          'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS', 'CANCEL_INVOICES', 'CORRECT_PAYMENTS', 'VIEW_REVENUE',
          'ADJUST_LOYALTY_POINTS', 'RESTORE_COMBO_SESSIONS', 'MANAGE_PRODUCT_PRICES', 'VIEW_PRODUCT_COST',
          'MANAGE_STOCK_RECEIPTS', 'IMPORT_PRODUCT_DATA', 'REFUND_PRODUCTS', 'MANAGE_PRODUCT_CAMPAIGNS', 'VIEW_CASH', 'MANAGE_CASH',
          'EXPORT_REPORTS', 'VIEW_PROFIT')
        AND "data_classification" = 'FINANCIAL')
      OR ("code" NOT IN ('VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY', 'MANAGE_PAY_RULES', 'MANAGE_PAYROLL', 'APPROVE_PAYROLL', 'VIEW_INVOICES', 'MANAGE_INVOICES',
          'COLLECT_PAYMENTS', 'APPLY_DISCOUNTS', 'MANAGE_DISCOUNTS', 'CREATE_VOUCHERS', 'CANCEL_INVOICES',
          'CORRECT_PAYMENTS', 'VIEW_REVENUE', 'ADJUST_LOYALTY_POINTS', 'RESTORE_COMBO_SESSIONS',
          'MANAGE_PRODUCT_PRICES', 'VIEW_PRODUCT_COST', 'MANAGE_STOCK_RECEIPTS', 'IMPORT_PRODUCT_DATA',
          'REFUND_PRODUCTS', 'MANAGE_PRODUCT_CAMPAIGNS', 'VIEW_CASH', 'MANAGE_CASH', 'EXPORT_REPORTS', 'VIEW_PROFIT')
        AND "data_classification" = 'STANDARD'))
  );

-- ------------------------------------------------------------------------------------------------------------------ AI settings
-- Every switch starts OFF. The chat relays at most `chat_daily_cap` messages a day (Owner answer OQ-CI-6: 300); a model per feature is
-- chosen from the same three ids as the rewrite. The report assistant and the customer brief default to Sonnet, the SEO drafts to Opus
-- (design 5.2).
ALTER TABLE "ai_settings"
  ADD COLUMN "chat_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "chat_daily_cap" INTEGER NOT NULL DEFAULT 300,
  ADD COLUMN "seo_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "seo_model" TEXT NOT NULL DEFAULT 'claude-opus-5-5',
  ADD COLUMN "assistant_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "assistant_model" TEXT NOT NULL DEFAULT 'claude-sonnet-5-5',
  ADD COLUMN "brief_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "brief_model" TEXT NOT NULL DEFAULT 'claude-sonnet-5-5',
  ADD CONSTRAINT "ai_settings_chat_cap" CHECK ("chat_daily_cap" BETWEEN 0 AND 5000),
  ADD CONSTRAINT "ai_settings_models" CHECK (
    "seo_model" IN ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5')
    AND "assistant_model" IN ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5')
    AND "brief_model" IN ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'));

-- ------------------------------------------------------------------------------------------------------------ callback requests
-- A visitor's "please call me back" (design 6.3): stored only when the bot cannot answer. The chat transcript is never stored. The phone,
-- name and note are cleared 90 days after the request is closed (the worker sets `purged_at`; the counts stay). Staff with
-- MANAGE_CHAT_REQUESTS mark a request called or closed; nothing is sent to the visitor automatically.
CREATE TABLE "chat_callback_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "reason" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'vi',
    "phone" TEXT,
    "name" TEXT,
    "note" TEXT,
    "preferred_branch_id" UUID,
    "handled_by_user_id" UUID,
    "handled_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "purged_at" TIMESTAMPTZ(3),
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "chat_callback_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_callback_requests_status" CHECK ("status" IN ('NEW', 'CALLED', 'CLOSED')),
    CONSTRAINT "chat_callback_requests_reason" CHECK ("reason" IN ('N8N_DOWN', 'CAP_REACHED', 'OFF', 'VISITOR')),
    CONSTRAINT "chat_callback_requests_locale" CHECK ("locale" IN ('vi', 'en')),
    CONSTRAINT "chat_callback_requests_phone" CHECK ("phone" IS NULL OR char_length("phone") BETWEEN 8 AND 20),
    CONSTRAINT "chat_callback_requests_name" CHECK ("name" IS NULL OR char_length("name") <= 80),
    CONSTRAINT "chat_callback_requests_note" CHECK ("note" IS NULL OR char_length("note") <= 500),
    -- A request keeps its phone until it is purged; a purged one has no phone, name or note.
    CONSTRAINT "chat_callback_requests_purge" CHECK (
      ("purged_at" IS NULL) = ("phone" IS NOT NULL) AND ("purged_at" IS NULL OR ("name" IS NULL AND "note" IS NULL))),
    CONSTRAINT "chat_callback_requests_closed" CHECK (("status" = 'CLOSED') = ("closed_at" IS NOT NULL)),
    CONSTRAINT "chat_callback_requests_handled" CHECK (("handled_at" IS NULL) = ("handled_by_user_id" IS NULL)),
    CONSTRAINT "chat_callback_requests_version" CHECK ("row_version" >= 1)
);
CREATE INDEX "chat_callback_requests_inbox_idx" ON "chat_callback_requests"("status", "created_at" DESC);
CREATE INDEX "chat_callback_requests_purge_idx" ON "chat_callback_requests"("closed_at") WHERE "purged_at" IS NULL AND "status" = 'CLOSED';
ALTER TABLE "chat_callback_requests" ADD CONSTRAINT "chat_callback_requests_branch_fkey" FOREIGN KEY ("preferred_branch_id")
  REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "chat_callback_requests" ADD CONSTRAINT "chat_callback_requests_handled_fkey" FOREIGN KEY ("handled_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER lucy_chat_callback_requests_guard BEFORE UPDATE ON "chat_callback_requests"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_versioned_row();

-- ---------------------------------------------------------------------------------------------------------------- notifications
-- Same method as 20261129000000: the closed type CHECK and the type/entity pairing are widened, never narrowed.
--   CHAT_CALLBACK_REQUEST  about one callback request (entity 'ChatCallbackRequest'), to the holders of MANAGE_CHAT_REQUESTS. A request
--   has no branch scope in the notification (the inbox is global), so the branch scope rule learns this entity too.
ALTER TABLE "notifications"
  DROP CONSTRAINT "notifications_type_check",
  ADD CONSTRAINT "notifications_type_check" CHECK ("type" IN (
    'BOOKING_CREATED', 'BOOKING_CANCELLED', 'LATE_CANCELLATION', 'BOOKING_NO_SHOW', 'CUSTOMER_ARRIVED',
    'BOOKING_KTV_CONFLICT', 'KTV_REASSIGNED', 'START_OVERDUE', 'PRE_END', 'END_OVERDUE',
    'LEAVE_REQUESTED', 'LEAVE_DECIDED',
    'INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY', 'PAYMENT_REVERSED',
    'INVOICE_CANCELLED_ALERT', 'REVENUE_DAILY_SUMMARY',
    'LOW_STOCK_REACHED', 'EXPIRY_ALERT', 'EXPIRED_LOT_SOLD', 'PRODUCT_RETURN_OPENED', 'PRODUCT_REFUND_MADE',
    'PRODUCT_ORDER_ARRIVED', 'PRODUCT_ORDER_ALERT',
    'ONLINE_ORDER_SHIPPED', 'ONLINE_ORDER_DELIVERED', 'ONLINE_ORDER_DELIVERY_FAILED', 'ONLINE_ORDER_CANCELLED',
    'ONLINE_ORDER_REFUNDED', 'ONLINE_ORDER_NEW', 'ONLINE_ORDER_ALERT', 'SUPPLIER_IMPORT_CHANGES', 'CHAT_CALLBACK_REQUEST')),
  DROP CONSTRAINT "notifications_entity_type_check",
  ADD CONSTRAINT "notifications_entity_type_check" CHECK ("entity_type" IN
    ('Booking', 'Visit', 'LeaveRequest', 'Invoice', 'Branch', 'ProductVariant', 'ProductReturnCase', 'ProductOrder', 'SupplierSource',
     'ChatCallbackRequest')),
  DROP CONSTRAINT "notifications_branch_scope",
  ADD CONSTRAINT "notifications_branch_scope" CHECK ("branch_id" IS NOT NULL OR "entity_type" IN ('LeaveRequest', 'SupplierSource', 'ChatCallbackRequest')),
  DROP CONSTRAINT "notifications_type_entity",
  ADD CONSTRAINT "notifications_type_entity" CHECK (
    (("type" LIKE 'LEAVE\_%') = ("entity_type" = 'LeaveRequest'))
    AND (("type" IN ('INVOICE_PAID', 'INVOICE_CANCELLED', 'PAYOS_PAYMENT_SUCCEEDED', 'PAYOS_PAYMENT_ANOMALY',
                     'PAYMENT_REVERSED', 'INVOICE_CANCELLED_ALERT', 'PRODUCT_ORDER_ARRIVED',
                     'ONLINE_ORDER_SHIPPED', 'ONLINE_ORDER_DELIVERED', 'ONLINE_ORDER_DELIVERY_FAILED', 'ONLINE_ORDER_CANCELLED',
                     'ONLINE_ORDER_REFUNDED')) = ("entity_type" = 'Invoice'))
    AND (("type" IN ('REVENUE_DAILY_SUMMARY', 'EXPIRY_ALERT', 'PRODUCT_ORDER_ALERT', 'ONLINE_ORDER_ALERT')) = ("entity_type" = 'Branch'))
    AND (("type" IN ('LOW_STOCK_REACHED', 'EXPIRED_LOT_SOLD')) = ("entity_type" = 'ProductVariant'))
    AND (("type" = 'SUPPLIER_IMPORT_CHANGES') = ("entity_type" = 'SupplierSource'))
    AND (("type" = 'CHAT_CALLBACK_REQUEST') = ("entity_type" = 'ChatCallbackRequest'))
    AND (
      ("type" = 'PRODUCT_RETURN_OPENED' AND "entity_type" = 'ProductReturnCase')
      OR ("type" = 'PRODUCT_REFUND_MADE' AND "entity_type" IN ('ProductReturnCase', 'ProductOrder'))
      OR ("type" = 'ONLINE_ORDER_NEW' AND "entity_type" = 'ProductOrder')
      OR ("type" NOT IN ('PRODUCT_RETURN_OPENED', 'PRODUCT_REFUND_MADE', 'ONLINE_ORDER_NEW')
          AND "entity_type" NOT IN ('ProductReturnCase', 'ProductOrder'))));
