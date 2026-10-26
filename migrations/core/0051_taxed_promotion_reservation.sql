-- Free shipping removes the shipping charge, while verified sales tax stays in the total.
-- The minimum basket remains merchandise cents; tax cannot qualify a basket.
DROP TRIGGER st_promotion_reserve;
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
  AND json_extract(o.value_json,'$.totalCents')=(SELECT SUM(json_extract(l.value,'$.unitCents')*json_extract(l.value,'$.quantity')) FROM json_each(o.value_json,'$.lines') l)+COALESCE(json_extract(o.value_json,'$.tax.taxCents'),0)
  AND (SELECT SUM(json_extract(l.value,'$.unitCents')*json_extract(l.value,'$.quantity')) FROM json_each(o.value_json,'$.lines') l)>=p.minimum_cents
  AND (SELECT COUNT(*) FROM st_promotion_allocations WHERE promotion_id=p.id)<p.max_total_uses
  AND (SELECT COUNT(*) FROM st_promotion_allocations WHERE promotion_id=p.id AND customer_key=NEW.customer_key)<p.max_customer_uses
  AND (SELECT COALESCE(SUM(discount_cents),0) FROM st_promotion_allocations WHERE promotion_id=p.id)+NEW.discount_cents<=p.max_discount_cents
 ) THEN RAISE(ABORT,'ST_PROMOTION_UNAVAILABLE') END;
END;
