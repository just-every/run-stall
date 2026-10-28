-- Campaign rules and single-use code hashes retain commercial history, never local authority.
CREATE TABLE st_promotion_rules(promotion_id TEXT PRIMARY KEY NOT NULL REFERENCES st_promotions(id),value_json TEXT NOT NULL CHECK(json_valid(value_json)));
CREATE TABLE st_promotion_codes(id TEXT PRIMARY KEY NOT NULL,promotion_id TEXT NOT NULL REFERENCES st_promotions(id),code_hash TEXT NOT NULL UNIQUE);
CREATE TABLE st_promotion_allocations_v2 (
 order_id TEXT NOT NULL,promotion_id TEXT NOT NULL REFERENCES st_promotions(id),promotion_revision TEXT NOT NULL,customer_key TEXT NOT NULL,
 discount_cents INTEGER NOT NULL CHECK(discount_cents>0),status TEXT NOT NULL CHECK(status IN ('reserved','used')),reserved_at TEXT NOT NULL,used_at TEXT,
 code_id TEXT REFERENCES st_promotion_codes(id),PRIMARY KEY(order_id,promotion_id),UNIQUE(code_id),
 CHECK((status='reserved' AND used_at IS NULL) OR (status='used' AND used_at IS NOT NULL))
);
INSERT INTO st_promotion_allocations_v2 SELECT *,NULL FROM st_promotion_allocations;
DROP TRIGGER st_promotion_rules_update;
DROP TRIGGER st_promotion_paid;
DROP TABLE st_promotion_allocations;
ALTER TABLE st_promotion_allocations_v2 RENAME TO st_promotion_allocations;
CREATE INDEX st_promotion_customer_budget ON st_promotion_allocations(promotion_id,customer_key);
CREATE TRIGGER st_promotion_rules_update BEFORE UPDATE ON st_promotions BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.kind<>OLD.kind OR NEW.created_at<>OLD.created_at OR NEW.revision=OLD.revision OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
  THEN RAISE(ABORT,'ST_PROMOTION_IMMUTABLE') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM st_promotion_allocations WHERE promotion_id=OLD.id)>NEW.max_total_uses
  OR (SELECT COALESCE(SUM(discount_cents),0) FROM st_promotion_allocations WHERE promotion_id=OLD.id)>NEW.max_discount_cents
  OR EXISTS(SELECT 1 FROM st_promotion_allocations WHERE promotion_id=OLD.id GROUP BY customer_key HAVING COUNT(*)>NEW.max_customer_uses)
  THEN RAISE(ABORT,'ST_PROMOTION_BUDGET_COMMITTED') END;
END;
CREATE TRIGGER st_promotion_paid AFTER UPDATE ON st_orders
 WHEN json_extract(NEW.value_json,'$.promotion') IS NOT NULL
 AND json_extract(NEW.value_json,'$.payment.intentId') IS NOT NULL
 AND json_extract(NEW.value_json,'$.payment.sessionId') IS NOT NULL
 AND COALESCE(json_extract(NEW.value_json,'$.payment.source'),'stripe')='stripe'
 BEGIN
 UPDATE st_promotion_allocations SET status='used',used_at=json_extract(NEW.value_json,'$.payment.paidAt') WHERE order_id=NEW.id AND status='reserved';
END;
CREATE TRIGGER st_promotion_allocation_update BEFORE UPDATE ON st_promotion_allocations BEGIN
 SELECT CASE WHEN NEW.order_id<>OLD.order_id OR NEW.promotion_id<>OLD.promotion_id OR NEW.promotion_revision<>OLD.promotion_revision
  OR NEW.discount_cents<>OLD.discount_cents OR NEW.reserved_at<>OLD.reserved_at OR NEW.code_id IS NOT OLD.code_id
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

CREATE TRIGGER st_promotion_reserve BEFORE INSERT ON st_promotion_allocations BEGIN
 SELECT CASE WHEN NEW.status<>'reserved' OR NEW.used_at IS NOT NULL OR NOT EXISTS(
  SELECT 1 FROM st_orders o JOIN st_promotions p ON p.id=NEW.promotion_id
  JOIN st_promotion_authority a ON a.promotion_id=p.id AND a.revision=p.revision JOIN oa_operators custodian ON custodian.id=a.custodian_id
  JOIN json_each(COALESCE(json_extract(o.value_json,'$.promotion.components'),json_array(json_extract(o.value_json,'$.promotion')))) snapshot
  WHERE o.id=NEW.order_id AND p.revision=NEW.promotion_revision AND p.revoked_at IS NULL
  AND custodian.version=a.custodian_version AND custodian.status='active'
  AND (custodian.role='owner' OR (custodian.role='admin' AND NOT EXISTS(SELECT 1 FROM st_staff staff WHERE staff.actor_id=custodian.id)))
  AND p.starts_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND p.ends_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND json_extract(snapshot.value,'$.id')=p.id AND json_extract(snapshot.value,'$.revision')=p.revision
  AND json_extract(snapshot.value,'$.discountCents')=NEW.discount_cents
  AND json_extract(snapshot.value,'$.codeId') IS NEW.code_id
  AND (NEW.code_id IS NULL OR EXISTS(SELECT 1 FROM st_promotion_codes WHERE id=NEW.code_id AND promotion_id=p.id))
  AND json_extract(o.value_json,'$.payment') IS NULL
  AND json_extract(o.value_json,'$.totalCents')=(SELECT SUM(json_extract(l.value,'$.unitCents')*json_extract(l.value,'$.quantity')-COALESCE(json_extract(l.value,'$.discountCents'),0)) FROM json_each(o.value_json,'$.lines') l)+COALESCE(json_extract(o.value_json,'$.shippingCents'),0)+COALESCE(json_extract(o.value_json,'$.tax.taxCents'),0)
  AND (SELECT SUM(json_extract(l.value,'$.unitCents')*json_extract(l.value,'$.quantity')) FROM json_each(o.value_json,'$.lines') l)>=p.minimum_cents
  AND (SELECT COUNT(*) FROM st_promotion_allocations WHERE promotion_id=p.id)<p.max_total_uses
  AND (SELECT COUNT(*) FROM st_promotion_allocations WHERE promotion_id=p.id AND customer_key=NEW.customer_key)<p.max_customer_uses
  AND (SELECT COALESCE(SUM(discount_cents),0) FROM st_promotion_allocations WHERE promotion_id=p.id)+NEW.discount_cents<=p.max_discount_cents
 ) THEN RAISE(ABORT,'ST_PROMOTION_UNAVAILABLE') END;
END;
CREATE TRIGGER st_promotion_qualified AFTER INSERT ON st_promotion_allocations BEGIN
 INSERT INTO st_headless_events VALUES('promotion.qualified.'||NEW.order_id||CASE WHEN NEW.promotion_id=(SELECT json_extract(value_json,'$.promotion.id') FROM st_orders WHERE id=NEW.order_id) THEN '' ELSE '.'||NEW.promotion_id END,'promotion',NEW.promotion_id,NEW.reserved_at,
  json_object('id','promotion.qualified.'||NEW.order_id||CASE WHEN NEW.promotion_id=(SELECT json_extract(value_json,'$.promotion.id') FROM st_orders WHERE id=NEW.order_id) THEN '' ELSE '.'||NEW.promotion_id END,'kind','promotion','resourceId',NEW.promotion_id,'occurredAt',NEW.reserved_at));
END;
CREATE TRIGGER st_promotion_redeemed AFTER UPDATE ON st_promotion_allocations WHEN OLD.status='reserved' AND NEW.status='used' BEGIN
 INSERT INTO st_headless_events VALUES('promotion.redeemed.'||NEW.order_id||CASE WHEN NEW.promotion_id=(SELECT json_extract(value_json,'$.promotion.id') FROM st_orders WHERE id=NEW.order_id) THEN '' ELSE '.'||NEW.promotion_id END,'promotion',NEW.promotion_id,NEW.used_at,
  json_object('id','promotion.redeemed.'||NEW.order_id||CASE WHEN NEW.promotion_id=(SELECT json_extract(value_json,'$.promotion.id') FROM st_orders WHERE id=NEW.order_id) THEN '' ELSE '.'||NEW.promotion_id END,'kind','promotion','resourceId',NEW.promotion_id,'occurredAt',NEW.used_at));
END;
CREATE TRIGGER st_promotion_released AFTER DELETE ON st_promotion_allocations BEGIN
 INSERT INTO st_headless_events VALUES('promotion.released.'||OLD.order_id||'.'||OLD.promotion_id,'promotion',OLD.promotion_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  json_object('id','promotion.released.'||OLD.order_id||'.'||OLD.promotion_id,'kind','promotion','resourceId',OLD.promotion_id,'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')));
END;
CREATE TRIGGER st_promotion_reversal AFTER UPDATE ON st_orders BEGIN
 INSERT OR IGNORE INTO st_headless_events
 SELECT 'promotion.reversed.'||NEW.id||'.'||a.promotion_id||'.'||json_extract(r.value,'$.id'),'promotion',a.promotion_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
 json_object('id','promotion.reversed.'||NEW.id||'.'||a.promotion_id||'.'||json_extract(r.value,'$.id'),'kind','promotion','resourceId',a.promotion_id,'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 FROM st_promotion_allocations a,json_each(NEW.value_json,'$.refunds') r WHERE a.order_id=NEW.id AND json_extract(r.value,'$.status')='succeeded';
END;
CREATE TRIGGER st_promotion_cancellation AFTER UPDATE ON st_risk WHEN json_extract(NEW.value_json,'$.status')='canceled' AND json_extract(OLD.value_json,'$.status')<>'canceled' BEGIN
 INSERT OR IGNORE INTO st_headless_events
 SELECT 'promotion.reversed.cancel.'||NEW.order_id||'.'||a.promotion_id,'promotion',a.promotion_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),json_object('id','promotion.reversed.cancel.'||NEW.order_id||'.'||a.promotion_id,'kind','promotion','resourceId',a.promotion_id,'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')) FROM st_promotion_allocations a WHERE a.order_id=NEW.order_id;
END;
