-- Phase 6 Wave 4 / P6-23: promotion campaigns (PRD 24.1; design 2.39). Additive: three new tables, one enum, one nullable column on
-- the product line of an invoice (which campaign priced it), and the BODY of the price function replaced. No permission is added (the
-- campaigns are controlled by MANAGE_PRODUCT_PRICES) and no existing row is written.
--
-- A campaign never rewrites a price. The effective price of a variant at an instant is still ONE SQL function, now with one more
-- candidate: the best price any ACTIVE campaign gives the variant. Candidates are never added together; the lowest price wins (the
-- better benefit for the customer, PRD 16.1 and 24.1). With no campaign the function returns exactly what it returned before.
--
-- A published campaign is history: its window, groups and items never change (the invoices that were priced by it must keep
-- reproducing the same price). It can only be ended early, which stamps ended_early_at at GREATEST(starts_at, now) like a variant
-- promotion, so a campaign ended before it started never applies. Its presentation (texts, image) stays editable: it is not a price.
CREATE TYPE "CampaignRuleKind" AS ENUM ('PERCENT', 'AMOUNT', 'PRICE');

CREATE TABLE "product_campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name_vi" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "internal_note" TEXT,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "published_by_user_id" UUID,
    "ended_early_at" TIMESTAMPTZ(3),
    "ended_early_by_user_id" UUID,
    "ended_early_reason" TEXT,
    "badge_vi" TEXT,
    "badge_en" TEXT,
    "headline_vi" TEXT,
    "headline_en" TEXT,
    "message_vi" TEXT,
    "message_en" TEXT,
    "cta_label_vi" TEXT,
    "cta_label_en" TEXT,
    "banner_media_id" UUID,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_campaigns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_campaigns_slug" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") BETWEEN 3 AND 60),
    CONSTRAINT "product_campaigns_names" CHECK (
      char_length(btrim("name_vi")) BETWEEN 1 AND 120 AND char_length(btrim("name_en")) BETWEEN 1 AND 120
      AND ("internal_note" IS NULL OR char_length("internal_note") BETWEEN 1 AND 2000)
    ),
    CONSTRAINT "product_campaigns_window" CHECK ("ends_at" > "starts_at"),
    CONSTRAINT "product_campaigns_published_pair" CHECK (("published_at" IS NULL) = ("published_by_user_id" IS NULL)),
    CONSTRAINT "product_campaigns_ended_pair" CHECK (
      ("ended_early_at" IS NULL) = ("ended_early_by_user_id" IS NULL)
      AND ("ended_early_at" IS NULL) = ("ended_early_reason" IS NULL)
    ),
    CONSTRAINT "product_campaigns_ended_published" CHECK ("ended_early_at" IS NULL OR "published_at" IS NOT NULL),
    CONSTRAINT "product_campaigns_ended_inside" CHECK ("ended_early_at" IS NULL OR "ended_early_at" <= "ends_at"),
    CONSTRAINT "product_campaigns_texts" CHECK (
      ("badge_vi" IS NULL OR char_length("badge_vi") BETWEEN 1 AND 24)
      AND ("badge_en" IS NULL OR char_length("badge_en") BETWEEN 1 AND 24)
      AND ("headline_vi" IS NULL OR char_length("headline_vi") BETWEEN 1 AND 120)
      AND ("headline_en" IS NULL OR char_length("headline_en") BETWEEN 1 AND 120)
      AND ("message_vi" IS NULL OR char_length("message_vi") BETWEEN 1 AND 300)
      AND ("message_en" IS NULL OR char_length("message_en") BETWEEN 1 AND 300)
      AND ("cta_label_vi" IS NULL OR char_length("cta_label_vi") BETWEEN 1 AND 40)
      AND ("cta_label_en" IS NULL OR char_length("cta_label_en") BETWEEN 1 AND 40)
    ),
    CONSTRAINT "product_campaigns_row_version" CHECK ("row_version" >= 1)
);
CREATE UNIQUE INDEX "product_campaigns_slug_key" ON "product_campaigns"("slug");
CREATE INDEX "product_campaigns_window_idx" ON "product_campaigns"("starts_at", "ends_at") WHERE "published_at" IS NOT NULL;
CREATE INDEX "product_campaigns_banner_idx" ON "product_campaigns"("banner_media_id");
ALTER TABLE "product_campaigns" ADD CONSTRAINT "product_campaigns_banner_media_id_fkey" FOREIGN KEY ("banner_media_id")
  REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_campaigns" ADD CONSTRAINT "product_campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_campaigns" ADD CONSTRAINT "product_campaigns_published_by_user_id_fkey" FOREIGN KEY ("published_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_campaigns" ADD CONSTRAINT "product_campaigns_ended_early_by_user_id_fkey" FOREIGN KEY ("ended_early_by_user_id")
  REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- One rule for a group of products. PERCENT is a whole percent off the list price in force (the discount is rounded DOWN to a whole VND,
-- so the price is never below what the percent says), AMOUNT is whole VND off, PRICE is an explicit price.
CREATE TABLE "product_campaign_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "rule_kind" "CampaignRuleKind" NOT NULL,
    "rule_value" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_campaign_groups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_campaign_groups_value" CHECK (
      ("rule_kind" = 'PERCENT' AND "rule_value" BETWEEN 1 AND 90)
      OR ("rule_kind" IN ('AMOUNT', 'PRICE') AND "rule_value" BETWEEN 1 AND 1000000000)
    ),
    CONSTRAINT "product_campaign_groups_position" CHECK ("position" >= 1)
);
CREATE UNIQUE INDEX "product_campaign_groups_position_key" ON "product_campaign_groups"("campaign_id", "position");
CREATE UNIQUE INDEX "product_campaign_groups_campaign_key" ON "product_campaign_groups"("id", "campaign_id");
ALTER TABLE "product_campaign_groups" ADD CONSTRAINT "product_campaign_groups_campaign_id_fkey" FOREIGN KEY ("campaign_id")
  REFERENCES "product_campaigns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "product_campaign_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_campaign_items_pkey" PRIMARY KEY ("id")
);
-- A variant is in a campaign once; it belongs to a group of the SAME campaign.
CREATE UNIQUE INDEX "product_campaign_items_variant_key" ON "product_campaign_items"("campaign_id", "variant_id");
CREATE INDEX "product_campaign_items_variant_idx" ON "product_campaign_items"("variant_id");
CREATE INDEX "product_campaign_items_group_idx" ON "product_campaign_items"("group_id");
ALTER TABLE "product_campaign_items" ADD CONSTRAINT "product_campaign_items_campaign_id_fkey" FOREIGN KEY ("campaign_id")
  REFERENCES "product_campaigns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_campaign_items" ADD CONSTRAINT "product_campaign_items_group_fkey" FOREIGN KEY ("group_id", "campaign_id")
  REFERENCES "product_campaign_groups"("id", "campaign_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_campaign_items" ADD CONSTRAINT "product_campaign_items_variant_id_fkey" FOREIGN KEY ("variant_id")
  REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ------------------------------------------------------------------------------------------------- guards
CREATE FUNCTION lucy_guard_product_campaign() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.published_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A published campaign is history and is never deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.published_at IS NOT NULL OR NEW.ended_early_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A campaign starts as a draft';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A campaign keeps its identity';
  END IF;
  IF OLD.published_at IS NULL THEN
    -- A draft is free to change; publishing needs the window to lie in the future and at least one item.
    IF NEW.ended_early_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a published campaign can be ended';
    END IF;
    IF NEW.published_at IS NOT NULL THEN
      NEW.published_at := clock_timestamp();
      IF NEW.starts_at < NEW.published_at THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A campaign is published before it starts';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM product_campaign_items WHERE campaign_id = NEW.id) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A published campaign has at least one product';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- Published: the price facts are frozen; only the end and the presentation may change.
  IF NEW.slug IS DISTINCT FROM OLD.slug OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
     OR NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.published_by_user_id IS DISTINCT FROM OLD.published_by_user_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The window and the rules of a published campaign never change';
  END IF;
  IF OLD.ended_early_at IS NOT NULL THEN
    IF NEW.ended_early_at IS DISTINCT FROM OLD.ended_early_at OR NEW.ended_early_by_user_id IS DISTINCT FROM OLD.ended_early_by_user_id
       OR NEW.ended_early_reason IS DISTINCT FROM OLD.ended_early_reason THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A campaign is ended once';
    END IF;
  ELSIF NEW.ended_early_at IS NOT NULL THEN
    NEW.ended_early_at := GREATEST(OLD.starts_at, LEAST(OLD.ends_at, clock_timestamp()));
    IF OLD.ends_at <= clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A campaign that has ended cannot be ended again';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION lucy_guard_product_campaign_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Campaign history is never truncated';
END;
$$;
CREATE TRIGGER product_campaigns_guard BEFORE INSERT OR UPDATE OR DELETE ON "product_campaigns"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_campaign();
CREATE TRIGGER product_campaigns_no_truncate BEFORE TRUNCATE ON "product_campaigns"
  FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_campaign_truncate();

CREATE FUNCTION lucy_guard_product_campaign_member() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_id uuid;
  state timestamptz;
BEGIN
  owner_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.campaign_id ELSE NEW.campaign_id END;
  SELECT published_at INTO state FROM product_campaigns WHERE id = owner_id FOR SHARE;
  IF FOUND AND state IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The groups and products of a published campaign never change';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.campaign_id IS DISTINCT FROM OLD.campaign_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A campaign member keeps its campaign';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_campaign_groups_guard BEFORE INSERT OR UPDATE OR DELETE ON "product_campaign_groups"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_campaign_member();
CREATE TRIGGER product_campaign_items_guard BEFORE INSERT OR UPDATE OR DELETE ON "product_campaign_items"
  FOR EACH ROW EXECUTE FUNCTION lucy_guard_product_campaign_member();
CREATE TRIGGER product_campaign_groups_no_truncate BEFORE TRUNCATE ON "product_campaign_groups"
  FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_campaign_truncate();
CREATE TRIGGER product_campaign_items_no_truncate BEFORE TRUNCATE ON "product_campaign_items"
  FOR EACH STATEMENT EXECUTE FUNCTION lucy_guard_product_campaign_truncate();

-- --------------------------------------------------------------------------------------------- the price
-- The best campaign price of a variant at an instant: from every campaign that was published, has started and has not ended, the price
-- its group's rule gives from the list price in force at that instant; the lowest wins, a tie goes to the earlier published campaign.
-- A rule that gives no discount (the price is not below the list price) is not a candidate.
CREATE FUNCTION lucy_variant_campaign_at(p_variant uuid, p_at timestamptz)
RETURNS TABLE (campaign_id uuid, group_id uuid, price_vnd bigint)
LANGUAGE sql STABLE AS $$
  WITH l AS (
    SELECT v.list_price_vnd FROM product_price_versions v
    WHERE v.variant_id = p_variant AND v.created_at <= p_at ORDER BY v.version_no DESC LIMIT 1
  )
  SELECT c.id, g.id,
         CASE g.rule_kind
           WHEN 'PERCENT' THEN l.list_price_vnd - (l.list_price_vnd * g.rule_value) / 100
           WHEN 'AMOUNT' THEN l.list_price_vnd - g.rule_value
           ELSE g.rule_value
         END AS price
  FROM l
  JOIN product_campaign_items i ON i.variant_id = p_variant
  JOIN product_campaigns c ON c.id = i.campaign_id
  JOIN product_campaign_groups g ON g.id = i.group_id
  WHERE c.published_at IS NOT NULL AND c.published_at <= p_at
    AND c.starts_at <= p_at AND p_at < COALESCE(c.ended_early_at, c.ends_at)
    AND CASE g.rule_kind
          WHEN 'PERCENT' THEN l.list_price_vnd - (l.list_price_vnd * g.rule_value) / 100
          WHEN 'AMOUNT' THEN l.list_price_vnd - g.rule_value
          ELSE g.rule_value
        END BETWEEN 1 AND l.list_price_vnd - 1
  ORDER BY price ASC, c.published_at ASC, c.id ASC
  LIMIT 1
$$;

-- Same columns as before: with no campaign this returns exactly what it returned. The promotional price is the better of the variant's own
-- promotion and the campaign price; promotion_id names the variant promotion only when it is the one that gives the price.
CREATE OR REPLACE FUNCTION lucy_variant_price_at(p_variant uuid, p_at timestamptz)
RETURNS TABLE (list_price_vnd bigint, promo_price_vnd bigint, effective_price_vnd bigint, promotion_id uuid)
LANGUAGE sql STABLE AS $$
  WITH l AS (
    SELECT v.list_price_vnd FROM product_price_versions v
    WHERE v.variant_id = p_variant AND v.created_at <= p_at ORDER BY v.version_no DESC LIMIT 1
  ), p AS (
    SELECT r.id, r.promo_price_vnd FROM product_promotions r
    WHERE r.variant_id = p_variant AND r.starts_at <= p_at AND p_at < COALESCE(r.ended_early_at, r.ends_at)
    ORDER BY r.starts_at DESC LIMIT 1
  ), c AS (
    SELECT m.price_vnd FROM lucy_variant_campaign_at(p_variant, p_at) m
  )
  SELECT l.list_price_vnd,
         LEAST(p.promo_price_vnd, c.price_vnd),
         LEAST(l.list_price_vnd, COALESCE(p.promo_price_vnd, l.list_price_vnd), COALESCE(c.price_vnd, l.list_price_vnd)),
         CASE WHEN p.promo_price_vnd IS NOT NULL AND (c.price_vnd IS NULL OR p.promo_price_vnd <= c.price_vnd) THEN p.id END
  FROM l LEFT JOIN p ON true LEFT JOIN c ON true
$$;

-- Which campaign priced a product line (NULL for a variant promotion or the list price).
ALTER TABLE "invoice_line_products" ADD COLUMN "campaign_id" UUID;
ALTER TABLE "invoice_line_products" ADD CONSTRAINT "invoice_line_products_campaign_id_fkey" FOREIGN KEY ("campaign_id")
  REFERENCES "product_campaigns"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX "invoice_line_products_campaign_idx" ON "invoice_line_products"("campaign_id") WHERE "campaign_id" IS NOT NULL;
