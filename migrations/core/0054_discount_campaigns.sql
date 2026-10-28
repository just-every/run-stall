-- Preserve all existing rules, reservations and events while allowing combined campaigns.
ALTER TABLE st_promotions ADD COLUMN rule_json TEXT;
CREATE TABLE st_promotion_codes (
 code_hash TEXT PRIMARY KEY NOT NULL,promotion_id TEXT NOT NULL REFERENCES st_promotions(id),
 label TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE st_promotion_saved_allocations AS SELECT * FROM st_promotion_allocations;
DROP TABLE st_promotion_allocations;
CREATE TABLE st_promotion_allocations (
 order_id TEXT NOT NULL,promotion_id TEXT NOT NULL REFERENCES st_promotions(id),
 promotion_revision TEXT NOT NULL,customer_key TEXT NOT NULL,
 discount_cents INTEGER NOT NULL CHECK(discount_cents>0),
 status TEXT NOT NULL CHECK(status IN ('reserved','used')),
 reserved_at TEXT NOT NULL,used_at TEXT,code_hash TEXT,
 PRIMARY KEY(order_id,promotion_id),
 CHECK((status='reserved' AND used_at IS NULL) OR (status='used' AND used_at IS NOT NULL))
);
INSERT INTO st_promotion_allocations SELECT *,NULL FROM st_promotion_saved_allocations;
DROP TABLE st_promotion_saved_allocations;
CREATE INDEX st_promotion_customer_budget ON st_promotion_allocations(promotion_id,customer_key);
CREATE TRIGGER st_promotion_reserve BEFORE INSERT ON st_promotion_allocations BEGIN
 SELECT CASE WHEN NEW.status<>'reserved' OR NEW.used_at IS NOT NULL OR NOT EXISTS(
  SELECT 1 FROM st_orders o JOIN st_promotions p ON p.id=NEW.promotion_id
  JOIN st_promotion_authority a ON a.promotion_id=p.id AND a.revision=p.revision JOIN oa_operators custodian ON custodian.id=a.custodian_id
  WHERE o.id=NEW.order_id AND p.revision=NEW.promotion_revision AND p.revoked_at IS NULL
  AND custodian.version=a.custodian_version AND custodian.status='active'
  AND (custodian.role='owner' OR (custodian.role='admin' AND NOT EXISTS(SELECT 1 FROM st_staff staff WHERE staff.actor_id=custodian.id)))
  AND p.starts_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND p.ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND json_extract(o.value_json,'$.payment') IS NULL
  AND (EXISTS(SELECT 1 FROM json_each(o.value_json,'$.promotion.components') c WHERE json_extract(c.value,'$.id')=p.id
   AND json_extract(c.value,'$.revision')=p.revision AND json_extract(c.value,'$.discountCents')=NEW.discount_cents
   AND COALESCE(json_extract(c.value,'$.codeHash'),'')=COALESCE(NEW.code_hash,''))
   OR (json_extract(o.value_json,'$.promotion.components') IS NULL AND json_extract(o.value_json,'$.promotion.id')=p.id
    AND json_extract(o.value_json,'$.promotion.revision')=p.revision AND json_extract(o.value_json,'$.promotion.discountCents')=NEW.discount_cents))
  AND json_extract(o.value_json,'$.totalCents')=(SELECT SUM(json_extract(l.value,'$.unitCents')*json_extract(l.value,'$.quantity')) FROM json_each(o.value_json,'$.lines') l)
   -COALESCE((SELECT SUM(json_extract(d.value,'$.discountCents')) FROM json_each(o.value_json,'$.promotion.lineDiscounts') d),0)
   +COALESCE(json_extract(o.value_json,'$.shippingCents'),0)+COALESCE(json_extract(o.value_json,'$.tax.taxCents'),0)
  AND (SELECT SUM(json_extract(l.value,'$.unitCents')*json_extract(l.value,'$.quantity')) FROM json_each(o.value_json,'$.lines') l)>=p.minimum_cents
  AND (SELECT COUNT(*) FROM st_promotion_allocations WHERE promotion_id=p.id)<p.max_total_uses
  AND (SELECT COUNT(*) FROM st_promotion_allocations WHERE promotion_id=p.id AND customer_key=NEW.customer_key)<p.max_customer_uses
  AND (SELECT COALESCE(SUM(discount_cents),0) FROM st_promotion_allocations WHERE promotion_id=p.id)+NEW.discount_cents<=p.max_discount_cents
  AND NOT EXISTS(SELECT 1 FROM st_promotion_codes c JOIN st_promotion_allocations used ON used.code_hash=c.code_hash WHERE c.code_hash=NEW.code_hash)
 ) THEN RAISE(ABORT,'ST_PROMOTION_UNAVAILABLE') END;
END;
CREATE TRIGGER st_promotion_allocation_update BEFORE UPDATE ON st_promotion_allocations BEGIN
 SELECT CASE WHEN NEW.order_id<>OLD.order_id OR NEW.promotion_id<>OLD.promotion_id OR NEW.promotion_revision<>OLD.promotion_revision
  OR NEW.code_hash IS NOT OLD.code_hash OR NEW.discount_cents<>OLD.discount_cents OR NEW.reserved_at<>OLD.reserved_at
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
 SELECT CASE WHEN OLD.status<>'reserved' OR NOT EXISTS(SELECT 1 FROM st_orders o WHERE o.id=OLD.order_id
  AND json_extract(o.value_json,'$.payment') IS NULL AND json_extract(o.value_json,'$.checkoutExpiredAt') IS NOT NULL)
 THEN RAISE(ABORT,'ST_PROMOTION_BUDGET_COMMITTED') END;
END;
CREATE TRIGGER st_promotion_released AFTER DELETE ON st_promotion_allocations BEGIN
 INSERT INTO st_headless_events VALUES('promotion.released.'||OLD.order_id||CASE WHEN OLD.promotion_id=(SELECT json_extract(value_json,'$.promotion.id') FROM st_orders WHERE id=OLD.order_id) THEN '' ELSE '.'||OLD.promotion_id END,'promotion',OLD.promotion_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  json_object('id','promotion.released.'||OLD.order_id||CASE WHEN OLD.promotion_id=(SELECT json_extract(value_json,'$.promotion.id') FROM st_orders WHERE id=OLD.order_id) THEN '' ELSE '.'||OLD.promotion_id END,'kind','promotion','resourceId',OLD.promotion_id,'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')));
END;
CREATE TRIGGER st_promotion_qualified AFTER INSERT ON st_promotion_allocations  BEGIN
 INSERT INTO st_headless_events VALUES('promotion.qualified.'||NEW.order_id||CASE WHEN NEW.promotion_id=(SELECT json_extract(value_json,'$.promotion.id') FROM st_orders WHERE id=NEW.order_id) THEN '' ELSE '.'||NEW.promotion_id END,'promotion',NEW.promotion_id,NEW.reserved_at,json_object('id','promotion.qualified.'||NEW.order_id||CASE WHEN NEW.promotion_id=(SELECT json_extract(value_json,'$.promotion.id') FROM st_orders WHERE id=NEW.order_id) THEN '' ELSE '.'||NEW.promotion_id END,'kind','promotion','resourceId',NEW.promotion_id,'occurredAt',NEW.reserved_at));
END;
CREATE TRIGGER st_promotion_redeemed AFTER UPDATE ON st_promotion_allocations WHEN OLD.status='reserved' AND NEW.status='used' BEGIN
 INSERT INTO st_headless_events VALUES('promotion.redeemed.'||NEW.order_id||CASE WHEN NEW.promotion_id=(SELECT json_extract(value_json,'$.promotion.id') FROM st_orders WHERE id=NEW.order_id) THEN '' ELSE '.'||NEW.promotion_id END,'promotion',NEW.promotion_id,NEW.used_at,json_object('id','promotion.redeemed.'||NEW.order_id||CASE WHEN NEW.promotion_id=(SELECT json_extract(value_json,'$.promotion.id') FROM st_orders WHERE id=NEW.order_id) THEN '' ELSE '.'||NEW.promotion_id END,'kind','promotion','resourceId',NEW.promotion_id,'occurredAt',NEW.used_at));
END;
-- Reversal is an immutable observation, not permission to reuse a paid allocation.
CREATE TRIGGER st_promotion_reversal AFTER UPDATE ON st_orders WHEN json_extract(NEW.value_json,'$.promotion') IS NOT NULL BEGIN
 INSERT OR IGNORE INTO st_headless_events
 SELECT 'promotion.reversed.'||NEW.id||'.'||a.promotion_id||'.'||json_extract(r.value,'$.id'),'promotion',a.promotion_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 json_object('id','promotion.reversed.'||NEW.id||'.'||a.promotion_id||'.'||json_extract(r.value,'$.id'),'kind','promotion','resourceId',a.promotion_id,'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 FROM st_promotion_allocations a,json_each(NEW.value_json,'$.refunds') r WHERE a.order_id=NEW.id AND json_extract(r.value,'$.status')='succeeded';
END;
