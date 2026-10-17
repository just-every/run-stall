# Target acceptance

The contract is the complete target online store for a US retailer or maker, USD first. The bullets retain this repository's user-journey form; each maps one-to-one to a stable published CONTRACT.md clause. Status is against `7eadb4b8faebf02302be95217ca8c2807fe5d986`, using the supplied code audit and source/tests at that unchanged application commit. `partial`/`missing` bullets are work to build, not passing tests. Current source evidence follows each bullet; production readiness also needs the named provider/hosted/device acceptance.

Exercise these journeys through the built shop, merchant/customer/native app or documented HTTP/CLI doors, never a private helper alone. Use realistic variants, US addresses and exact USD totals; test fixtures/fakes are confined to tests at paid/network edges. Check changed screens at 1440 and 390 pixels; capture actual provider outcomes separately from local simulated edges. Tests stay focused on meaningful buyer flows rather than pinning document copy or clause counts. No code, UI or test changes are part of this document revision. Revised 17 October 2026 for the homepage claims: DEMO-001, CUSTOMER-003, OPS-002 and OPEN-001 were added and judged against `b4fc3b0ac94fd95df7ca1371cf52ba440554cb2c`, and seven acceptance journeys were sharpened (CONTRACT.md Status); earlier statuses are unchanged.

## Runtime and store experience

- **HTTP-001 — Real installed and published HTTP surfaces.** **done** — Build and serve the emitted Worker; GET /health, /, /shop and built assets, then unknown document/API paths. Verify successful responses and real 404 status codes; build the run site and follow its public links.

  Current evidence: `src/server.ts`; `src/base/static-assets.ts`; `tests/runtime.mjs`; `tests/ui/journey.mjs`. Existing runtime and run-site journeys cover these doors; hosted performance is unmeasured.

- **DEMO-001 — Hosted demo shop that sends nothing.** **partial** — Follow the built homepage's Try the demo link to the hosted demo and verify a 200 response showing the sample shop. In the demo buy from the public shop, approve the prepared refund and a packed order's shipment, and invite a teammate; verify the order is paid and reserved, the refund and dispatch succeed against the simulated providers, and no outbound provider request or mail leaves. Attempt a production build and deploy with `RER_DEMO=1` and verify refusal; start a fresh installation and verify it holds no demo record.

  Current evidence: `src/demo.ts`; `src/stall/demo/providers.ts`; `src/site/shell/links.ts`; `tests/api/demo.test.mjs`. The demo shop, simulated Stripe/Pier and an outbound-free purchase/approval test exist and the homepage links the hosted demo; no checked-in check follows that link to the hosted demo, and Stall's own tests do not exercise the production refusal of demo mode or an empty fresh installation.

- **STORE-001 — Merchant themes, page builder and custom domain.** **partial** — In the merchant desk pick a starter theme from the library, create a reusable hero/product section, preview it on desktop and phone, and publish to a verified test domain. Switch to a second library theme and back, confirm every page, menu, collection, product link and order survives, and roll back a revision. Export the theme source and assets, re-import them into an empty store and compare the rendered pages; import a damaged archive and verify a named refusal. Enable the storefront password and confirm public pages, sitemap and feeds are withheld while staff preview works. Follow HTTPS and www/canonical redirects, and record a Core Web Vitals run of the reference theme at 390 pixels.

  Current evidence: `src/stall/ui/shop.tsx`; `src/stall/ui/primitives.tsx`. A fixed branded storefront exists; the theme library, switching, duplication, export/re-import, visual building, storefront password, domain management, revision controls and a measured performance run are absent.

- **STORE-002 — Navigation, collections and product discovery.** **missing** — Publish a varied catalogue, navigate collections, search and combine filters on desktop and phone. Change publication and stock, refresh the public results, and verify matching counts, saved URLs and a useful no-results state. Add a synonym and a pinned product for a query and verify both change results; search a term with no results and find it in the search report.

  Current evidence: no implementation found.

- **STORE-003 — Content, blog, contact, newsletter and search visibility.** **missing** — Create and schedule a blog post and policy page through the desk, publish a product with SEO metadata, fetch its rendered HTML/sitemap, and rename its slug. Verify old URLs redirect once and unpublished content is absent from public search and feeds. Submit the contact form and confirm it reaches the merchant email with the shopper as reply-to and appears in the desk inbox; submit scripted spam and verify it is held, not delivered or lost. Sign up through the footer, confirm the subscriber has source, page and timestamp, and verify the same consented subscriber appears once in Mango and in a Klaviyo or Mailchimp test account; repeat the signup and verify no duplicate.

  Current evidence: no implementation found. Target journey not implemented, including the contact form and newsletter signup.

- **MOBILE-001 — Accessible mobile shopping and merchant work.** **partial** — Use the built storefront and desk at both widths to buy variants, recover a validation failure, read order status, request a return and process it. Complete the same essential controls by keyboard and inspect accessible names and focus after dialogs/errors. Run an automated WCAG 2.2 AA scan, including its color-contrast rule, on each storefront, checkout, account and desk page at both widths and verify no violations.

  Current evidence: `src/stall/ui/shop.tsx`; `src/stall/ui/app.tsx`; `tests/ui/journey.mjs`. The existing narrow shop/desk journey covers both widths; expanded flows and full accessibility conformance are unimplemented or unverified.

- **MOBILE-002 — Native merchant apps and timely order attention.** **missing** — On each platform receive a new-order notification, scan a purchased SKU, prepare fulfilment offline, change the order elsewhere, and reconnect. Verify the conflict requires fresh approval. Edit a product's title and price and add a photo taken with the device camera, and verify the change goes through the same revision approval and appears on the storefront with the photo served from owned storage. Mark a pickup order ready and picked up from the app (SHIP-007) and verify one notice and one dispatch. Revoke the device and confirm private reads and actions fail.

  Current evidence: no implementation found.

## Catalogue and stock

- **CATALOG-001 — Products, variants and media.** **partial** — Create a product with size/color variants, multiple images, cost, weight, tax category, HS code, country of origin and a size-chart custom field; publish an approved revision and verify the custom field renders on the product page. Buy one variant, change its current price and archive another; verify gallery/selection and immutable order snapshots through public product and order views. Add an engraving field (20 characters, +$5) and an artwork upload to a product, refuse over-length text and a disallowed file type, buy with valid personalization and verify it with the add-on price on the cart, order, packing slip and confirmation email.

  Current evidence: `src/stall/products.ts`; `src/stall/model.ts`; `tests/api/commerce.test.mjs`. SKU/name/description/exact-cent price and reviewed publication exist; variants, media, attributes, custom fields, personalization, cost, shipping and customs fields do not.

- **CATALOG-002 — Bulk catalogue operations and portable files.** **partial** — Upload a mixed valid/invalid catalogue file, inspect a read-only preview, apply the reviewed rows, resume an interrupted batch, export them and undo untouched changes. Edit/purchase an imported SKU first and verify undo reports the protected row rather than overwriting it. Bulk-edit on-hand quantities in the grid and by an inventory CSV, once with store-managed stock and once with Pier connected, and verify each change appears once in the stock authority's history with a matching reference.

  Current evidence: `src/stall/imports/service.ts`; `src/stall/imports/targets.ts`; `tests/api/imports.test.mjs`. Reviewed, journaled, reversible six-column Shopify product CSV import exists; broad schemas, bulk editing, quantity and inventory-CSV updates and product CSV export are absent.

- **STOCK-001 — Live availability through Pier or another stock system.** **partial** — Connect Pier, publish variants across two locations, make an external stock change and verify public availability. Adjust a variant's on-hand quantity from the product editor, the bulk editor and an inventory CSV and verify each adjustment lands once in Pier with matching references. Repeat both via the documented alternate adapter; test backorder refusal/allowed lead time, stale stock and duplicate reservation events with matching stock-provider references. Set a safety stock of 2 on a variant with 5 on hand and verify the storefront sells exactly 3 before showing it sold out.

  Current evidence: `src/stall/pier.ts`; `src/stall/payments.ts`; `tests/api/commerce.test.mjs`. Pier bin availability and paid-order reservations exist; selling still requires Pier (checkout binds every order to the Pier origin/customer). Configurable location/backorder policy, Stall-originated quantity adjustments and alternate adapters are absent.

- **STOCK-002 — Expiring checkout holds and stock race resolution.** **partial** — Two shoppers attempt the last unit through checkout. Expire one hold and fail another payment; verify releases. Deliver late/duplicate success and lose a reservation response; confirm one reservation or a visible paid-shortfall case resolved by the shopper-approved outcome. While the first shopper's hold is live, verify the second shopper is told the last unit is held, with the hold's remaining time, and cannot pay for it, and that it becomes buyable again as soon as the hold expires or that payment fails.

  Current evidence: `src/stall/checkout.ts`; `src/stall/payments.ts`; `src/stall/orders.ts`; `tests/api/commerce.test.mjs`. Checks before checkout and post-payment reservation/reconciliation exist; prepayment holds, expiry and shopper shortfall resolution do not.

- **STOCK-003 — Store-managed quantities and untracked items without a stock system.** **missing** — With no stock system connected, sell and manually fulfil (ORDER-002) a made-to-order untracked variant and a store-managed variant; verify committed and on-hand counts and that the last unit cannot be oversold unless continue-selling is on. Adjust on-hand counts from the editor, bulk editor and CSV with reasons and inspect the adjustment history. Connect Pier, review and apply the opening-balance handoff, and verify later adjustments are written through Pier with matching references while Stall keeps no independent count.

  Current evidence: `src/stall/checkout.ts`; `src/stall/fulfilment.ts`. No implementation found: checkout and dispatch require Pier; untracked variants, store-managed counts and the opening-balance handoff are absent.

## Cart, payment and commercial totals

- **CART-001 — Persistent cart and guest or account checkout.** **partial** — Build a multi-variant cart, reload and sign in, choose a US address and delivery method, add an order note and gift message, apply a discount/gift card and review exact totals. Change price or availability concurrently and verify a fresh review; repeat as a guest, as a different account and with a Canadian address. Verify the note and gift message on the order and packing slip and a gift receipt without prices. Add a required "How did you hear about us?" choice field, verify checkout refuses to continue without it, and find the answer on the order, in the order export and in a report grouped by answer.

  Current evidence: `src/stall/ui/shop.tsx`; `src/stall/checkout.ts`; `src/stall/stripe.ts`; `tests/api/commerce.test.mjs`. A transient basket, reviewed product total and email guest handoff exist; persistence/accounts/native address and delivery steps, personalization and merchant checkout fields are absent, and hosted addresses are AU-only.

- **PAY-001 — US dollar cards, wallets, PayPal, pay-later and manual payments.** **partial** — Complete USD purchases with a card, Apple Pay, Google Pay, Link and PayPal through their supported test/eligible-device doors; inspect provider IDs, amount/currency, failure/cancel paths and a same-method refund. Complete a test-mode Klarna, Affirm, Afterpay and PayPal Pay Later purchase and refund each; verify every pay-later option is withheld, with an explanation, below and above its eligibility range. Verify provider pay-later messaging appears on the product and cart pages with installments computed from the current price, updates when the cart changes, and disappears outside eligibility. Place bank-transfer and pay-at-pickup orders and verify they stay unpaid and unfulfillable until staff record payment. A live provider/device acceptance run is required before claiming production wallet readiness.

  Current evidence: `src/stall/stripe.ts`; `src/stall/refunds.ts`; `tests/api/commerce.test.mjs`. Stripe card Checkout/refunds exist in USD, shipping to US addresses (tested against the Stripe network-edge fake); named wallets, PayPal, pay-later, manual methods and live USD acceptance are unimplemented or untested.

- **PAY-002 — Authorization, capture, cancellation and disputes.** **partial** — Authorize an order without capture, attempt fulfilment, capture once, then process a failed/expired authorization, asynchronous success and dispute event. Assemble and submit evidence for a test dispute on Stripe and PayPal, and verify the processor received it and the won/lost outcome and fee reconcile. Duplicate/out-of-order callbacks must preserve actual processor state, correct balance and a visible owner action.

  Current evidence: `src/stall/stripe.ts`; `src/stall/payments.ts`; `src/stall/orders.ts`. Canonical paid-session retrieval exists; distinct authorization/capture, void, dispute evidence and fee lifecycle handling is absent.

- **PAY-003 — Verified payment and duplicate-safe paid reservation.** **done** — Through public checkout and the signed webhook send unpaid, stale, wrongly signed, changed-total and duplicate events; lose the Pier response after its commit, then reconcile. Inspect one payment/order/reservation and durable paid-before-reservation history.

  Current evidence: `src/stall/checkout.ts`; `src/stall/payments.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs`. The current USD Stripe/Pier flow proves this invariant; it does not establish the broader multiple-provider requirements.

- **PROMO-001 — Discounts, automatic promotions and controlled budgets.** **missing** — Configure each type once as a code and once as an automatic discount: amount and percentage off a product and a collection, amount off the order, a buy-one-get-one and a spend-$X Buy X get Y, and free shipping over $50. Build qualifying and non-qualifying baskets and verify the reviewed checkout totals, line allocations and tax to the cent. Exercise combination rules, race the last redemption of a capped code, generate a batch of unique single-use codes and refuse a second use of one, cancel one order and partially refund another. Reconcile campaign usage, budget and exact order/tax totals from the merchant report and emitted events.

  Current evidence: no implementation found.

- **PROMO-002 — Gift cards and stored redemption balances.** **missing** — Issue a USD gift card, deliver and redeem it partly, race its remaining balance in two checkouts, and cancel/refund the winning order. Inspect the balance ledger, shopper receipt, staff permissions and reconciled migrated opening balance. Try to give a sold card a two-year expiry and verify refusal under the five-year rule, while a promotional card may carry it. With a California store, request cash-out of a $7.50 remaining balance and verify a recorded payout zeroes the ledger, and verify a $15.00 balance is refused cash-out. Issue $20.00 goodwill store credit to a customer with no return, sign in as that customer, see it in the account and apply $12.00 of it at checkout alongside a card; verify the ledger shows $8.00 remaining. Sell a $50.00 gift card through storefront checkout, verify the buyer receives its code by email once payment is verified, and redeem it at checkout on a later order.

  Current evidence: no implementation found.

- **TAX-001 — US sales tax and exemptions.** **missing** — Configure two US destinations, taxable/exempt goods, a documented exempt customer and discounted shipping. Check provider-backed totals before payment and a partial-return tax adjustment; interrupt the tax provider and verify checkout refuses an unpriced obligation and reports the cause. After taxed sales to two states (one with county, city and special-district tax) and a partial refund in the following month, run the liability report for each month and verify the state, jurisdiction and transaction levels and their CSVs reconcile exactly to the order records and tax-provider transaction references, with the refund in its own period. Approach a configured nexus threshold and verify the warning. Quote two US addresses in the same ZIP code that fall in different city or special-district jurisdictions and verify each is charged its own address-level rate.

  Current evidence: no implementation found.

- **RISK-001 — Fraud indicators and human review.** **missing** — Create low-risk and flagged provider test orders, inspect the restricted queue, attempt fulfilment while held and release/cancel with an authorized reviewer. Repeated risk callbacks must not duplicate holds or messages.

  Current evidence: no implementation found.

## Fulfilment, orders and returns

- **SHIP-001 — Shipping zones, live rates, international USD shipping, pickup and delivery.** **missing** — Quote different US ZIPs and package weights with live provider test rates, select pickup/local delivery, change address after selection and verify repricing. Select local pickup and verify the location, hours and instructions are shown and kept on the paid order; enter a ZIP outside the delivery area and verify local delivery is not offered, and below the delivery minimum verify checkout states the amount still needed. Set a 2 p.m. Eastern handling cutoff with one handling day and a holiday the next business day; place orders just before and just after the cutoff and verify promised delivery ranges one business day apart that skip the holiday, kept on each paid order. Quote Canadian and UK addresses in USD with provider rates and verify the duties disclosure. Refuse destinations outside configured zones and show actionable carrier outages; the paid order must retain the selected service and quoted charge. At checkout for a US address verify that live USPS and UPS services are both offered at the provider's current rates, and that a rate changed in the provider test account is reflected in the next quote.

  Current evidence: no implementation found.

- **SHIP-002 — Purchase, print and void carrier labels.** **missing** — Buy and print a label for each supported carrier through a connected shipping provider, lose one successful response, reconcile it, then void an unused label and buy a return label. Buy a label to a Canadian address in USD with HS code and country of origin taken from the product, print the customs form and verify its values; remove a product's HS code and verify purchase is refused with the fix path. With no merchant carrier account connected, buy a USPS label at the provider's rate; then connect a merchant UPS account and verify its negotiated rate is quoted and named. Buy a label insured for a $200 declared value, verify the premium in the reviewed spend and the provider charge, and open a lost-parcel claim from it that carries the insurance reference. Edit the packing-slip template to add a logo, hide prices and add a return note, preview it, and verify the printed slip from a single label and from a batch. Verify one charge/label per operation, usable documents and restricted access. Start each purchase from the order's page in the desk and verify the label prints from there with the order's ship-to address, package and service already filled in.

  Current evidence: no implementation found.

- **SHIP-003 — Split fulfilment, tracking and delivery exceptions.** **partial** — Split a two-line order across locations, dispatch one parcel, then the remainder; receive duplicate, out-of-order, delayed and delivered tracking callbacks. Verify each shopper view/email and remaining quantity, and open an exception when scans go stale.

  Current evidence: `src/stall/fulfilment.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs`. One approved whole-order Pier shipment/reference exists; splits, carrier tracking and delivery messaging are absent.

- **SHIP-004 — Shipping profiles for specific products.** **missing** — Configure a general profile ($6 flat), an oversized profile ($25 flat, UPS Ground only), a free-shipping stickers profile and a furniture profile allowing only local pickup and local delivery. Quote a cart with one general and one oversized item to a US ZIP and verify a single UPS Ground option at exactly $31.00; add a sticker and verify the charge is unchanged; add a furniture item and verify shipped services disappear, pickup and local delivery remain and the cause is named. Send the oversized item to a ZIP its profile does not serve and verify refusal before payment naming that line. Bulk-reassign the oversized products to the general profile through the CATALOG-002 grid and an inventory CSV, verify the open quote is invalidated and the new quote changes, and verify an earlier paid order still shows its original profile revision and charge.

  Current evidence: no implementation found. Target journey not implemented: products carry no shipping profile, weight or rate data.

- **SHIP-005 — Bulk label purchase and batch fulfilment.** **missing** — Select a mixed batch of paid orders: valid domestic orders, one already fulfilled, one pickup-only, one with an undeliverable address and one international order whose product lacks an HS code. Verify each excluded order is skipped with its reason, review per-order services and total spend in the provider test account, change one order's service, and approve the batch once. Lose one provider purchase response and verify reconciliation leaves exactly one label per order and one provider charge each. Download one combined label PDF and one packing-slip PDF and verify their order and count; verify every labelled order is fulfilled with tracking, its stock dispatched once, and each shopper received exactly one shipment notice. Bulk-mark three further orders fulfilled from a tracking CSV and verify the same outcomes.

  Current evidence: `src/stall/fulfilment.ts`. No implementation found: fulfilment prepares and approves one whole-order Pier shipment at a time; batch selection, labels and combined documents are absent.

- **SHIP-006 — Merchant shipping apps and 3PLs as fulfilment connections.** **missing** — Connect a ShipStation test account as the fulfilment connection. Place paid orders and verify each appears in ShipStation exactly once with its service and notes; buy a label there and verify tracking writes back, the Stall order is fulfilled and the shopper gets one shipment notice. Edit an unshipped order's address and cancel another, and verify both propagate; try to cancel a shipped order and verify refusal. Replay the shipment callback and verify no second fulfilment or notice, and verify routed orders are absent from Stall's label batch. Repeat the order-to-shipment journey with a ShipBob or ShipMonk sandbox, including stock read through the 3PL.

  Current evidence: no implementation found. Target journey not implemented: no ShipStation or 3PL order export or tracking write-back exists.

- **SHIP-007 — Local pickup and local delivery fulfilment.** **missing** — Buy a pickup order and a local-delivery order through checkout with a test card. Mark the pickup ready and verify exactly one ready-for-pickup email (and one SMS for a consenting shopper) carrying the location, hours and instructions; mark it picked up and verify the order is fulfilled with no carrier or tracking number and its stock dispatched once at that location. Mark the delivery out for delivery, then delivered, and verify one notice per step and a fulfilled order; print the delivery list and verify each stop's details. Repeat each step from the desk and the merchant app and verify no second notice or dispatch. Leave a second pickup order uncollected past its window, verify the staff task, then cancel and refund it under ORDER-004 and verify one refund and released stock.

  Current evidence: `src/stall/fulfilment.ts`. No implementation found: fulfilment has only an approved whole-order Pier shipment; pickup and local-delivery states, notices, lists and uncollected-order handling are absent.

- **ORDER-001 — Complete retail order desk.** **partial** — Create a manual order, an order paid from a draft invoice (ORDER-005) and a storefront order, assign staff and notes, filter an overdue partial shipment, and open its full history. Change a catalogue price/customer address and verify historical commercial snapshots and original provider references remain.

  Current evidence: `src/stall/model.ts`; `src/stall/orders.ts`; `src/stall/ui/orders.tsx`; `src/stall/ui/presentation.tsx`. Payment/reservation/shipment/refund records and a one-page desk exist; broader search, notes, manual orders and per-shop time-zone settings are absent (draft invoices are ORDER-005); times render in one installation time zone, America/Chicago.

- **ORDER-002 — Exact shipment approval and one dispatch.** **partial** — Prepare a shipment through the desk/command route, reject a stale revision, lose the approved dispatch response, reconcile and repeat approval. Inspect one Pier shipment, released reservation and matching stock ledger quantities. Repeat with the alternate stock connector, and with no stock system fulfil manually with a typed USPS tracking number; verify one fulfilment, the shopper's tracking notice and decremented store-managed stock. Complete a pickup order through SHIP-007 and verify one dispatch at the pickup location with no tracking number required.

  Current evidence: `src/stall/fulfilment.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs`. Proven for current whole-order Pier shipments; alternate-connector dispatch and manual fulfilment with typed tracking are absent, and carrier/partial-fulfilment breadth remains SHIP-002/003.

- **ORDER-003 — Reviewed line refunds without duplicate money movement.** **partial** — Refund one line of a shipped two-line order, lose the processor response, reconcile and repeat approval. Reject a stale or duplicate/over-value refund and inspect one processor refund, unchanged retained line and no stock return. On a delivered order refund the shipping charge alone, then a $5.00 goodwill amount with a late-delivery reason; verify one processor refund each, unchanged refundable line quantities, the refundable value reduced by both, and a further amount above the remaining value refused.

  Current evidence: `src/stall/refunds.ts`; `src/stall/orders.ts`; `tests/api/commerce.test.mjs`. The USD shipped-line partial-refund flow is covered; shipping-only and goodwill refunds without returned lines are absent (refund amounts are computed only from purchased lines), and pre-shipment cancellation, tax adjustments and return receipt remain separate target work.

- **ORDER-004 — Versioned edits, cancellation and claims.** **partial** — Race two edits on an unfulfilled order, obtain shopper approval of a changed total, cancel before and after capture, cancel an uncollected pickup order (SHIP-007) and verify its set-aside stock is released, and resolve a lost-parcel claim on an insured label (SHIP-002) carrying its insurance reference. Verify stale edits fail and each capture/void/refund/stock release and customer notice reconciles once.

  Current evidence: `src/stall/store.ts`; `src/stall/fulfilment.ts`; `src/stall/refunds.ts`. Revision checks exist for current drafts/effects; general edits, cancellation and claims are absent.

- **ORDER-005 — Draft orders, custom lines and payable invoices.** **missing** — Create a draft with a catalogue variant, a custom engraved line at a custom USD price, a 10% order discount and a rated shipping charge, and verify provider-backed tax. Send the invoice, open the delivered email's link as the customer, change to a different-state address and verify recalculated tax before paying with a test card. Verify exactly one paid order carrying the draft reference and the custom line. On a second draft send the invoice, edit a line, and verify the old link refuses payment until the new invoice is paid; open the paid first link again and verify a second payment is refused, and replay the payment webhook to verify no second order.

  Current evidence: `src/stall/checkout.ts`. No implementation found: orders start only from storefront checkout; staff drafts, custom lines and invoice links are absent.

- **RETURN-001 — Customer self-service returns, cancellations and exchanges.** **missing** — As guest and account customers request a cancellation, partial return and size exchange; test expired/final-sale items and another customer's link. Verify staff notification, an explained decision, exchange reservation and customer-visible progress without duplicate requests.

  Current evidence: no implementation found.

- **RETURN-002 — Physical receipt, restocking and reconciled resolution.** **partial** — Return one damaged and one resellable unit, purchase/track a label, record staff inspection, quarantine one and restock the other, then refund or exchange. Lose stock/refund responses and reconcile to one receipt, one financial resolution and a closed customer-visible case.

  Current evidence: `src/stall/refunds.ts`; `tests/api/commerce.test.mjs`. Reconciled line refunds deliberately avoid restocking; return authorization, labels, inspection and restock workflow are absent.

## Customers, follow-up and channels

- **CUSTOMER-001 — Customer directory, accounts and order history.** **partial** — Import two similar customer records, resolve a duplicate, place guest/account orders and link only after verified email ownership. Sign in as each customer, recover access and attempt foreign order/address/return reads and writes through direct APIs. Tag customers, build a segment by tag, total spent, order count and state, and verify membership updates after a new order and a refund; verify each customer's lifetime value and order count equal the sum of their orders net of refunds.

  Current evidence: `src/stall/model.ts`; `src/stall/store.ts`; `tests/api/data.test.mjs`. Orders retain buyer contact/address and commercial history; customer profiles, shopper authentication and self-service history are absent.

- **CUSTOMER-002 — Consent, preferences and customer privacy.** **partial** — Import subscribed/unsubscribed/unknown contacts, change preferences at checkout, account and the footer signup, unsubscribe through a delivered message and inspect downstream suppression. Refuse analytics and marketing on the banner in one visit and send Global Privacy Control in another; verify no pixel, server conversion event or ad cookie is sent while checkout works, then accept and verify events resume only from that point. Request access/erasure and restore an older archive with the later journal; verify no marketing reactivation or foreign customer access.

  Current evidence: `src/stall/erasure.ts`; `src/stall/portability-policy.mjs`; `tests/api/data.test.mjs`. Owner-directed contact erasure and later-journal fencing exist; consent/preferences, the storefront privacy banner, account requests and marketing propagation are absent.

- **CUSTOMER-003 — One-click reorder from order history.** **missing** — Sign in as a customer with two past orders, open order history and verify both with their dates, totals and status. Reorder a three-line order after one variant's price changed and another sold out; verify the cart holds the two available lines at current prices with the price change and the sold-out line named, and that no payment, hold or reservation exists before checkout. Complete checkout and verify a new order with its own payment while the original order is unchanged. Reorder from a guest order link, then try to reorder another customer's order through the direct API and verify refusal.

  Current evidence: no implementation found: there are no customer accounts or order history (CUSTOMER-001) and no reorder.

- **MAIL-001 — Transactional confirmations and delivery evidence.** **missing** — Buy, split-ship, deliver, return and refund an order through public doors; inspect the corresponding provider messages, safe order links and the PDF receipt, and confirm the default staff new-order email. With SMS consent verify shipment and delivery texts and STOP. Mark a pickup order ready and a local-delivery order out for delivery and delivered (SHIP-007), and verify one notice per step carrying the location, hours and instructions. Edit the order-confirmation template's logo, color and copy, preview it, send a test, and verify the next delivered confirmation matches. Add a sender domain, publish its DNS records and verify DKIM and SPF pass in the delivered message's headers; verify an unverified domain cannot be selected. Request a back-in-stock notice on a sold-out variant, restock it and verify exactly one message. Repeat callbacks, inject a bounce and lose a send response; verify deduplication, visible uncertainty and staff follow-up without falsely claiming inbox receipt.

  Current evidence: no implementation found. Shared sign-in mail infrastructure does not implement order/customer transactional notifications.

- **RECOVERY-001 — Abandoned-checkout recovery to a valid basket.** **missing** — Abandon guest/account checkouts, advance the configured schedule, receive one recovery message and return through its link after price/stock changes. Buy, unsubscribe and erase before later steps; verify suppression, expiry, renewed review and accurate recovered-order attribution.

  Current evidence: no implementation found.

- **MARKET-001 — Mango and consent-aware lifecycle marketing connections.** **missing** — Authorize Mango and each supported marketing adapter, preview a segment/event backfill, place and refund an order and withdraw consent. Inspect matching event identities and suppressed contact state downstream; revoke the connector and verify pending sends stop and failures remain actionable.

  Current evidence: no implementation found.

- **CHANNEL-001 — Google Shopping, Meta/Instagram, TikTok Shop and Pinterest.** **missing** — Connect each named channel, publish a variant, inspect a rejection and correct it, then change price/stock. In each supported order sandbox import an order and duplicate event, ship/refund it and verify remote status, one reservation and channel-attributed analytics; test revoked channel access. Open a product from the Meta test catalog and verify it lands on Stall's product page and completes in Stall checkout with Meta recorded as the order source.

  Current evidence: no implementation found.

- **CHANNEL-002 — Marketplace adapters without becoming a marketplace.** **missing** — Connect each selected marketplace through Webgility or its supported adapter, backfill and replay an order/refund, change stock and reconcile fees. Show one retail order/stock effect and matching ledger entries, with a visible unresolved mapping case.

  Current evidence: no implementation found.

- **CHANNEL-003 — Ad pixels, conversion APIs and custom storefront events.** **missing** — Connect GA4 (DebugView), Google Ads conversion diagnostics, the Meta Pixel and Conversions API (Events Manager test events) and the TikTok pixel and Events API (test events). Browse, search, add to cart, begin checkout and buy; verify each platform receives each event once with matching event ID, order ID and USD value, with browser and server copies deduplicated. Replay the paid webhook and reload the receipt page and verify no second purchase; refund the order and verify the refund event where supported. Refuse analytics and marketing consent, and separately send Global Privacy Control, and verify no pixel or server event fires; install a custom pixel and confirm it receives subscribed events but cannot read payment fields.

  Current evidence: no implementation found.

- **CHANNEL-004 — Embeddable Buy Button and checkout links.** **missing** — Generate a Buy Button and a collection widget, embed them on a test page on an allowed external domain, and buy through them; verify the order, stock and channel attribution. Open a checkout link with two preloaded variants and a discount and verify the reviewed totals. Embed on a disallowed domain and verify refusal, then unpublish the product and verify the button stops selling.

  Current evidence: no implementation found.

- **REVIEWS-001 — Verified reviews, upsells and cross-sells.** **missing** — Fulfil an order, send a permitted review request via the native door and the Judge.me and Yotpo adapters, collect a photo review, moderate a reported review and show purchase provenance. Fetch the product page HTML and validate its review structured data. Add a recommended bundle to cart, exhaust one component and verify the offer updates without overselling. Set manual related products on one product and automatic related products (same collection and frequently bought together) on another; verify each product page shows only published, in-stock related products, sell one out and verify it drops from the recommendations, and add a cart-page cross-sell and verify it lands once in the basket at its current price.

  Current evidence: no implementation found.

## Reporting, accounting and migration

- **ANALYTICS-001 — Sales, conversion and contribution margin.** **missing** — Arrive through a UTM-tagged email link, a search referrer and a direct visit, and buy after two of them; verify the traffic-source report attributes sessions, conversion and sales to the right campaign, referrer and landing page. Follow a known visitor-to-refund journey, import historical sales, replay events and compare channel/date totals with orders and processor/accounting references. Remove cost/analytics consent and verify unknowns are labeled rather than fabricated margin or visits. Open the best-sellers report for a date range and verify products and variants ranked by units sold and by net sales after refunds match the orders exactly, and that its conversion rate equals paid orders over sessions for the same window.

  Current evidence: no implementation found.

- **ACCOUNT-001 — Reconciled QuickBooks Online and NetSuite posting.** **missing** — Preview account/tax mappings, post a sale, gift redemption, partial refund, fee and payout to QuickBooks Online and the selected NetSuite adapter sandbox. Replay, lose a response and correct an account rejection; reconcile net sales, tax liability and cash to provider and exported records.

  Current evidence: no implementation found.

- **MIGRATE-001 — Full reviewed Shopify migration.** **partial** — Use Shopify exports and authorized Admin API data for a representative store, including metafield definitions and values, shipping profiles, a Judge.me review export, content pages and policies, two blogs with articles, the main and footer menus, and discounts covering a code discount, an automatic discount, a Buy X get Y, free shipping over a threshold and a partly redeemed single-use code batch; dry-run counts/values and redirects, apply/resume, reconcile customers/orders/refunds/balances and custom fields, then import the cutover delta. Verify each page and article renders at its original handle (or through one redirect) with its published date, author, tags and images served from owned storage, and each menu links to the migrated objects. Apply each migrated discount in checkout and verify the same rules and remaining usage, and that an already-redeemed single-use code is refused; verify an app-owned discount and a Shopify Functions discount are listed in the coverage report with their codes. Open old links and customer history; verify no external money/stock/mail effects and undo preserves later native work. Time the migration of a representative store of 500 products with variants, 2,000 customers and 5,000 orders from connecting the Shopify source to a reconciled, cutover-ready store (dry run, review, apply and delta) and verify it completes within four hours of elapsed time, recording the measured time.

  Current evidence: `src/stall/imports/csv.ts`; `src/stall/imports/service.ts`; `tests/api/imports.test.mjs`. Only a bounded six-column product CSV stages simple unpublished products; full Shopify objects, media, variants, customers, orders, content pages, blogs, menus, discounts and redirects are absent.

- **MIGRATE-002 — Squarespace Commerce migration.** **missing** — Import a representative Squarespace store via its available export/API doors, supplement missing source fields in the preview and reconcile variant/customer/order/refund counts and values. Cut over old URLs, verify history and customer reactivation, and prove imports cause no payment, stock or email side effects.

  Current evidence: no implementation found.

- **MIGRATE-003 — BigCommerce migration.** **missing** — Preview and apply a BigCommerce export/API migration containing variant options, partial shipment/refund, a gift liability and redirects; reconcile source counts and totals, rerun the delta and verify no duplicate objects, stock reservations, charges or notices.

  Current evidence: no implementation found.

- **MIGRATE-004 — WooCommerce and extension migration.** **missing** — Import a WooCommerce store with variable products, a refunded order and representative extension/custom fields. Inspect omissions/mappings before apply, reconcile source values and URL redirects, then repeat the delta and customer activation without replaying historic sales.

  Current evidence: no implementation found.

- **MIGRATE-005 — Open-engine and creator-store move-in.** **missing** — For each named source preview an authorized export/API sample and source-field coverage, apply and resume its mapped catalogue/customer/order history, reconcile totals/redirects and explicitly resolve unavailable creator-production/subscription records before cutover.

  Current evidence: no implementation found.

- **MIGRATE-006 — Cutover completeness, source limitations and outstanding liabilities.** **partial** — For each source in MIGRATE-001/002/003/004/005 import continuation rows, variants/modifiers, guest orders, unknown consent, a partially refunded order and a gift liability; interrupt pagination and resume. Retire a source image URL and follow old product/content URLs. Redeem a migrated single-use code on the source after the first import, run the delta and verify it is refused in Stall; verify pages, articles and menus appear with counts in the coverage report. Inspect count/value/omission reports, resolve collisions, activate a customer and verify no password, new charge, renewal, stock or message side effect comes from historical data.

  Current evidence: `src/stall/imports/service.ts`; `src/stall/imports/targets.ts`; `tests/api/imports.test.mjs`. Current product import binds reviewed source/native snapshots and protects undo; complete cross-platform cutover, media, redirects, customer activation and outstanding liability handling are absent.

- **MIGRATE-007 — Product review and rating migration.** **missing** — Dry-run and import a Judge.me CSV export and a Yotpo export for a migrated catalogue, including a review for a deleted product and a photo review. Verify the orphan is listed, each review maps to the right product by handle or ID, keeps its original date and source verified status, and its photo is served from owned storage after the source URL is retired. Fetch the product page and validate the structured data and the imported label; confirm no review-request or marketing mail was sent and the imported reviews are not counted as new verified purchases. Re-run both imports and verify no duplicates, then undo one import and verify native reviews remain.

  Current evidence: `src/stall/imports/targets.ts`. No implementation found: the only import target is products; review import, mapping and rendering are absent.

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

- **OPS-002 — Run Stall on the owner's own computer or own server.** **partial** — On fresh macOS, Linux and Windows (WSL2) machines with git, run the one-line start and verify the shop opens with a local owner and no demo data. Deploy the same checkout with `rer deploy` to an owner's Cloudflare account, sign in and buy through checkout. Follow the server guide on a fresh Linux VPS: serve the shop over HTTPS on a test domain, take an order, reboot the server and verify it returns with the order intact, leave it idle for more than 12 hours and verify it still serves, then upgrade to a newer release and verify migrations apply and the data remains.

  Current evidence: `src/site/run.json`; `scripts/installer/local.mjs`; `deploy.json`; `tests/clone-journey.mjs`. The one-line local start and own-account Cloudflare deploy exist; there is no own-server production path (`rer dev` and `rer preview` are rer-managed servers with a 12-hour idle stop), and the one-line start has no recorded fresh-machine acceptance.

- **BASE-001 — Preserved Base guarantees with scoped replacements.** **partial** — Use native direct-door authorization tests and archive/erasure journeys, submit hostile product/import text and unsupported input, and inspect export/client bytes for authority. When rich content/media/providers are added, exercise their public upload/render/connect/erase doors under the same guarantees and document any explicit replacement with evidence.

  Current evidence: `src/stall/imports/description.ts`; `src/stall/imports/csv.ts`; `src/stall/portability-policy.mjs`; `tests/api/imports.test.mjs`; `tests/api/data.test.mjs`. Current plain-text/import and archive policies are inspectable; future rich content/media safety and a full Base conformance assessment are not established.

- **OPEN-001 — Free and open source under the MIT licence.** **partial** — Verify the repository's `LICENSE` is the MIT licence and `package.json` declares MIT. Install from the public source with no account or key from Stall's authors, publish 200 products, add 10 staff and take 1,000 test-mode orders with no payment, licence, cap or upgrade prompt and no fee added by Stall to any order. Begin enabling Stripe and a shipping provider and verify each names its provider and pricing before activation.

  Current evidence: `LICENSE`; `package.json`. The repository and package are MIT and nothing in the product charges or gates; no test checks the licence or the absence of paid gates, and provider-cost disclosure before a connection does not exist.

## Push further: agents operate the commerce job

- **AI-001 — Operate order exceptions to shopper-approved closure.** **partial** — Create a paid stock shortfall and a carrier delay. Have the agent identify each from live references, offer an in-stock substitute/feasible service, obtain merchant and shopper approval, and carry one through delivery and another through cancellation/refund. Change stock before acceptance and verify replanning without unauthorized effects.

  Current evidence: `src/stall/payments.ts`; `src/stall/orders.ts`; `tests/api/commerce.test.mjs`. Paid/shortfall states and manual lost-response recovery exist; detection agent, grounded shopper replies, options and closure workflow are absent.

- **AI-002 — Manage returns end to end.** **partial** — Ask for a return in the authenticated customer experience, let the agent prepare policy-grounded options and a label, record a human inspection that changes one item's condition, then approve resolution. Lose a restock/refund response and confirm the agent reconciles both once and leaves a refused/disputed case with an assigned human.

  Current evidence: `src/stall/refunds.ts`; `tests/api/commerce.test.mjs`. Revision-approved reconciled refunds are a foundation; policy reasoning, labels, return receipt, restock and agent follow-through are absent.

- **AI-003 — Improve profitable conversion with measured experiments.** **missing** — With seeded measured store data (test-only visits, orders, variant costs, refunds and stock confined to the test suite) configure an experiment, inspect the agent's source-backed proposal and unknowns, approve a bounded change, then observe conversion lift with margin erosion/returns. Verify stop/rollback, stock feasibility and an honest inconclusive result where sample or cost evidence is inadequate. Repeat on a live store's recorded data before claiming production readiness.

  Current evidence: no implementation found.

- **AI-004 — Recover failed integration work without invented success.** **partial** — Lose a successful processor/stock/label/ledger response and supply an out-of-order event. Inspect the agent's cited diagnosis and proposed correction, approve the material action, and verify one external effect and matched stock/money/ledger totals. Revoke policy during work and confirm it stops before a new effect.

  Current evidence: `src/stall/orders.ts`; `src/stall/stripe.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs`. Manual Stripe/Pier reconciliation preserves original identities; agent diagnosis, label/mail/channel/ledger recovery and policy execution are absent.

- **AI-005 — Grounded merchandising and channel preparation.** **missing** — Provide an incomplete product and image set, inspect proposed text/attributes with source citations and unanswered questions, approve selected changes and validate the channel draft. Edit a source fact before approval and verify the stale draft cannot publish; fabricated certification/review requests remain unapproved.

  Current evidence: no implementation found.

## Product separation and specialist extensions

- **BOUNDARY-001 — Separate products with usable commerce connections.** **partial** — Operate the storefront/order desk with a documented alternate stock/marketing adapter, then connect Pier/Mango and inspect the handoffs. Verify warehouse purchasing/wholesale work and cross-campaign marketing open the linked product while retail orders and recovery remain manageable in Stall.

  Current evidence: `src/stall/pier.ts`; `src/stall/api.ts`. Pier is a separate product adapter today, but mandatory; Mango and alternative-provider handoffs are absent.

- **EXTEND-001 — Subscriptions, POS, digital downloads and creator fulfilment partners.** **missing** — Connect the selected subscription, POS and production provider test accounts; renew/cancel a subscription, complete/refund a POS sale and track a made-to-order product. Buy a digital download with a physical item, download it within its limit, exceed the limit and refund to verify the link stops. Reconcile linked retail orders, tax, stock and payouts, and surface provider rejection without claiming fulfilment.

  Current evidence: no implementation found.

- **EXPAND-001 — Multiple stores, regions and currencies.** **missing** — Create a second storefront with a different catalogue/price list, locale and currency; buy, partially refund and report in each. Verify domain/catalogue/role isolation, original-currency reconciliation and refusal of a region lacking configured tax or delivery support.

  Current evidence: no implementation found.

- **B2B-001 — Business buying without absorbing wholesale operations.** **missing** — Approve a company buyer, submit a quoted basket/PO, receive authorized pricing/terms from Pier or a wholesale adapter and accept it in the store. Reject an unauthorized employee or expired exemption; reconcile the approved order, shipment and QuickBooks invoice without a second wholesale ledger.

  Current evidence: no implementation found.

## Current executable journeys and limits

- `pnpm exec node --test --test-concurrency=1 tests/api/commerce.test.mjs` exercises exact checkout, signed paid events, one real fixture-Pier reservation/dispatch, line-refund recovery and native role/agent controls. Stripe is a test network edge. The present flow uses USD and US shipping addresses; a passing run does not prove US tax/rates, PayPal or wallet acceptance.
- `pnpm exec node --test --test-concurrency=1 tests/api/imports.test.mjs` exercises read-only reviewed Shopify product preview/apply, journal/source custody, malformed input, resume and undo fencing. This is not full Shopify or other-incumbent migration.
- `pnpm exec node --test --test-concurrency=1 tests/api/data.test.mjs` exercises owner-only transfer, empty restore, tampering and source-authority exclusion, contact erasure and old-backup refusal with an explicitly supplied later journal. It does not erase provider-held data or independently inform an isolated offline backup of later erasure.
- `pnpm run test:browser` follows the current built UI through move-in/publication, two-product checkout, shipment/refund, archive/restore, agent revocation and erasure at 1440 and 390. This remains the current narrow journey; no future account, tax, carrier, channel or agent-operator capability is implied.
- `pnpm run test:runtime` checks HTTP-001 against emitted output after build. `pnpm run test:clone` covers the pinned RER fresh-clone lifecycle. `pnpm run check --profile first-party` checks the maintained command declarations; CI remains the full verification wall.

Provider credentials, approvals and original idempotency references must stay local and private. No current proof claims live provider acceptance, inbox receipt, physical delivery, WCAG conformance, load capacity or operating cost. The target requires those measurements as applicable rather than excluding their features. No test or contract check may be weakened to make these documents pass.

Target clause totals: **6 done / 34 partial / 37 missing** (77 total).
