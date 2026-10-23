-- An unpaid checkout holds its promotion use and budget only while Stripe could
-- still take its payment. Its order records checkoutExpiredAt once Stripe reports
-- that checkout expired or never created; only then is the hold released. Paid
-- use, refunds and cancellations still never release budget.
DROP TRIGGER st_promotion_allocation_delete;
CREATE TRIGGER st_promotion_allocation_delete BEFORE DELETE ON st_promotion_allocations BEGIN
 SELECT CASE WHEN OLD.status<>'reserved' OR NOT EXISTS(SELECT 1 FROM st_orders o WHERE o.id=OLD.order_id
  AND json_extract(o.value_json,'$.payment') IS NULL AND json_extract(o.value_json,'$.checkoutExpiredAt') IS NOT NULL)
 THEN RAISE(ABORT,'ST_PROMOTION_BUDGET_COMMITTED') END;
END;
CREATE TRIGGER st_promotion_released AFTER DELETE ON st_promotion_allocations BEGIN
 INSERT INTO st_headless_events VALUES('promotion.released.'||OLD.order_id,'promotion',OLD.promotion_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
  json_object('id','promotion.released.'||OLD.order_id,'kind','promotion','resourceId',OLD.promotion_id,'occurredAt',strftime('%Y-%m-%dT%H:%M:%fZ','now')));
END;
