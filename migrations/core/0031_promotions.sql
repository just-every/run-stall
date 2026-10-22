-- Free shipping only. Every reservation consumes both use and monetary budgets
-- permanently, including unknown provider outcomes. No clock releases a hold.
CREATE TABLE st_promotions (
 id TEXT PRIMARY KEY NOT NULL, revision TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE,
 starts_at TEXT NOT NULL, ends_at TEXT NOT NULL CHECK(ends_at>starts_at),
 minimum_cents INTEGER NOT NULL CHECK(minimum_cents>=0),
 max_customer_uses INTEGER NOT NULL CHECK(max_customer_uses>0),
 max_total_uses INTEGER NOT NULL CHECK(max_total_uses>=max_customer_uses),
 max_discount_cents INTEGER NOT NULL CHECK(max_discount_cents>0),
 kind TEXT NOT NULL CHECK(kind='free_shipping'), revoked_at TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE st_promotion_allocations (
 order_id TEXT PRIMARY KEY NOT NULL, promotion_id TEXT NOT NULL REFERENCES st_promotions(id),
 promotion_revision TEXT NOT NULL, customer_key TEXT NOT NULL,
 discount_cents INTEGER NOT NULL CHECK(discount_cents>0),
 status TEXT NOT NULL CHECK(status IN ('reserved','used')),
 reserved_at TEXT NOT NULL, used_at TEXT,
 CHECK((status='reserved' AND used_at IS NULL) OR (status='used' AND used_at IS NOT NULL))
);
CREATE INDEX st_promotion_customer_budget ON st_promotion_allocations(promotion_id,customer_key);
-- Installation-local consent never travels in business archives. A restored
-- rule can only spend again after a human owner/admin reviews a new revision.
CREATE TABLE st_promotion_authority (
 promotion_id TEXT PRIMARY KEY NOT NULL REFERENCES st_promotions(id),
 revision TEXT NOT NULL, custodian_id TEXT NOT NULL, custodian_version INTEGER NOT NULL
);
CREATE TRIGGER st_promotion_rules_update BEFORE UPDATE ON st_promotions BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.kind<>OLD.kind OR NEW.created_at<>OLD.created_at OR NEW.revision=OLD.revision OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
  THEN RAISE(ABORT,'ST_PROMOTION_IMMUTABLE') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM st_promotion_allocations WHERE promotion_id=OLD.id)>NEW.max_total_uses
  OR (SELECT COALESCE(SUM(discount_cents),0) FROM st_promotion_allocations WHERE promotion_id=OLD.id)>NEW.max_discount_cents
  OR EXISTS(SELECT 1 FROM st_promotion_allocations WHERE promotion_id=OLD.id GROUP BY customer_key HAVING COUNT(*)>NEW.max_customer_uses)
  THEN RAISE(ABORT,'ST_PROMOTION_BUDGET_COMMITTED') END;
END;
-- This insert is in the same D1 transaction as the immutable order snapshot.
-- SQLite serializes the mutation and checks the current allocation totals here,
-- so two independent checkouts cannot spend the final use or cent concurrently.
CREATE TRIGGER st_promotion_reserve BEFORE INSERT ON st_promotion_allocations BEGIN
 SELECT CASE WHEN NEW.status<>'reserved' OR NEW.used_at IS NOT NULL OR NOT EXISTS(
  SELECT 1 FROM st_orders o JOIN st_promotions p ON p.id=NEW.promotion_id
  JOIN st_promotion_authority a ON a.promotion_id=p.id AND a.revision=p.revision JOIN oa_operators custodian ON custodian.id=a.custodian_id
  WHERE o.id=NEW.order_id AND p.revision=NEW.promotion_revision AND p.revoked_at IS NULL
  AND custodian.version=a.custodian_version AND custodian.status='active'
  AND (custodian.role='owner' OR (custodian.role='admin' AND NOT EXISTS(SELECT 1 FROM st_staff staff WHERE staff.actor_id=custodian.id)))
  AND p.starts_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND p.ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND json_extract(o.value_json,'$.promotion.id')=p.id AND json_extract(o.value_json,'$.promotion.revision')=p.revision
  AND json_extract(o.value_json,'$.promotion.kind')='free_shipping'
  AND json_extract(o.value_json,'$.promotion.discountCents')=NEW.discount_cents
  AND json_extract(o.value_json,'$.promotion.originalShippingCents')=NEW.discount_cents
  AND json_extract(o.value_json,'$.shipping.service.kind')='ship'
  AND json_extract(o.value_json,'$.shippingCents')=0 AND json_extract(o.value_json,'$.payment') IS NULL
  AND json_extract(o.value_json,'$.totalCents')=(SELECT SUM(json_extract(l.value,'$.unitCents')*json_extract(l.value,'$.quantity')) FROM json_each(o.value_json,'$.lines') l)
  AND json_extract(o.value_json,'$.totalCents')>=p.minimum_cents
  AND (SELECT COUNT(*) FROM st_promotion_allocations WHERE promotion_id=p.id)<p.max_total_uses
  AND (SELECT COUNT(*) FROM st_promotion_allocations WHERE promotion_id=p.id AND customer_key=NEW.customer_key)<p.max_customer_uses
  AND (SELECT COALESCE(SUM(discount_cents),0) FROM st_promotion_allocations WHERE promotion_id=p.id)+NEW.discount_cents<=p.max_discount_cents
 ) THEN RAISE(ABORT,'ST_PROMOTION_UNAVAILABLE') END;
END;
CREATE TRIGGER st_promotion_allocation_update BEFORE UPDATE ON st_promotion_allocations BEGIN
 SELECT CASE WHEN NEW.order_id<>OLD.order_id OR NEW.promotion_id<>OLD.promotion_id OR NEW.promotion_revision<>OLD.promotion_revision
  OR NEW.discount_cents<>OLD.discount_cents OR NEW.reserved_at<>OLD.reserved_at
  OR (NEW.customer_key<>OLD.customer_key AND (NEW.customer_key<>'erased:'||OLD.order_id OR NEW.status<>OLD.status OR NEW.used_at IS NOT OLD.used_at))
  OR ((NEW.status<>OLD.status OR NEW.used_at IS NOT OLD.used_at) AND (
   OLD.status<>'reserved' OR NEW.status<>'used' OR NEW.used_at IS NULL
   OR NOT EXISTS(SELECT 1 FROM st_orders o WHERE o.id=NEW.order_id
    AND json_extract(o.value_json,'$.payment.intentId') IS NOT NULL AND json_extract(o.value_json,'$.payment.sessionId') IS NOT NULL
    AND COALESCE(json_extract(o.value_json,'$.payment.source'),'stripe')='stripe'
    AND json_extract(o.value_json,'$.payment.paidAt')=NEW.used_at)))
  THEN RAISE(ABORT,'ST_PROMOTION_ALLOCATION_IMMUTABLE') END;
END;
CREATE TRIGGER st_promotion_allocation_delete BEFORE DELETE ON st_promotion_allocations BEGIN
 SELECT RAISE(ABORT,'ST_PROMOTION_BUDGET_COMMITTED');
END;
CREATE TRIGGER st_promotion_snapshot BEFORE UPDATE ON st_orders
 WHEN json_extract(NEW.value_json,'$.promotion') IS NOT json_extract(OLD.value_json,'$.promotion')
 OR (json_extract(OLD.value_json,'$.promotion') IS NOT NULL AND (
  json_extract(NEW.value_json,'$.shippingCents') IS NOT json_extract(OLD.value_json,'$.shippingCents')
  OR json_extract(NEW.value_json,'$.totalCents') IS NOT json_extract(OLD.value_json,'$.totalCents')))
 BEGIN SELECT RAISE(ABORT,'ST_PROMOTION_SNAPSHOT_IMMUTABLE'); END;
-- Only the existing verified Stripe payment writer adds this evidence. Refunds,
-- revocations and repeated callbacks cannot change or release the allocation.
CREATE TRIGGER st_promotion_paid AFTER UPDATE ON st_orders
 WHEN json_extract(NEW.value_json,'$.promotion') IS NOT NULL
 AND json_extract(NEW.value_json,'$.payment.intentId') IS NOT NULL
 AND json_extract(NEW.value_json,'$.payment.sessionId') IS NOT NULL
 AND COALESCE(json_extract(NEW.value_json,'$.payment.source'),'stripe')='stripe'
 BEGIN
 UPDATE st_promotion_allocations SET status='used',used_at=json_extract(NEW.value_json,'$.payment.paidAt') WHERE order_id=NEW.id AND status='reserved';
END;
-- Minimal real source events: opaque resource/order IDs and revisions only.
CREATE TRIGGER st_promotion_created AFTER INSERT ON st_promotions BEGIN
 INSERT INTO st_headless_events VALUES('promotion.changed.'||NEW.id||'.'||NEW.revision,'promotion',NEW.id,NEW.updated_at,
  json_object('id','promotion.changed.'||NEW.id||'.'||NEW.revision,'kind','promotion','resourceId',NEW.id,'occurredAt',NEW.updated_at));
END;
CREATE TRIGGER st_promotion_changed AFTER UPDATE ON st_promotions WHEN NEW.revision<>OLD.revision BEGIN
 INSERT INTO st_headless_events VALUES('promotion.changed.'||NEW.id||'.'||NEW.revision,'promotion',NEW.id,NEW.updated_at,
  json_object('id','promotion.changed.'||NEW.id||'.'||NEW.revision,'kind','promotion','resourceId',NEW.id,'occurredAt',NEW.updated_at));
END;
CREATE TRIGGER st_promotion_qualified AFTER INSERT ON st_promotion_allocations BEGIN
 INSERT INTO st_headless_events VALUES('promotion.qualified.'||NEW.order_id,'promotion',NEW.promotion_id,NEW.reserved_at,
  json_object('id','promotion.qualified.'||NEW.order_id,'kind','promotion','resourceId',NEW.promotion_id,'occurredAt',NEW.reserved_at));
END;
CREATE TRIGGER st_promotion_redeemed AFTER UPDATE ON st_promotion_allocations WHEN OLD.status='reserved' AND NEW.status='used' BEGIN
 INSERT INTO st_headless_events VALUES('promotion.redeemed.'||NEW.order_id,'promotion',NEW.promotion_id,NEW.used_at,
  json_object('id','promotion.redeemed.'||NEW.order_id,'kind','promotion','resourceId',NEW.promotion_id,'occurredAt',NEW.used_at));
END;
