# Agent commands, approvals and recovery

Use `POST /api/stall/commands` with JSON `{ "type": "…", "payload": { … } }`. Human requests use their native session cookie and this installation's `Origin`. Agent requests use `Authorization: Bearer …` with the owner's preparation credential stored privately. Every handler checks current role/session or grant; changing an operator's role or revoking its grant removes authority.

| Command | Payload | Effect |
| --- | --- | --- |
| `product.prepare` | `sku,name,description,unitCents,active` | Prepare listing metadata/price. Integer cents, USD. |
| `product.approve` | `sku,revision` | Person publishes the exact prepared revision after Pier validation. |
| `shipment.prepare` | `orderId,revision,reference` | Check Pier for an existing dispatch, then prepare a shipment for a paid, fully reserved order. |
| `shipment.approve` | `orderId,revision` | Person approves, then dispatches the original Pier reservation. |
| `refund.prepare` | `orderId,lines:[{sku,quantity}],reason` | Prepare an exact partial refund, bounded by unrefunded paid quantities. |
| `refund.approve` | `orderId,revision` | Person approves the amount and lines, then requests the Stripe refund once or records the refund of a staff-paid sale without a processor call. |
| `shop.configure` | `timeZone` | Person saves a canonical IANA time zone for business displays; timestamp fields remain UTC. |
| `order.assign` | `orderId,revision,assigneeId` | Person assigns active staff, or passes null to unassign. Responsibility is revision-checked and grants no access; history is retained. |
| `order.note.add` | `orderId,revision,text` | Signed-in owner/admin appends an attributable internal note (up to 2,000 characters). |
| `order.note.redact` | `orderId,revision,noteId,reason` | Owner replaces note text and records redaction attribution/reason. |
| `order.tag.add` / `order.tag.remove` | `orderId,revision,tag` | Signed-in owner/admin adds/removes an internal plain-text tag (up to 50 tags, 40 characters each). |
| `order.manual` | `idempotencyKey,customerEmail,name,address,lines,expectedTotalCents,amountCents,method,receivedOn,reference?` | Owner/admin records an already-paid US sale at current published prices and configured shipping, then reserves in Pier. Amounts are equal integer cents; method is cash/check/bank_transfer/other; received date is a shop-zone date no later than today. Retain the UUIDv4 on retry. No provider-verified payment, message or tax calculation. |
| `order.reconcile` | `orderId` | Person resumes or refreshes the same payment, reservation, shipping or refund effect. |
| `customer.erase` | `email,confirm:"ERASE"` | Owner erases shipped customers' contact details and fences earlier backups. |

To invite an administrator or member, a signed-in owner posts `/auth/invite` with `{email,displayName,role:"admin"}` or `role:"member"`, the native session and same-origin header. The recipient confirms the one-time email link. `GET /auth/operators` lists current operators; `/auth/operator/status` and `/auth/operator/role` change access and invalidate old sessions.

Read current revisions with `GET /api/stall/state`. A stale revision is refused. Agent state and draft responses exclude internal notes/tags; staff payments are omitted from the provider-payment projection. Search/history require a human owner/admin. Agent keys can prepare drafts only; they cannot approve or call reconciliation, erasure, exports, restores, grants or import application. `POST /api/stall/agent-token` grants a preparation key to the signed-in owner; `POST /api/stall/agent-token/revoke` revokes the owner's grants. Tokens are returned once and should never enter source, logs or tickets.

State reads also refresh actual Pier dispatches for paid, linked orders and save changes as `shipment.observed`, without creating a dispatch. `shipment.dispatches` preserves the references, times, tracking and delivery states Pier supplies. All purchased quantities must have dispatched before the order becomes `shipped`; a partial dispatch has `shipment.status: "partial"` and must be completed in Pier. `shipmentSync.checkedAt` records a successful check; `shipmentSync.error` names a failed check while leaving recorded orders available. Reconcile performs the same readback before resuming pending work.

Checkout is a separate public door: `GET /api/stall/catalogue` returns active listings with Pier-observed availability. `POST /api/stall/checkout` takes `{customerEmail,lines:[{sku,quantity}],idempotencyKey}`. Generate one random UUIDv4 per customer checkout attempt and retain it for retries of that same cart. The server calculates prices; client-supplied totals do not decide payment. It returns Stripe's hosted URL.

If a provider times out, keep the same order, shipment or refund. Reconcile or repeat its same approval instead of creating another financial action. Pending effects retain their idempotency identity. Never retry a Checkout/refund POST beyond Stripe's idempotency retention horizon without resolving it in Stripe; the application refuses an unsafe late retry. A failed webhook returns a failure for provider redelivery. Check the order history and provider dashboard before making a new action. Shipping/refund approvals remain recorded even while the external request needs recovery.

A shortfall is an explicit paid order needing stock attention. Receive or reallocate stock in Pier, then reconcile. A refund adjusts money only. Packing is represented by the prepared shipping reference; approval records the dispatch. Carrier bookings, rates, tax calculation and automatic physical return processing are outside this release.
