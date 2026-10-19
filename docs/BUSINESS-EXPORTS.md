# Business exports

The human owner downloads `/api/stall/exports/{kind}` through Settings → Business exports or HTTP GET with their native session. `businessExport(db, kind)` produces local business records without
contacting Stripe, Pier or another service. The HTTP handler requires the human owner and rechecks current authority before releasing the download. These exports do not require a
provider account connection. Downloads contain personal and commercial data;
keep them private. Responses use `Cache-Control: no-store` and attachment names.
Each successful download records the owner, kind and time in Activity. This
retained audit history makes the installation nonempty for archive restoration;
restore into an untouched destination rather than replacing that history.

Supported kinds:

| Kind | Contents |
| --- | --- |
| `products` | Every product, including inactive products, with separate `current` and pending `draft` rows and their shared revision. |
| `customers` | Contact email and order history derived from locally retained, unerased orders; order IDs, first/last order time and recorded paid/refunded totals. |
| `orders` | Every order, including incomplete checkouts, with retained delivery details and nested local payment, reservation, shipment and refund records. |
| `lines` | Every purchased line, its order ID, one-based line number, original SKU/name/item ID, quantity and prices. |
| `payments` | Locally confirmed payments, Stripe session/intent references, confirmation time and recorded order amount. |
| `refunds` | Every refund including drafts, pending, failed and canceled attempts, with line quantities, refund kind, explicit tax treatment/accounting category and approval evidence. Shipping and goodwill refunds have empty line arrays. |
| `shipments` | Every locally recorded draft or shipment, including observed partial dispatches and retained tracking. |
| `reconciliation` | Per-order local payment/refund totals and checkout, intent, reservation and shipment references/status. |
| `stripe-work` | Retained Stripe operation/order references, kind, claimed-write count, prepared/uncertain/response-observed status, timestamps, safe error code and observed provider ID. No intent hash or payload. |
| `records` | JSON containing all supported product and order commercial fields, current/pending product drafts, derived customers, reconciliation and commercial-only `stripeWork` attempt/observation history; order lines/payments/refunds/shipments are nested under each order. |

There is no row limit or pagination truncation. Export reads all current product
and order rows using the store readers. It is a current local read, not a
transactionally frozen historical snapshot: concurrent edits can occur between
these reads. Large exports must fit the Worker's available memory/response
limits; failures are errors, never a deliberately shortened download. JSON uses
the `stall-business-export-v1` schema label and an export timestamp.

CSV is UTF-8, RFC 4180 quoting (all cells quoted, embedded quotes doubled), with
CRLF row endings and a header even when empty. Arrays and nested records occupy
JSON-encoded cells. Null/missing values become empty cells. Booleans are `true`
or `false`. All money columns ending in `Cents` contain integer cents; currency
is `usd` for current products; order records retain their original currency.
Customer totals group by email and original currency, never combine currencies.
No floating-point dollar conversion occurs. Stored times are emitted
as UTC ISO 8601; an invalid stored timestamp fails the export.

For spreadsheet safety, text beginning with `=`, `+`, `-` or `@` after leading
whitespace/control characters, or beginning with tab/CR/LF, gets a leading
apostrophe before CSV quoting. Text already beginning with an apostrophe gets
an additional apostrophe so a literal prefix is distinguishable. Numbers retain
their numeric representation. A raw CSV consumer sees the protective apostrophe;
remove exactly one only from cells covered by these rules when recovering raw
text. Spreadsheet import settings may display or preserve the apostrophe. JSON
preserves original text without spreadsheet escaping.

Customer rows are derived contacts, not registered accounts or an independent
customer book. No marketing consent or lawful basis is inferred. Erased contact
details are not reconstructed; their opaque order/financial history remains.
Customer paid totals include only orders with local payment confirmation, and
refunded totals only succeeded refunds. Reconciliation's `netRecordedCents` is
confirmed order money minus succeeded refunds; pending refunds are separate.
It is not provider settlement, fee, payout, bank or tax reconciliation.

The JSON whitelist includes retained shipping addresses, business/provider IDs,
product/refund/shipment approvals, reservation quantities and dispatch tracking.
Stripe work includes operation/order IDs, kind, status, claimed-write count, times, safe error code and observed provider ID. It excludes its internal commercial-intent hash. It excludes request digests, checkout idempotency keys and hosted checkout URLs,
authentication/session material, integration credentials, API keys, webhook
secrets, raw provider payloads, event digests, import journals and security audit
records. Reservation line fields are limited to ID, item ID, quantity, price,
reserved, canceled (`cancelled`) and dispatched quantities. New or unknown stored
fields are not automatically exported.

There are no native variant, media, consent, return, gift-card, discount,
redirect or saved-report records to export. Product descriptions and actual
refunds are included; they do not establish these absent record types. Provider
data not retained locally (including card details, fees, payouts, full provider
customer/stock/delivery history and settlement status) is excluded. Nothing is
fetched to fill gaps. This is a business-data download, not an installation
backup or an import/restore package; use installation portability for restoration.

Orders retain their original `shippingCents` (zero for historical orders without a charge). Current paid shipping is an owner-configured flat US charge passed to Stripe as a shipping option; it is separate from inventory lines. The Pier stock order contains merchandise only, so its channel payment evidence records the merchandise allocation of the verified Stripe charge, with the same intent reference. Stall retains the gross charge and shipping separately. This allocation is not processor settlement or a second payment.
