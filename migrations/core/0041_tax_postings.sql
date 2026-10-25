-- Provider-observed commercial facts; no address or customer identity.
-- Every monetary column is signed. Item gross excludes shipping and tax.
CREATE TABLE st_tax_postings (
 id TEXT PRIMARY KEY NOT NULL,
 order_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('sale','refund','adjustment')),
 occurred_at TEXT NOT NULL,
 destination_state TEXT NOT NULL CHECK(length(destination_state)=2 AND destination_state=upper(destination_state)),
 channel TEXT NOT NULL CHECK(channel IN ('online','marketplace')),
 gross_cents INTEGER NOT NULL,
 taxable_cents INTEGER NOT NULL,
 nontaxable_cents INTEGER NOT NULL,
 exempt_cents INTEGER NOT NULL,
 shipping_cents INTEGER NOT NULL,
 tax_cents INTEGER NOT NULL,
 amount_cents INTEGER NOT NULL,
 calculation_id TEXT NOT NULL,
 original_transaction_id TEXT,
 jurisdictions_json TEXT NOT NULL CHECK(json_valid(jurisdictions_json) AND json_type(jurisdictions_json)='array'),
 CHECK(gross_cents=taxable_cents+nontaxable_cents+exempt_cents),
 CHECK(amount_cents=gross_cents+shipping_cents+tax_cents),
 CHECK(kind<>'sale' OR (gross_cents>=0 AND taxable_cents>=0 AND nontaxable_cents>=0 AND exempt_cents>=0 AND shipping_cents>=0 AND tax_cents>=0 AND amount_cents>=0)),
 CHECK(kind<>'refund' OR (gross_cents<=0 AND taxable_cents<=0 AND nontaxable_cents<=0 AND exempt_cents<=0 AND shipping_cents<=0 AND tax_cents<=0 AND amount_cents<=0 AND original_transaction_id IS NOT NULL))
);
CREATE INDEX st_tax_postings_period ON st_tax_postings(occurred_at,id);
CREATE INDEX st_tax_postings_order ON st_tax_postings(order_id,kind);
-- Also reject a conflicting replacement or an ignored conflicting replay.
CREATE TRIGGER st_tax_postings_immutable_insert BEFORE INSERT ON st_tax_postings
 WHEN EXISTS(SELECT 1 FROM st_tax_postings p WHERE p.id=NEW.id AND
  (p.order_id IS NOT NEW.order_id OR p.kind IS NOT NEW.kind OR p.occurred_at IS NOT NEW.occurred_at
   OR p.destination_state IS NOT NEW.destination_state OR p.channel IS NOT NEW.channel
   OR p.gross_cents IS NOT NEW.gross_cents OR p.taxable_cents IS NOT NEW.taxable_cents
   OR p.nontaxable_cents IS NOT NEW.nontaxable_cents OR p.exempt_cents IS NOT NEW.exempt_cents
   OR p.shipping_cents IS NOT NEW.shipping_cents OR p.tax_cents IS NOT NEW.tax_cents
   OR p.amount_cents IS NOT NEW.amount_cents OR p.calculation_id IS NOT NEW.calculation_id
   OR p.original_transaction_id IS NOT NEW.original_transaction_id OR p.jurisdictions_json IS NOT NEW.jurisdictions_json))
 BEGIN SELECT RAISE(ABORT,'TAX_POSTING_IMMUTABLE'); END;
CREATE TRIGGER st_tax_postings_immutable_update BEFORE UPDATE ON st_tax_postings
 BEGIN SELECT RAISE(ABORT,'TAX_POSTING_IMMUTABLE'); END;
CREATE TRIGGER st_tax_postings_immutable_delete BEFORE DELETE ON st_tax_postings
 BEGIN SELECT RAISE(ABORT,'TAX_POSTING_IMMUTABLE'); END;
