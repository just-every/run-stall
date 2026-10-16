# Target acceptance

The contract is the complete target online store for a US retailer or maker, USD first. The bullets retain this repository's user-journey form; each maps one-to-one to a stable published CONTRACT.md clause. Status is against `7eadb4b8faebf02302be95217ca8c2807fe5d986`, using the supplied code audit and source/tests at that unchanged application commit. `partial`/`missing` bullets are work to build, not passing tests. Current source evidence follows each bullet; production readiness also needs the named provider/hosted/device acceptance.

Exercise these journeys through the built shop, merchant/customer/native app or documented HTTP/CLI doors, never a private helper alone. Use realistic variants, US addresses and exact USD totals; test fixtures/fakes are confined to tests at paid/network edges. Check changed screens at 1440 and 390 pixels; capture actual provider outcomes separately from local simulated edges. Tests stay focused on meaningful buyer flows rather than pinning document copy or clause counts. No code, UI or test changes are part of this document revision.

## Runtime and store experience

- **HTTP-001 — Real installed and published HTTP surfaces.** **done** — Build and serve the emitted Worker; GET /health, /, /shop and built assets, then unknown document/API paths. Verify successful responses and real 404 status codes; build the run site and follow its public links.

  Current evidence: `src/server.ts`; `src/base/static-assets.ts`; `tests/runtime.mjs`; `tests/ui/journey.mjs`. Existing runtime and run-site journeys cover these doors; hosted performance is unmeasured.

- **STORE-001 — Merchant themes, page builder and custom domain.** **partial** — In the merchant desk create a reusable hero/product section, preview on desktop and phone, publish to a verified test domain, then roll back. Follow HTTPS and www/canonical redirects and confirm existing product links and orders survive.

  Current evidence: `src/stall/ui/shop.tsx`; `src/stall/ui/primitives.tsx`. A fixed branded storefront exists; theme selection, visual building, domain management and theme revision controls are absent.

- **STORE-002 — Navigation, collections and product discovery.** **missing** — Publish a varied catalogue, navigate collections, search and combine filters on desktop and phone. Change publication and stock, refresh the public results, and verify matching counts, saved URLs and a useful no-results state.

  Current evidence: no implementation found.

- **STORE-003 — Content, blog and search visibility.** **missing** — Create and schedule a blog post and policy page through the desk, publish a product with SEO metadata, fetch its rendered HTML/sitemap, and rename its slug. Verify old URLs redirect once and unpublished content is absent from public search and feeds.

  Current evidence: no implementation found.

- **MOBILE-001 — Accessible mobile shopping and merchant work.** **partial** — Use the built storefront and desk at both widths to buy variants, recover a validation failure, read order status, request a return and process it. Complete the same essential controls by keyboard and inspect accessible names and focus after dialogs/errors.

  Current evidence: `src/stall/ui/shop.tsx`; `src/stall/ui/app.tsx`; `tests/ui/journey.mjs`. The existing narrow shop/desk journey covers both widths; expanded flows and full accessibility conformance are unimplemented or unverified.

- **MOBILE-002 — Native merchant apps and timely order attention.** **missing** — On each platform receive a new-order notification, scan a purchased SKU, prepare fulfilment offline, change the order elsewhere, and reconnect. Verify the conflict requires fresh approval; revoke the device and confirm private reads and actions fail.

  Current evidence: no implementation found.

## Catalogue and stock

- **CATALOG-001 — Products, variants and media.** **partial** — Create a product with size/color variants, multiple images, cost, weight and tax category; publish an approved revision. Buy one variant, change its current price and archive another; verify gallery/selection and immutable order snapshots through public product and order views.

  Current evidence: `src/stall/products.ts`; `src/stall/model.ts`; `tests/api/commerce.test.mjs`. SKU/name/description/exact-cent price and reviewed publication exist; variants, media, attributes, cost and shipping fields do not.

- **CATALOG-002 — Bulk catalogue operations and portable files.** **partial** — Upload a mixed valid/invalid catalogue file, inspect a read-only preview, apply the reviewed rows, resume an interrupted batch, export them and undo untouched changes. Edit/purchase an imported SKU first and verify undo reports the protected row rather than overwriting it.

  Current evidence: `src/stall/imports/service.ts`; `src/stall/imports/targets.ts`; `tests/api/imports.test.mjs`. Reviewed, journaled, reversible six-column Shopify product CSV import exists; broad schemas, bulk editing and product CSV export are absent.

- **STOCK-001 — Live availability through Pier or another stock system.** **partial** — Connect Pier, publish variants across two locations, make an external stock change and verify public availability. Repeat via the documented alternate adapter; test backorder refusal/allowed lead time, stale stock and duplicate reservation events with matching stock-provider references.

  Current evidence: `src/stall/pier.ts`; `src/stall/payments.ts`; `tests/api/commerce.test.mjs`. Pier bin availability and paid-order reservations exist; Pier is currently mandatory and configurable location/backorder policy and alternate adapters are absent.

- **STOCK-002 — Expiring checkout holds and stock race resolution.** **partial** — Two shoppers attempt the last unit through checkout. Expire one hold and fail another payment; verify releases. Deliver late/duplicate success and lose a reservation response; confirm one reservation or a visible paid-shortfall case resolved by the shopper-approved outcome.

  Current evidence: `src/stall/checkout.ts`; `src/stall/payments.ts`; `src/stall/orders.ts`; `tests/api/commerce.test.mjs`. Checks before checkout and post-payment reservation/reconciliation exist; prepayment holds, expiry and shopper shortfall resolution do not.

## Cart, payment and commercial totals

- **CART-001 — Persistent cart and guest or account checkout.** **partial** — Build a multi-variant cart, reload and sign in, choose a US address and delivery method, apply a discount/gift card and review exact totals. Change price or availability concurrently and verify a fresh review; repeat as a guest and as a different account.

  Current evidence: `src/stall/ui/shop.tsx`; `src/stall/checkout.ts`; `src/stall/stripe.ts`; `tests/api/commerce.test.mjs`. A transient basket, reviewed product total and email guest handoff exist; persistence/accounts/native address and delivery steps are absent, and hosted addresses are AU-only.

- **PAY-001 — US dollar cards, wallets and PayPal.** **partial** — Complete USD purchases with a card, Apple Pay, Google Pay, Link and PayPal through their supported test/eligible-device doors; inspect provider IDs, amount/currency, failure/cancel paths and a same-method refund. A live provider/device acceptance run is required before claiming production wallet readiness.

  Current evidence: `src/stall/stripe.ts`; `src/stall/refunds.ts`; `tests/api/commerce.test.mjs`. Stripe card Checkout/refunds exist in AUD; named wallets, PayPal and USD/US acceptance are unimplemented or untested.

- **PAY-002 — Authorization, capture, cancellation and disputes.** **partial** — Authorize an order without capture, attempt fulfilment, capture once, then process a failed/expired authorization, asynchronous success and dispute event. Duplicate/out-of-order callbacks must preserve actual processor state, correct balance and a visible owner action.

  Current evidence: `src/stall/stripe.ts`; `src/stall/payments.ts`; `src/stall/orders.ts`. Canonical paid-session retrieval exists; distinct authorization/capture, void, dispute and fee lifecycle handling is absent.

- **PAY-003 — Verified payment and duplicate-safe paid reservation.** **done** — Through public checkout and the signed webhook send unpaid, stale, wrongly signed, changed-total and duplicate events; lose the Pier response after its commit, then reconcile. Inspect one payment/order/reservation and durable paid-before-reservation history.

  Current evidence: `src/stall/checkout.ts`; `src/stall/payments.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs`. The current AUD Stripe/Pier flow proves this invariant; it does not establish the broader USD/multiple-provider requirements.

- **PROMO-001 — Discounts, automatic promotions and controlled budgets.** **missing** — Configure overlapping code/automatic campaigns, exercise eligibility and stacking, race the last redemption, cancel one order and partially refund another. Reconcile campaign usage, budget and exact order/tax totals from the merchant report and emitted events.

  Current evidence: no implementation found.

- **PROMO-002 — Gift cards and stored redemption balances.** **missing** — Issue a USD gift card, deliver and redeem it partly, race its remaining balance in two checkouts, and cancel/refund the winning order. Inspect the balance ledger, shopper receipt, staff permissions and reconciled migrated opening balance.

  Current evidence: no implementation found.

- **TAX-001 — US sales tax and exemptions.** **missing** — Configure two US destinations, taxable/exempt goods, a documented exempt customer and discounted shipping. Check provider-backed totals before payment and a partial-return tax adjustment; interrupt the tax provider and verify checkout refuses an unpriced obligation and reports the cause.

  Current evidence: no implementation found.

- **RISK-001 — Fraud indicators and human review.** **missing** — Create low-risk and flagged provider test orders, inspect the restricted queue, attempt fulfilment while held and release/cancel with an authorized reviewer. Repeated risk callbacks must not duplicate holds or messages.

  Current evidence: no implementation found.

## Fulfilment, orders and returns

- **SHIP-001 — Shipping zones, live rates, pickup and delivery.** **missing** — Quote different US ZIPs and package weights with live provider test rates, select pickup/local delivery, change address after selection and verify repricing. Refuse unsupported zones and show actionable carrier outages; the paid order must retain the selected service and quoted charge.

  Current evidence: no implementation found.

- **SHIP-002 — Purchase, print and void carrier labels.** **missing** — Buy and print a label for each supported carrier through a connected shipping provider, lose one successful response, reconcile it, then void an unused label and buy a return label. Verify one charge/label per operation, usable documents and restricted access.

  Current evidence: no implementation found.

- **SHIP-003 — Split fulfilment, tracking and delivery exceptions.** **partial** — Split a two-line order across locations, dispatch one parcel, then the remainder; receive duplicate, out-of-order, delayed and delivered tracking callbacks. Verify each shopper view/email and remaining quantity, and open an exception when scans go stale.

  Current evidence: `src/stall/fulfilment.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs`. One approved whole-order Pier shipment/reference exists; splits, carrier tracking and delivery messaging are absent.

- **ORDER-001 — Complete retail order desk.** **partial** — Create a manual order and a storefront order, assign staff and notes, filter an overdue partial shipment, and open its full history. Change a catalogue price/customer address and verify historical commercial snapshots and original provider references remain.

  Current evidence: `src/stall/model.ts`; `src/stall/orders.ts`; `src/stall/ui/orders.tsx`; `src/stall/ui/presentation.tsx`. Payment/reservation/shipment/refund records and a one-page desk exist; broader search, notes, manual orders and US time-zone behavior are absent; current times use Australia/Perth.

- **ORDER-002 — Exact shipment approval and one dispatch.** **done** — Prepare a shipment through the desk/command route, reject a stale revision, lose the approved dispatch response, reconcile and repeat approval. Inspect one Pier shipment, released reservation and matching stock ledger quantities.

  Current evidence: `src/stall/fulfilment.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs`. Proven for current whole-order Pier shipments; carrier and partial-fulfilment breadth remains SHIP-002/003.

- **ORDER-003 — Reviewed line refunds without duplicate money movement.** **done** — Refund one line of a shipped two-line order, lose the processor response, reconcile and repeat approval. Reject a stale or duplicate/over-value refund and inspect one processor refund, unchanged retained line and no stock return.

  Current evidence: `src/stall/refunds.ts`; `src/stall/orders.ts`; `tests/api/commerce.test.mjs`. The AUD shipped-line partial-refund flow is covered; pre-shipment cancellation, tax/shipping adjustments and return receipt remain separate target work.

- **ORDER-004 — Versioned edits, cancellation and claims.** **partial** — Race two edits on an unfulfilled order, obtain shopper approval of a changed total, cancel before and after capture, and resolve a lost-parcel claim. Verify stale edits fail and each capture/void/refund/stock release and customer notice reconciles once.

  Current evidence: `src/stall/store.ts`; `src/stall/fulfilment.ts`; `src/stall/refunds.ts`. Revision checks exist for current drafts/effects; general edits, cancellation and claims are absent.

- **RETURN-001 — Customer self-service returns, cancellations and exchanges.** **missing** — As guest and account customers request a cancellation, partial return and size exchange; test expired/final-sale items and another customer's link. Verify staff notification, an explained decision, exchange reservation and customer-visible progress without duplicate requests.

  Current evidence: no implementation found.

- **RETURN-002 — Physical receipt, restocking and reconciled resolution.** **partial** — Return one damaged and one resellable unit, purchase/track a label, record staff inspection, quarantine one and restock the other, then refund or exchange. Lose stock/refund responses and reconcile to one receipt, one financial resolution and a closed customer-visible case.

  Current evidence: `src/stall/refunds.ts`; `tests/api/commerce.test.mjs`. Reconciled line refunds deliberately avoid restocking; return authorization, labels, inspection and restock workflow are absent.

## Customers, follow-up and channels

- **CUSTOMER-001 — Customer directory, accounts and order history.** **partial** — Import two similar customer records, resolve a duplicate, place guest/account orders and link only after verified email ownership. Sign in as each customer, recover access and attempt foreign order/address/return reads and writes through direct APIs.

  Current evidence: `src/stall/model.ts`; `src/stall/store.ts`; `tests/api/data.test.mjs`. Orders retain buyer contact/address and commercial history; customer profiles, shopper authentication and self-service history are absent.

- **CUSTOMER-002 — Consent, preferences and customer privacy.** **partial** — Import subscribed/unsubscribed/unknown contacts, change preferences at checkout/account, unsubscribe through a delivered message and inspect downstream suppression. Request access/erasure and restore an older archive with the later journal; verify no marketing reactivation or foreign customer access.

  Current evidence: `src/stall/erasure.ts`; `src/stall/portability-policy.mjs`; `tests/api/data.test.mjs`. Owner-directed contact erasure and later-journal fencing exist; consent/preferences, account requests and marketing propagation are absent.

- **MAIL-001 — Transactional confirmations and delivery evidence.** **missing** — Buy, split-ship, deliver, return and refund an order through public doors; inspect the corresponding provider messages and safe order links. Repeat callbacks, inject a bounce and lose a send response; verify deduplication, visible uncertainty and staff follow-up without falsely claiming inbox receipt.

  Current evidence: no implementation found. Shared sign-in mail infrastructure does not implement order/customer transactional notifications.

- **RECOVERY-001 — Abandoned-checkout recovery to a valid basket.** **missing** — Abandon guest/account checkouts, advance the configured schedule, receive one recovery message and return through its link after price/stock changes. Buy, unsubscribe and erase before later steps; verify suppression, expiry, renewed review and accurate recovered-order attribution.

  Current evidence: no implementation found.

- **MARKET-001 — Mango and consent-aware lifecycle marketing connections.** **missing** — Authorize Mango and each supported marketing adapter, preview a segment/event backfill, place and refund an order and withdraw consent. Inspect matching event identities and suppressed contact state downstream; revoke the connector and verify pending sends stop and failures remain actionable.

  Current evidence: no implementation found.

- **CHANNEL-001 — Google Shopping, Meta/Instagram and TikTok Shop.** **missing** — Connect each named channel, publish a variant, inspect a rejection and correct it, then change price/stock. In each supported order sandbox import an order and duplicate event, ship/refund it and verify remote status, one reservation and channel-attributed analytics; test revoked channel access.

  Current evidence: no implementation found.

- **CHANNEL-002 — Marketplace adapters without becoming a marketplace.** **missing** — Connect each selected marketplace through Webgility or its supported adapter, backfill and replay an order/refund, change stock and reconcile fees. Show one retail order/stock effect and matching ledger entries, with a visible unresolved mapping case.

  Current evidence: no implementation found.

- **REVIEWS-001 — Verified reviews, upsells and cross-sells.** **missing** — Fulfil an order, send a permitted review request via the configured Yotpo/native door, moderate a reported review and show purchase provenance. Add a recommended bundle to cart, exhaust one component and verify the offer updates without overselling.

  Current evidence: no implementation found.

## Reporting, accounting and migration

- **ANALYTICS-001 — Sales, conversion and contribution margin.** **missing** — Follow a known visitor-to-refund journey, import historical sales, replay events and compare channel/date totals with orders and processor/accounting references. Remove cost/analytics consent and verify unknowns are labeled rather than fabricated margin or visits.

  Current evidence: no implementation found.

- **ACCOUNT-001 — Reconciled QuickBooks Online and NetSuite posting.** **missing** — Preview account/tax mappings, post a sale, gift redemption, partial refund, fee and payout to QuickBooks Online and the selected NetSuite adapter sandbox. Replay, lose a response and correct an account rejection; reconcile net sales, tax liability and cash to provider and exported records.

  Current evidence: no implementation found.

- **MIGRATE-001 — Full reviewed Shopify migration.** **partial** — Use Shopify exports and authorized API data for a representative store; dry-run counts/values and redirects, apply/resume, reconcile customers/orders/refunds/balances, then import the cutover delta. Open old links and customer history; verify no external money/stock/mail effects and undo preserves later native work.

  Current evidence: `src/stall/imports/csv.ts`; `src/stall/imports/service.ts`; `tests/api/imports.test.mjs`. Only a bounded six-column product CSV stages simple unpublished products; full Shopify objects, media, variants, customers, orders and redirects are absent.

- **MIGRATE-002 — Squarespace Commerce migration.** **missing** — Import a representative Squarespace store via its available export/API doors, supplement missing source fields in the preview and reconcile variant/customer/order/refund counts and values. Cut over old URLs, verify history and customer reactivation, and prove imports cause no payment, stock or email side effects.

  Current evidence: no implementation found.

- **MIGRATE-003 — BigCommerce migration.** **missing** — Preview and apply a BigCommerce export/API migration containing variant options, partial shipment/refund, a gift liability and redirects; reconcile source counts and totals, rerun the delta and verify no duplicate objects, stock reservations, charges or notices.

  Current evidence: no implementation found.

- **MIGRATE-004 — WooCommerce and extension migration.** **missing** — Import a WooCommerce store with variable products, a refunded order and representative extension/custom fields. Inspect omissions/mappings before apply, reconcile source values and URL redirects, then repeat the delta and customer activation without replaying historic sales.

  Current evidence: no implementation found.

- **MIGRATE-005 — Open-engine and creator-store move-in.** **missing** — For each named source preview an authorized export/API sample and source-field coverage, apply and resume its mapped catalogue/customer/order history, reconcile totals/redirects and explicitly resolve unavailable creator-production/subscription records before cutover.

  Current evidence: no implementation found.

- **MIGRATE-006 — Cutover completeness, source limitations and outstanding liabilities.** **partial** — For each source in MIGRATE-001/002/003/004/005 import continuation rows, variants/modifiers, guest orders, unknown consent, a partially refunded order and a gift liability; interrupt pagination and resume. Retire a source image URL and follow old product/content URLs. Inspect count/value/omission reports, resolve collisions, activate a customer and verify no password, new charge, renewal, stock or message side effect comes from historical data.

  Current evidence: `src/stall/imports/service.ts`; `src/stall/imports/targets.ts`; `tests/api/imports.test.mjs`. Current product import binds reviewed source/native snapshots and protects undo; complete cross-platform cutover, media, redirects, customer activation and outstanding liability handling are absent.

- **EXPORT-001 — Business CSVs and complete merchant exit.** **partial** — Export a populated shop through the desk/API and open its product/customer/order/payment CSVs and complete archive in an independent reader. Reconcile records and exact totals, verify explicit bounds/exclusions and refuse an unauthorized export.

  Current evidence: `src/stall/tools.ts`; `src/stall/portability-policy.mjs`; `tests/api/data.test.mjs`. Complete supported commercial archives exist; business CSVs and new target-object exports are absent.

## Roles, integrations and dependable operations

- **ROLE-001 — Staff and app least privilege.** **partial** — Invite each role, perform its permitted workflow and try foreign customer, finance, bulk/export and direct API actions. Downgrade/revoke an active session/app grant during a prepared job and verify the next effect is refused without leaking private records.

  Current evidence: `src/stall/access.ts`; `src/stall/model.ts`; `src/stall/api.ts`; `tests/api/commerce.test.mjs`; `tests/api/data.test.mjs`. Native owner/admin/member roles and revocation exist; functional staff scopes, refund limits and customer/app roles are absent.

- **AGENT-001 — Human approval of exact agent drafts.** **partial** — Grant an agent credential, prepare a product draft, attempt its approval/export/erasure as the agent and reject each, approve as a human, then revoke the grant and retry direct reads/writes. Prepare shipping/refund drafts through the same policy and require exact human approval.

  Current evidence: `src/stall/api.ts`; `src/stall/products.ts`; `src/stall/fulfilment.ts`; `src/stall/refunds.ts`; `tests/api/commerce.test.mjs`; `tests/api/data.test.mjs`. All three preparation commands and human-only approval guards exist; checked-in agent journey directly exercises product drafting, not agent shipment/refund preparation end to end.

- **API-001 — Documented headless API and signed events.** **partial** — Use a documented external storefront client to buy and view its own order, subscribe to signed events and reject a tampered delivery. Replay and reorder callbacks, revoke its credential and verify one commercial effect and bounded access.

  Current evidence: `src/stall/api.ts`; `src/stall/payments.ts`; `src/stall/tools.ts`; `tests/api/commerce.test.mjs`. Current JSON commerce doors and incoming Stripe signatures exist; versioned customer/cart APIs, external app scopes and outgoing event subscriptions are absent.

- **FLOW-001 — Event and scheduled workflows with visible follow-up.** **partial** — Configure low-stock, overdue fulfilment, return-request and scheduled reconciliation rules; dry-run and activate them, replay events and stop a rule with pending work. Inspect one task/effect per event and correct owner/due date, not a silent failed background job.

  Current evidence: `src/stall/payments.ts`; `src/stall/orders.ts`. A fixed paid-event reservation transition exists; configurable rules, timers, tasks and notifications are absent.

- **INTEGRATION-001 — Owned connections and recoverable external work.** **partial** — Revoke/rotate an account during queued work, lose successful responses at each provider edge and restart the worker. Inspect pending/uncertain work, reconcile by original reference, and prove no new effect identity or secret appears in UI, logs, exports or restored authority.

  Current evidence: `src/stall/orders.ts`; `src/stall/stripe.ts`; `src/stall/pier.ts`; `src/stall/portability-policy.mjs`; `tests/api/commerce.test.mjs`. Stripe/Pier deterministic effects and manual reconciliation exist; generalized connection controls, secret custody and durable jobs for all target providers are absent or unverified.

- **SECURITY-001 — Guarded native commerce doors.** **done** — Call private state, product commands, imports and exports anonymously/as a member; attempt cross-origin browser mutation and an agent approval; revoke the grant and repeat. All fail without the prohibited write or private response, while public catalogue and valid checkout remain usable.

  Current evidence: `src/stall/access.ts`; `src/stall/api.ts`; `src/stall/tools.ts`; `tests/api/commerce.test.mjs`; `tests/api/imports.test.mjs`; `tests/api/data.test.mjs`. This is the existing native-role security slice, not proof of future customer/app roles or a complete security assessment.

- **DATA-001 — Validated archive and inactive receiving authority.** **done** — Export a populated shop with imports and commerce history, restore through the public portability doors into an empty installation and reconcile records. Attempt changed bytes and a second restore, then try source session/grant credentials at the destination; verify refusal and no provider replay.

  Current evidence: `src/stall/tools.ts`; `src/stall/portability-policy.mjs`; `tests/api/data.test.mjs`. The current supported data/archive slice is covered; new target records must join its schema and inactive-restore policy before those clauses can be done.

- **ERASURE-001 — Owner-directed contact erasure and backup fencing.** **done** — Attempt erasure before shipment and with wrong confirmation, then resolve work and erase. Inspect retained totals/approvals with no contact/address/fingerprint; restore a post-erasure archive and refuse an old archive when supplied the later journal, with no partially restored rows.

  Current evidence: `src/stall/erasure.ts`; `src/stall/portability-policy.mjs`; `tests/api/data.test.mjs`. Current customer-contact erasure is covered; broader account/consent deletion remains CUSTOMER-002.

- **AUDIT-001 — Durable attributable commercial action history.** **done** — Run a purchase, human approvals, reconciliation, agent grant/revoke and erasure through public commands, read activity and export/restore the shop. Verify relevant actor/action/time and approval/provider references remain without restoring erased customer contact.

  Current evidence: `src/stall/access.ts`; `src/stall/api.ts`; `src/stall/store.ts`; `tests/api/commerce.test.mjs`; `tests/api/data.test.mjs`. Current actions write st_audit and commercial history; the desk exposes its latest 200 rows. A cryptographic/tamper-evident audit is not claimed.

- **OPS-001 — Owned installation, recovery and explicit operating limits.** **partial** — Follow the fresh-clone RER journey, retain owner/data/settings across reruns, export/restore, stop/restart and diagnose an unavailable required provider. Inspect health and outstanding jobs, bounded storage/cost declarations and outside requests; no claim of capacity, zero egress or hosted readiness is inferred from a local build.

  Current evidence: `SEED-COMMAND-CONTRACT.md`; `scripts/operations-config.mjs`; `tests/clone-journey.mjs`; `tests/runtime.mjs`. The RER command path and local clone/runtime journeys exist; operating costs/capacity and generalized background/provider health are unmeasured or absent.

- **BASE-001 — Preserved Base guarantees with scoped replacements.** **partial** — Use native direct-door authorization tests and archive/erasure journeys, submit hostile product/import text and unsupported input, and inspect export/client bytes for authority. When rich content/media/providers are added, exercise their public upload/render/connect/erase doors under the same guarantees and document any explicit replacement with evidence.

  Current evidence: `src/stall/imports/description.ts`; `src/stall/imports/csv.ts`; `src/stall/portability-policy.mjs`; `tests/api/imports.test.mjs`; `tests/api/data.test.mjs`. Current plain-text/import and archive policies are inspectable; future rich content/media safety and a full Base conformance assessment are not established.

## Push further: agents operate the commerce job

- **AI-001 — Operate order exceptions to shopper-approved closure.** **partial** — Create a paid stock shortfall and a carrier delay. Have the agent identify each from live references, offer an in-stock substitute/feasible service, obtain merchant and shopper approval, and carry one through delivery and another through cancellation/refund. Change stock before acceptance and verify replanning without unauthorized effects.

  Current evidence: `src/stall/payments.ts`; `src/stall/orders.ts`; `tests/api/commerce.test.mjs`. Paid/shortfall states and manual lost-response recovery exist; detection agent, grounded shopper replies, options and closure workflow are absent.

- **AI-002 — Manage returns end to end.** **partial** — Ask for a return in the authenticated customer experience, let the agent prepare policy-grounded options and a label, record a human inspection that changes one item's condition, then approve resolution. Lose a restock/refund response and confirm the agent reconciles both once and leaves a refused/disputed case with an assigned human.

  Current evidence: `src/stall/refunds.ts`; `tests/api/commerce.test.mjs`. Revision-approved reconciled refunds are a foundation; policy reasoning, labels, return receipt, restock and agent follow-through are absent.

- **AI-003 — Improve profitable conversion with measured experiments.** **missing** — With real measured store data configure an experiment, inspect the agent's source-backed proposal and unknowns, approve a bounded change, then observe conversion lift with margin erosion/returns. Verify stop/rollback, stock feasibility and an honest inconclusive result where sample or cost evidence is inadequate.

  Current evidence: no implementation found.

- **AI-004 — Recover failed integration work without invented success.** **partial** — Lose a successful processor/stock/label/ledger response and supply an out-of-order event. Inspect the agent's cited diagnosis and proposed correction, approve the material action, and verify one external effect and matched stock/money/ledger totals. Revoke policy during work and confirm it stops before a new effect.

  Current evidence: `src/stall/orders.ts`; `src/stall/stripe.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs`. Manual Stripe/Pier reconciliation preserves original identities; agent diagnosis, label/mail/channel/ledger recovery and policy execution are absent.

- **AI-005 — Grounded merchandising and channel preparation.** **missing** — Provide an incomplete product and image set, inspect proposed text/attributes with source citations and unanswered questions, approve selected changes and validate the channel draft. Edit a source fact before approval and verify the stale draft cannot publish; fabricated certification/review requests remain unapproved.

  Current evidence: no implementation found.

## Product separation and specialist extensions

- **BOUNDARY-001 — Separate products with usable commerce connections.** **partial** — Operate the storefront/order desk with a documented alternate stock/marketing adapter, then connect Pier/Mango and inspect the handoffs. Verify warehouse purchasing/wholesale work and cross-campaign marketing open the linked product while retail orders and recovery remain manageable in Stall.

  Current evidence: `src/stall/pier.ts`; `src/stall/api.ts`. Pier is a separate product adapter today, but mandatory; Mango and alternative-provider handoffs are absent.

- **EXTEND-001 — Subscriptions, POS and creator fulfilment partners.** **missing** — Connect the selected subscription, POS and production provider test accounts; renew/cancel a subscription, complete/refund a POS sale and track a made-to-order product. Reconcile linked retail orders, tax, stock and payouts, and surface provider rejection without claiming fulfilment.

  Current evidence: no implementation found.

- **EXPAND-001 — Multiple stores, regions and currencies.** **missing** — Create a second storefront with a different catalogue/price list, locale and currency; buy, partially refund and report in each. Verify domain/catalogue/role isolation, original-currency reconciliation and refusal of a region lacking configured tax or delivery support.

  Current evidence: no implementation found.

- **B2B-001 — Business buying without absorbing wholesale operations.** **missing** — Approve a company buyer, submit a quoted basket/PO, receive authorized pricing/terms from Pier or a wholesale adapter and accept it in the store. Reject an unauthorized employee or expired exemption; reconcile the approved order, shipment and QuickBooks invoice without a second wholesale ledger.

  Current evidence: no implementation found.

## Current executable journeys and limits

- `pnpm exec node --test --test-concurrency=1 tests/api/commerce.test.mjs` exercises exact checkout, signed paid events, one real fixture-Pier reservation/dispatch, line-refund recovery and native role/agent controls. Stripe is a test network edge. The present flow uses AUD/AU; a passing run does not prove USD, US tax/rates, PayPal or wallet acceptance.
- `pnpm exec node --test --test-concurrency=1 tests/api/imports.test.mjs` exercises read-only reviewed Shopify product preview/apply, journal/source custody, malformed input, resume and undo fencing. This is not full Shopify or other-incumbent migration.
- `pnpm exec node --test --test-concurrency=1 tests/api/data.test.mjs` exercises owner-only transfer, empty restore, tampering and source-authority exclusion, contact erasure and old-backup refusal with an explicitly supplied later journal. It does not erase provider-held data or independently inform an isolated offline backup of later erasure.
- `pnpm run test:browser` follows the current built UI through move-in/publication, two-product checkout, shipment/refund, archive/restore, agent revocation and erasure at 1440 and 390. This remains the current narrow journey; no future account, tax, carrier, channel or agent-operator capability is implied.
- `pnpm run test:runtime` checks HTTP-001 against emitted output after build. `pnpm run test:clone` covers the pinned RER fresh-clone lifecycle. `pnpm run check --profile first-party` checks the maintained command declarations; CI remains the full verification wall.

Provider credentials, approvals and original idempotency references must stay local and private. No current proof claims live provider acceptance, inbox receipt, physical delivery, WCAG conformance, load capacity or operating cost. The target requires those measurements as applicable rather than excluding their features. No test or contract check may be weakened to make these documents pass.

Target clause totals: **8 done / 29 partial / 27 missing** (64 total).
