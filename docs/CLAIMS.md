# Current shipment and payment claims

| Capability | Implemented evidence | Remaining boundary |
| --- | --- | --- |
| Pier shipment status in Stall | `src/stall/shipment-sync.ts`, `tests/api/commerce.test.mjs`: owner refresh reads native partial/full dispatches and rejects a repeat ship with a plain reason. | Carrier label purchase and tracking email are not implemented. |
| Tracking and dates | `src/stall/ui/order-panel.tsx`, `src/stall/ui/presentation.tsx`: actual Pier carton tracking/delivery status and visible time-zone labels. | Live carrier acceptance requires a provider account. |
| Paid shop order in the stock desk | `src/stall/pier.ts`, `tests/api/commerce.test.mjs`: a separate scoped payment command preserves the original reservation identity. | Pantry fee/payout accounting is outside Stall. |
