# Current shipment and payment claims

| Capability | Implemented evidence | Remaining boundary |
| --- | --- | --- |
| Pier shipment status in Stall | `src/stall/shipment-sync.ts`, `tests/api/commerce.test.mjs`: owner refresh reads native partial/full dispatches and rejects a repeat ship with a plain reason. | Carrier label purchase and tracking email are not implemented. |
| Tracking and dates | `src/stall/ui/order-panel.tsx`, `src/stall/ui/presentation.tsx`: actual Pier carton tracking/delivery status and visible time-zone labels. | Live carrier acceptance requires a provider account. |
| Paid shop order in the stock desk | `src/stall/pier.ts`, `tests/api/commerce.test.mjs`: a separate scoped payment command preserves the original reservation identity. | Pantry fee/payout accounting is outside Stall. |
| Business CSVs and merchant exit | `src/stall/exports.ts`, `tests/api/data.test.mjs`, `tests/api/commerce.test.mjs`: owner-only CSVs/JSON cover supported records, exact totals, authorization and erasure, alongside the complete archive. | Absent target records inherit export requirements before shipping; formats, resource bounds, original currency/UTC and exclusions are documented in `BUSINESS-EXPORTS.md`. |
| Reviewed item, shipping and goodwill refunds (ORDER-003) | `src/stall/refund-values.ts`, `tests/api/commerce.test.mjs`, `tests/ui/journey.mjs`: real paid shipping, exact approval, recovery and positive integer-cent caps; no stock return inferred. | Current untaxed Stripe orders carry explicit categories; TAX-001/ACCOUNT-001 inherit tax/ledger work. |
