<!-- Generated from CONTRACT.md by contract-docs. Edit CONTRACT.md, then regenerate. -->

# Accept a Stall installation

The primary journey: Move an existing store in, publish its catalog, convert a shopper’s reviewed cart into a paid order, fulfill it, resolve a return and reconcile the books.

## Progress

| Tier | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Core | 7 | 51 | 27 | 85 |
| Agent surface | 0 | 0 | 4 | 4 |
| Later | 0 | 0 | 0 | 0 |
| Full target | 7 | 51 | 31 | 89 |

Judged from the code and tests at commit `66ce5e9be39baa833aa221018ba6a044e758dfb6` (28 October 2026). Field proof register: 10 rows; 0 passed, 0 failed, 10 not run.

## Core

### Installed documents

#### HTTP-001 — Real installed and published HTTP surfaces

Core · published · **partial** · Cites BASE-OPS-001, BASE-DOCS-001

**Requirement.** The installed shop and its independent marketing site serve their real documents and assets, with genuine document and API not-found responses. Marketing Run actions lead to the installation journey. The operations command contract remains binding; building and deployment do not run tests. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Build and serve the emitted shop; request its health, Lobby, storefront and built assets, then unknown document and API paths.
2. Verify successful responses and real 404 status codes; build the run site and follow its public links.

**Evidence.** `src/server.ts`; `src/base/static-assets.ts`; `tests/runtime.mjs`; `tests/ui/journey.mjs`
**Gap.** Audit gap: Storefront document successful HTTP status, beyond visible browser controls. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

### Runtime and store experience

#### DEMO-001 — Hosted demo shop that sends nothing

Core · target · **partial** · Cites BASE-DATA-004, BASE-MAIL-001

**Requirement.** The homepage opens a hosted, current-release sample US shop with catalog, stock, weeks of order history, product drafts, an agent credential, audit history and prepared refund and shipment work. Its production entry keeps its human check; sample-shop automation uses a separate admitted test-key host at the same revision. Purchases, approvals and invitations use simulated payment, stock and mail confined to demo mode, with no real provider request or delivered mail. Ordinary installations begin empty and production build and deployment refuse demo mode. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Follow the built homepage's Try the demo link to the production entry, verify a 200 response and see the real human (Turnstile) check.
2. Then, on the separately admitted hosted test host with test keys at the same SHA, verify the sample shop, buy from the public shop, approve the prepared refund and a packed order's shipment, and invite a teammate; verify the order is paid and reserved, the refund and dispatch succeed against the simulated providers, and no outbound provider request or mail leaves.
3. Attempt a production build and deploy with demo mode enabled and verify refusal; start a fresh installation and verify it holds no demo record.

**Evidence.** `src/demo.ts`; `src/stall/demo/providers.ts`; `tests/api/demo.test.mjs`; `tests/ui/demo-journey.mjs`; `.github/workflows/demo-acceptance.yml`
**Gap.** Audit gap: Real human-check presence beyond a successful entry response; Invitation persists or yields usable teammate membership beyond accepted status. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

#### STORE-001 — Merchant themes, page builder and custom domain

Core · target · **partial** · Cites BASE-PUBLIC-001, BASE-INPUT-003 · Register R-5

**Requirement.** A merchant chooses a starter theme from a theme library, duplicates it and edits logo, colors, typography, navigation, reusable sections and responsive page templates. An unpublished theme or revision is previewable through a staff preview link; the merchant publishes, switches or rolls back themes without losing pages, menus, collections, products or orders, because content and catalog are stored independently of any theme. The complete theme source and assets export as a documented archive and re-import into the same or another store, with validation that names unsupported or missing sections instead of silently dropping them. A storefront password hides the shop before launch or during migration staging while staff preview keeps working. The merchant connects an owned domain with verified DNS, TLS and canonical redirects. Published themes serve resized, cached images, and the reference theme is measured against Google's "good" Core Web Vitals thresholds at phone width rather than assumed fast.

**Acceptance.**
1. In the merchant desk pick a starter theme from the library, create a reusable hero/product section, preview it on desktop and phone, and publish to a verified test domain.
2. Switch to a second library theme and back, confirm every page, menu, collection, product link and order survives, and roll back a revision.
3. Export the theme source and assets, re-import them into an empty store and compare the rendered pages; import a damaged archive and verify a named refusal.
4. Enable the storefront password and confirm public pages, sitemap and feeds are withheld while staff preview works.
5. Follow HTTPS and www/canonical redirects, and record a Core Web Vitals run of the reference theme at 390 pixels.

**Evidence.** `src/stall/ui/shop.tsx`; `src/stall/ui/primitives.tsx`
**Gap.** A fixed branded storefront exists; the theme library, switching, duplication, export/re-import, visual building, storefront password, domain management, revision controls and a measured performance run are absent.

#### STORE-002 — Navigation, collections and product discovery

Core · target · **done** · Cites BASE-PUBLIC-001, BASE-ROLE-001

**Requirement.** Shoppers browse menus, manual or rule-based collections and category landing pages, search product names/SKUs/attributes, and filter/sort by price, availability, variant attributes and collection. Results, counts, empty states and shareable URLs agree with published, sellable catalog data; unpublished products stay private. Search offers predictive suggestions as the shopper types, and merchants tune it with synonyms (for example "tee" and "t-shirt"), boosted or pinned products for a query, and a search report of top queries and queries with no results. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md). Agent merchandising changes carry standard or, when visible on the running shop, live, decided by company policy.

**Acceptance.**
1. Publish a varied catalog, navigate collections, search and combine filters on desktop and phone.
2. Change publication and stock, refresh the public results, and verify matching counts, saved URLs and a useful no-results state.
3. Add a synonym and a pinned product for a query and verify both change results; search a term with no results and find it in the search report.

**Evidence.** `tests/api/commerce.test.mjs` — “STORE-002: collections, menus, search, filters, synonyms and pins agree with the published sellable catalog”; `tests/ui/discovery-journey.mjs` — “discovery”
**Gap.** None.

#### STORE-003 — Content, blog, contact, newsletter and search visibility

Core · target · **missing** · Cites BASE-INPUT-002, BASE-MAIL-001, BASE-PUBLIC-001 · Register R-7

**Requirement.** Merchants manage content pages, blog posts, policies, menus, product/collection SEO titles and descriptions, image alt text, canonical URLs, sitemap, robots policy, social previews, structured product data and permanent redirects. Draft/scheduled content is previewable and changes retain publication history. Moving a product URL preserves discovery through redirects. Every theme includes a contact page whose form delivers each submission, with optional order number, to the store's notification email (reply-to set to the shopper) and to a desk inbox, or to a connected help desk such as sibling [HappyToHelp](https://github.com/just-every/run-happytohelp); Cloudflare Turnstile, a honeypot and per-sender rate limits hold spam for review instead of silently dropping it. A newsletter signup block (footer, page section or popup) records an explicit marketing opt-in under CUSTOMER-002 with source, form, page and timestamp, optionally confirmed by double opt-in, and propagates the subscriber to Mango, Klaviyo or Mailchimp through MARKET-001 without duplicating an existing contact.

**Acceptance.**
1. Create and schedule a blog post and policy page through the desk, publish a product with SEO metadata, fetch its rendered HTML/sitemap, and rename its slug.
2. Verify old URLs redirect once and unpublished content is absent from public search and feeds.
3. Submit the contact form and confirm it reaches the merchant email with the shopper as reply-to and appears in the desk inbox; submit scripted spam and verify it is held, not delivered or lost.
4. Sign up through the footer, confirm the subscriber has source, page and timestamp, and verify the same consented subscriber appears once in Mango and in a Klaviyo or Mailchimp test account; repeat the signup and verify no duplicate.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented, including the contact form and newsletter signup.

#### MOBILE-001 — Accessible mobile shopping and merchant work

Core · target · **partial** · Cites BASE-ACCESSIBILITY-001, BASE-PUBLIC-003 · Register R-1, R-2

**Requirement.** Catalog-to-receipt, account, return and merchant order journeys meet the shared accessibility bar on both phone and desktop. State and freshness distinguish unavailable data from zero stock or success; action failures retain shopper input and prevent a duplicate submission. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Use the built storefront and desk at both widths to buy variants, recover a validation failure, read order status, request a return and process it.
2. Complete the same essential controls by keyboard and inspect accessible names and focus after dialogs/errors.

**Evidence.** `src/stall/ui/shop.tsx`; `src/stall/ui/app.tsx`; `tests/ui/journey.mjs`
**Gap.** The existing narrow shop/desk journey covers both widths; expanded flows and full accessibility conformance are unimplemented or unverified.

#### MOBILE-002 — Native merchant apps and timely order attention

Core · target · **missing** · Cites BASE-ACCESS-002, BASE-ROLE-001 · Register R-3

**Requirement.** iOS and Android merchant apps provide secure sign-in, order/customer lookup, product/photo edits, stock visibility, barcode-assisted picking, fulfillment including the pickup and local-delivery steps (SHIP-007), returns and approval notifications under the same role checks as the web desk. Offline drafts show stale data and reconcile conflicts before effects; device revocation removes authority and lock-screen notices avoid customer details.

**Acceptance.**
1. On each platform receive a new-order notification, scan a purchased SKU, prepare fulfillment offline, change the order elsewhere, and reconnect.
2. Verify the conflict requires fresh approval.
3. Edit a product's title and price and add a photo taken with the device camera, and verify the change goes through the same revision approval and appears on the storefront with the photo served from owned storage.
4. Mark a pickup order ready and picked up from the app (SHIP-007) and verify one notice and one dispatch.
5. Revoke the device and confirm private reads and actions fail.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

### Catalog and stock

#### CATALOG-001 — Products, variants and media

Core · target · **done** · Cites BASE-INPUT-001, BASE-INPUT-003, BASE-DATA-003, BASE-MAIL-001

**Requirement.** The desk maintains products, handles, SKUs, variant options/combinations, USD prices and compare-at prices, cost basis, taxable categories, categories/tags/attributes, collections, image galleries and video/alt text. Merchants define typed custom fields (metafields such as size charts, care instructions or ingredients) that themes render on product pages and that imports and exports carry. Products can ask the shopper for personalization (engraving or monogram text with a character limit, a choice list, or a file upload with type and size limits), optionally with a USD price add-on; it is validated before add to cart and carried to the cart, checkout review, order, packing slip, confirmation email and exports, and uploaded files are stored privately under erasure (ERASURE-001). Each variant has independent stock mode and availability (STOCK-001/003), shipping weight/dimensions, and customs description, HS tariff code and country of origin for international labels (SHIP-002). Draft, scheduled, published and archived states preserve historical purchased descriptions/prices and expose only approved current listings. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md). Agent publication carries external and live, decided by company policy.

**Acceptance.**
1. Create a product with size/color variants, multiple images, cost, weight, tax category, HS code, country of origin and a size-chart custom field; publish an approved revision and verify the custom field renders on the product page.
2. Buy one variant, change its current price and archive another; verify gallery/selection and immutable order snapshots through public product and order views.
3. Add an engraving field (20 characters, +$5) and an artwork upload to a product, refuse over-length text and a disallowed file type, buy with valid personalization and verify it with the add-on price on the cart, order, packing slip and confirmation email.

**Evidence.** `tests/api/commerce.test.mjs` — “CATALOG-001: variants, galleries, handles and listing states sell the exact variant and keep immutable order history”; `tests/api/data.test.mjs` — “CATALOG-001: exact approved metadata stays private until publication, renders typed facts and travels without losing purchased descriptions”; “CATALOG-001: personalization is validated, priced and carried to the order, packing slip, confirmation, exports and erasure”; `tests/ui/catalog-journey.mjs` — “CATALOG-001 catalog journey”
**Gap.** None.

#### CATALOG-002 — Bulk catalog operations and portable files

Core · target · **partial** · Cites BASE-INPUT-001, BASE-DATA-001, BASE-ROLE-001

**Requirement.** Merchants import, export and bulk-edit products/variants, collections, prices, publication, tax settings, stock mode, weight, dimensions, HS codes, countries of origin and custom fields. A dry run shows creations, changes, conflicts and rejected rows before an exact reviewed apply; jobs resume without duplicates and offer undo only where later native edits or orders will be preserved. Original source custody and row-level outcomes remain inspectable. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Upload a mixed valid/invalid catalog file, inspect a read-only preview, apply the reviewed rows, resume an interrupted batch, export them and undo untouched changes.
2. Edit/purchase an imported SKU first and verify undo reports the protected row rather than overwriting it.

**Evidence.** `tests/api/imports.test.mjs`; `tests/ui/bulk-products-journey.mjs`
**Gap.** Audit gap: Editable stock-mode choices through full grid and file scope. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

#### CATALOG-003 — Bulk quantity adjustments through the stock authority

Core · target · **missing** · Rules D-2

**Requirement.** Merchants bulk-edit on-hand quantities per location through a grid and inventory files. Each adjustment reaches the variant’s stock authority under STOCK-001 or STOCK-003, with Stall and provider references recorded together. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Bulk-edit on-hand quantities in the grid and by an inventory CSV, once with store-managed stock and once with Pier connected, and verify each change appears once in the stock authority's history with a matching reference.

**Evidence.** None.
**Gap.** STOCK-003's store-managed stock authority and Pier's future scoped stock-adjustment command are required; Stall's current Pier key cannot call it. No executed grid/CSV journey proves once-only quantity adjustments in either authority with matching references. Inherits STOCK-001/STOCK-003.

#### STOCK-001 — Live availability through Pier or another stock system

Core · target · **partial** · Rules D-1, D-2

**Requirement.** Stall displays variant-level sellable availability from each variant's stock authority and reserves against the selected location/fulfillment policy. A variant may be untracked or use store-managed quantities with no stock system at all (STOCK-003); Pier is an optional first-class adapter, and a documented connector lets a merchant retain another stock system. Stall owns storefront merchandising and retail order experience; Pier owns the Cin7/inFlow-style inventory, purchasing and wholesale order system. Backorder/preorder rules, lead times, safety stock and stale-provider behavior are visible before purchase. Changes that start in Stall (on-hand adjustments from the product editor, bulk editor or inventory CSV, sale reservations, cancellation releases and accepted restocks from RETURN-002) are written to the connected stock system with Stall's and the provider's references recorded together; changes that start in the stock system (receipts, counts, transfers) flow back to availability. Neither side becomes a second warehouse ledger.

**Acceptance.**
1. Connect Pier, publish variants across two locations, make an external stock change and verify public availability.
2. Adjust a variant's on-hand quantity from the product editor, the bulk editor and an inventory CSV and verify each adjustment lands once in Pier with matching references.
3. Repeat both via the documented alternate adapter; test backorder refusal/allowed lead time, stale stock and duplicate reservation events with matching stock-provider references.
4. Set a safety stock of 2 on a variant with 5 on hand and verify the storefront sells exactly 3 before showing it sold out.

**Evidence.** `src/stall/pier.ts`; `src/stall/connections.ts`; `src/stall/payments.ts`; `tests/api/commerce.test.mjs`
**Gap.** Pier bin availability and paid-order reservations exist; the owner connects Pier (address and Pier-issued key) and Stripe on Settings → Provider connections, sealed in Stall's database and read per request (`src/stall/connections.ts`), with server settings as an override; selling still requires Pier (checkout binds every order to the Pier origin/customer). Configurable location/backorder policy, Stall-originated quantity adjustments and alternate adapters are absent.

#### STOCK-002 — Expiring checkout holds and stock race resolution

Core · target · **partial** · Rules D-2

**Requirement.** Checkout rechecks availability and creates a bounded stock hold before payment commitment. Holds expire or release after abandonment, failed payment and cancellation; a verified payment converts the same hold into a reservation once. Late payment or shortfall remains an explicit exception with feasible fulfillment, shopper-approved substitution or reconciled cancellation/refund rather than silently overselling.

**Acceptance.**
1. Two shoppers attempt the last unit through checkout.
2. Expire one hold and fail another payment; verify releases.
3. Deliver late/duplicate success and lose a reservation response; confirm one reservation or a visible paid-shortfall case resolved by the shopper-approved outcome.
4. While the first shopper's hold is live, verify the second shopper is told the last unit is held, with the hold's remaining time, and cannot pay for it, and that it becomes buyable again as soon as the hold expires or that payment fails.

**Evidence.** `src/stall/checkout.ts`; `src/stall/payments.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs`
**Gap.** BLOCKED on Pier: the current Stall-scoped credential permits only order.create, order.channelPayment and dispatch.create. Pier must expose atomic bounded basket holds with expiry/release/conversion and deadline observations; its owner-only physical holds have no expiry or atomic conversion. Prepayment holds, expiry/failure/cancellation releases, competing-shopper remaining-time/payment refusal and shopper-approved shortfall closure remain unproved. A local second stock ledger would violate STOCK-001 authority.

#### STOCK-003 — Store-managed quantities and untracked items without a stock system

Core · target · **missing** · Rules D-1, D-2

**Requirement.** Each variant has a stock mode: untracked (made-to-order or unlimited, optionally with a production lead time shown before purchase), store-managed quantities kept by Stall per store location, or a connected stock system (STOCK-001). With no stock system connected, a merchant can sell, hold, reserve and fulfill untracked and store-managed variants; adjust on-hand counts with a reason (received, correction, damaged, cycle count) from the product editor, the bulk editor or an inventory CSV; see on-hand, committed and available quantities per location with adjustment history; and choose per variant whether to continue selling when out of stock. Store-managed counts are the retail quantities a Shopify-class store keeps, not purchasing, transfers or wholesale, which remain Pier's job. Connecting Pier or another stock system later moves opening balances through a reviewed handoff, after which that system is authoritative and Stall's counts become read-through.

**Acceptance.**
1. With no stock system connected, sell and manually fulfill (ORDER-002) a made-to-order untracked variant and a store-managed variant; verify committed and on-hand counts and that the last unit cannot be oversold unless continue-selling is on.
2. Adjust on-hand counts from the editor, bulk editor and CSV with reasons and inspect the adjustment history.
3. Connect Pier, review and apply the opening-balance handoff, and verify later adjustments are written through Pier with matching references while Stall keeps no independent count.

**Evidence.** `src/stall/checkout.ts`; `src/stall/fulfilment.ts`
**Gap.** No implementation found: checkout and dispatch require Pier; untracked variants, store-managed counts and the opening-balance handoff are absent. Full connected-write acceptance is blocked on Pier scoped adjustment/handoff authority: native owner imports/counts exist, but the supported Stall-issued key cannot call them. Local stock modes, manual fulfillment and owner-file handoff remain same-seed implementation work.

### Cart, payment and commercial totals

#### CART-001 — Persistent cart and guest or account checkout

Core · target · **partial** · Cites BASE-INPUT-001, BASE-ACCESS-002 · Rules D-3

**Requirement.** Shoppers add/remove variants, change quantities, retain a cart across refresh/sign-in, and check out as guests or account holders. Native shopping/checkout steps collect US addresses, and international addresses in the destination's format for zones the merchant serves (SHIP-001), plus contact, selected delivery method, an optional order note and a gift message with an optional gift receipt that hides prices. They show reviewed USD item, discount, gift-card, shipping, tax and final payable totals before committing payment. Material changes require review again; stock, price and address errors preserve the basket. Saved carts never grant access to another customer. Order notes and gift messages appear on the order, packing slip and confirmation. Merchants can add their own checkout fields (for example "How did you hear about us?", a preferred delivery date or a gift-wrap choice) as required or optional text, choice or date inputs; answers are stored on the order and appear in the order desk, exports and reports (ANALYTICS-001). Under RL-102 carts use private guest capability custody or independently verified account custody; same-mailbox handoff is explicit, retires the old guest capability, and a restored cart requires a fresh copied-cart review of current price, stock, address, questions and totals before a new payment intent. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Build a multi-variant cart, reload and sign in, choose a US address and delivery method, add an order note and gift message, apply a discount/gift card and review exact totals.
2. Change price or availability concurrently and verify a fresh review; repeat as a guest, as a different account and with a Canadian address.
3. Verify the note and gift message on the order and packing slip and a gift receipt without prices.
4. Add a required "How did you hear about us?" choice field, verify checkout refuses to continue without it, and find the answer on the order, in the order export and in a report grouped by answer.
5. Under RL-102 hand a guest cart explicitly to the same independently verified mailbox, retire its old guest capability, restore it as history and require fresh copied-cart review of price, stock, address, questions and totals before a new payment intent.

**Evidence.** `tests/api/commerce.test.mjs`
**Gap.** Native HTTP cart custody, US review and retry are asserted. Native cart screens, Canadian delivery, gift/store-credit redemption, provider tax across the complete journey, packing/confirmation gift snapshots and price-hidden gift receipts remain unproved; carry RL-102’s exact verified handoff and fresh restore-copy review.

#### PAY-001 — US dollar cards, wallets, PayPal, pay-later and manual payments

Core · target · **partial** · Cites BASE-SECRET-001 · Rules D-1 · Register R-4

**Requirement.** The merchant connects their own Stripe and PayPal accounts. Checkout supports USD cards, Apple Pay, Google Pay and Link/Shop-style accelerated wallet checkout, PayPal and PayPal Pay Later, and buy-now-pay-later through Stripe's Klarna, Affirm and Afterpay methods, using supported provider adapters and eligibility checks. Pay-later options appear only within each provider's current order-amount and shopper-country eligibility, show the provider's installment terms, and can be advertised on product and cart pages through provider messaging; the merchant is paid by the provider and refunds return through the same method. Merchants can also offer manual methods (bank transfer, cash on delivery, pay at pickup) whose orders stay pending payment until staff record receipt; fulfilling an unpaid manual order requires an explicit merchant setting. Eligible payment choices and unsupported devices are honestly presented; customer payment credentials stay with the processor and wallet. Refunds and receipts retain original method/currency references.

**Acceptance.**
1. Complete USD purchases with a card, Apple Pay, Google Pay, Link and PayPal through their supported test/eligible-device doors; inspect provider IDs, amount/currency, failure/cancel paths and a same-method refund.
2. Complete a test-mode Klarna, Affirm, Afterpay and PayPal Pay Later purchase and refund each; verify every pay-later option is withheld, with an explanation, below and above its eligibility range.
3. Verify provider pay-later messaging appears on the product and cart pages with installments computed from the current price, updates when the cart changes, and disappears outside eligibility.
4. Place bank-transfer and pay-at-pickup orders and verify they stay unpaid and unfulfillable until staff record payment.

**Evidence.** `src/stall/stripe.ts`; `src/stall/refunds.ts`; `tests/api/commerce.test.mjs`
**Gap.** Stripe card Checkout/refunds use USD; named wallets, PayPal, pay-later, manual methods and complete US payment acceptance are unimplemented or untested.

#### PAY-002 — Authorization, capture, cancellation and disputes

Core · target · **partial** · Cites BASE-OPS-003, BASE-OPS-004 · Rules D-1

**Requirement.** Merchants choose supported immediate capture or authorize-then-capture rules, see pending/authorized/captured/failed/expired/canceled states, and reconcile asynchronous payments, voids, disputes, chargebacks and provider fees. No fulfillment occurs on an unverified browser return or mere authorization. Expired authorization and a disputed payment create accountable staff work. For a dispute the desk assembles evidence (order and receipt, policies, customer communications, carrier tracking and delivery scans) into the processor's evidence fields; staff review and submit it to Stripe or PayPal before the response deadline, and the outcome and dispute fees reconcile to the order. Permitted captures/refunds bind current order and provider state.

**Acceptance.**
1. Authorize an order without capture, attempt fulfillment, capture once, then process a failed/expired authorization, asynchronous success and dispute event.
2. Assemble and submit evidence for a test dispute on Stripe and PayPal, and verify the processor received it and the won/lost outcome and fee reconcile.
3. Duplicate/out-of-order callbacks must preserve actual processor state, correct balance and a visible owner action.

**Evidence.** `src/stall/stripe.ts`; `src/stall/payments.ts`; `src/stall/orders.ts`
**Gap.** Canonical paid-session retrieval exists; distinct authorization/capture, void, dispute evidence and fee lifecycle handling is absent.

#### PAY-003 — Verified payment and duplicate-safe paid reservation

Core · target · **partial** · Cites BASE-OPS-003

**Requirement.** A signed payment event must match its raw body, timestamp, event identity, original order/session, exact-cent amount and currency, and canonical processor state before an order is treated as paid. Repeated delivery and lost stock responses reconcile to the same paid order and Pier reservation. A paid shortfall remains recorded; a browser success page alone proves nothing. Changed reuse of an idempotency identity is refused.

**Acceptance.**
1. Through public checkout and the signed webhook send unpaid, stale, wrongly signed, changed-total and duplicate events; lose the Pier response after its commit, then reconcile.
2. Inspect one payment/order/reservation and durable paid-before-reservation history.

**Evidence.** `src/stall/checkout.ts`; `src/stall/payments.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs`; `tests/api/local-payments.test.mjs`
**Gap.** Audit gap: Paid state before reservation observed in durable sequence history. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

#### PROMO-001 — Discounts, automatic promotions and controlled budgets

Core · target · **partial**

**Requirement.** Merchants create each Shopify-class discount type as either a code or an automatic discount: percentage or fixed amount off selected products, variants or collections; percentage or fixed amount off the order subtotal; Buy X get Y (buy a quantity of, or spend an amount on, qualifying items and get specified items free or at a percentage/amount off, with a per-order use limit, including buy-one-get-one); and free shipping with a minimum subtotal or quantity, eligible zones/countries and an optional maximum rate. Each has date windows, customer eligibility/segments, minimums, per-customer/total usage, combination rules across product, order and shipping discounts, and budgets. Merchants can bulk-generate unique single-use codes for influencers or affiliates, export them and see redemption per code. Checkout explains applied/refused promotions, allocates discounts to lines for tax and refunds, records the chosen rule revision and emits qualification/redemption/reversal events. Concurrent baskets cannot exceed a shared cap; refund/cancellation treatment is explicit. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md). Reserved and used allocations consume caps; an unpaid reservation is released only after the provider confirms its checkout expired or never existed. Paid use and refunds retain consumption, and restored rules require fresh activation. Agent discount actions carry money and live, with company policy deciding execution.

**Acceptance.**
1. Configure each type once as a code and once as an automatic discount: amount and percentage off a product and a collection, amount off the order, a buy-one-get-one and a spend-$X Buy X get Y, and free shipping over $50.
2. Build qualifying and non-qualifying baskets and verify the reviewed checkout totals, line allocations and tax to the cent.
3. Exercise combination rules, race the last redemption of a capped code, generate a batch of unique single-use codes and refuse a second use of one, cancel one order and partially refund another.
4. Reconcile campaign usage, budget and exact order/tax totals from the merchant report and emitted events.

**Evidence.** `tests/api/commerce.test.mjs`; `tests/api/data.test.mjs`; `tests/ui/promotion-journey.mjs`
**Gap.** End-to-end cancellation and its stock and tax reconciliation remain unproved: the pinned Pier Stall credential authorizes order creation, payment evidence and dispatch, but not order.cancel. A supported scoped Pier cancellation door is required; no alternate warehouse credential or local stock ledger is used. Fully free baskets and refunds of zero-paid reward lines have no completed public journey. The existing positive-payment checkout and refund doors still require a positive provider amount. Production payment acceptance and downstream provider or accounting duties remain with PAY-001, TAX-001 and ACCOUNT-001. PROMO-001 stays PARTIAL; no original acceptance point is waived.

#### PROMO-002 — Gift cards and stored redemption balances

Core · target · **missing**

**Requirement.** Merchants sell or issue gift cards, deliver secure codes, inspect a balance ledger and redeem partially across orders alongside another method. Concurrent redemption, cancellation and refund preserve value exactly once; issuance, expiry restrictions and cash-out handling follow the configured US jurisdiction/policy and are explicit to the shopper. Gift cards sold to shoppers follow the federal CARD Act (no expiry earlier than five years after issue or last load, no dormancy or inactivity fee in the first twelve months) unless the store's state is stricter, and the store's state sets cash-out rules, such as California's requirement to pay balances under $10 in cash on request; free promotional cards are labeled as promotional with their own terms. Staff can also issue store credit to a customer outside any return (goodwill, loyalty or a price adjustment) with a USD amount, reason and optional expiry; it shows in the customer's account and applies at checkout like a balance, alone or alongside another method, and return-resolution credit (RETURN-002) uses the same ledger of issue, use, expiry and staff adjustment. Exported balances and migrated cards reconcile without revealing full codes to unauthorized staff. Balance identity follows CUSTOMER-001 and RL-103.

**Acceptance.**
1. Issue a USD gift card, deliver and redeem it partly, race its remaining balance in two checkouts, and cancel/refund the winning order.
2. Inspect the balance ledger, shopper receipt, staff permissions and reconciled migrated opening balance.
3. Try to give a sold card a two-year expiry and verify refusal under the five-year rule, while a promotional card may carry it.
4. With a California store, request cash-out of a $7.50 remaining balance and verify a recorded payout zeroes the ledger, and verify a $15.00 balance is refused cash-out.
5. Issue $20.00 goodwill store credit to a customer with no return, sign in as that customer, see it in the account and apply $12.00 of it at checkout alongside a card; verify the ledger shows $8.00 remaining.
6. Sell a $50.00 gift card through storefront checkout, verify the buyer receives its code by email once payment is verified, and redeem it at checkout on a later order.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

#### TAX-001 — Address-level US sales tax and exemptions

Core · target · **partial** · From TAX-001 · Register R-6

**Requirement.** Stripe Tax, Avalara AvaTax or TaxJar computes checkout tax from configured registrations, full addresses, product categories, exemption evidence and shipping/discount treatment. Orders keep original calculation and transaction custody; outages or incomplete configuration refuse an unpriced obligation. Preview consent is separate from sale authority, fresh local authority is needed after restore, and uncertain work uses original references. TAX-004 governs line reversals, TAX-002 liability reports and TAX-003 nexus indicators. Agent provider transfers carry external, regulated evidence adds sensitive and financial commitments carry money; company policy decides execution.

**Acceptance.**
1. Configure two US destinations, taxable/exempt goods, a documented exempt customer and discounted shipping.
2. Check provider-backed totals before payment and a partial-return tax adjustment; interrupt the tax provider and verify checkout refuses an unpriced obligation and reports the cause.
3. Quote two US addresses in the same ZIP code that fall in different city or special-district jurisdictions and verify each is charged its own address-level rate.

**Evidence.** `tests/api/operations.test.mjs`; `tests/ui/tax-settings-journey.mjs`; `tests/ui/tax-commerce-journey.mjs`; `scripts/tax-live-receipt.mjs`; `docs/tax-001-test-mode-receipt.json`
**Gap.** Native test-mode configuration, address-level quotes, paid references, reversals and reports are asserted. RL-107’s original-line jurisdiction attribution, visibly derived or unallocated amounts and jurisdiction-specific nexus inclusion/period/net-sales rules remain unproved; existing whole-order allocation cannot certify those outcomes. Connected marketplace feeds and complete provider detail/live acceptance remain outside recorded proof.

#### TAX-002 — Filing-period sales-tax liability reports

Core · target · **partial** · From TAX-001 · Register R-6

**Requirement.** For a selected shop-zone filing period, tax reports show state gross, taxable, non-taxable and exempt sales, shipping, tax collected, refunds and adjustments, then county, city and special-district detail and contributing transactions. Each level exports and drills to order and provider references; marketplace-facilitated evidence remains separate and refunds belong to their posting period. Reports consume TAX-004’s original-line attribution and label derived or unallocated amounts, rather than inventing provider jurisdiction truth.

**Acceptance.**
1. After taxed sales to two states (one with county, city and special-district tax) and a partial refund in the following month, run the liability report for each month and verify the state, jurisdiction and transaction levels and their CSVs reconcile exactly to the order records and tax-provider transaction references, with the refund in its own period.

**Evidence.** `tests/api/operations.test.mjs`; `tests/ui/tax-settings-journey.mjs`; `tests/ui/tax-commerce-journey.mjs`; `scripts/tax-live-receipt.mjs`; `docs/tax-001-test-mode-receipt.json`
**Gap.** Native test-mode configuration, address-level quotes, paid references, reversals and reports are asserted. RL-107’s original-line jurisdiction attribution, visibly derived or unallocated amounts and jurisdiction-specific nexus inclusion/period/net-sales rules remain unproved; existing whole-order allocation cannot certify those outcomes. Connected marketplace feeds and complete provider detail/live acceptance remain outside recorded proof.

#### TAX-003 — Configured jurisdiction nexus indicators

Core · target · **partial** · From TAX-001 · Register R-6

**Requirement.** Configured economic-nexus thresholds show state sales and transaction counts and warn before crossing. Under RL-107 each jurisdiction explicitly sets inclusion, period, net-sales and marketplace treatment; configured warnings are management indicators, never legal certification. Registration and filing stay with the merchant, adviser, Avalara Returns, TaxJar AutoFile or another chosen filing partner.

**Acceptance.**
1. Approach a configured nexus threshold and verify the warning.
2. Configure two jurisdiction-specific nexus inclusion, period and net-sales rules, including their marketplace treatment, and verify each warning uses those rules rather than a universal gross-sales assumption.

**Evidence.** `tests/api/operations.test.mjs`; `tests/ui/tax-settings-journey.mjs`; `tests/ui/tax-commerce-journey.mjs`; `scripts/tax-live-receipt.mjs`; `docs/tax-001-test-mode-receipt.json`
**Gap.** Native test-mode configuration, address-level quotes, paid references, reversals and reports are asserted. RL-107’s original-line jurisdiction attribution, visibly derived or unallocated amounts and jurisdiction-specific nexus inclusion/period/net-sales rules remain unproved; existing whole-order allocation cannot certify those outcomes. Connected marketplace feeds and complete provider detail/live acceptance remain outside recorded proof.

#### TAX-004 — Original-line tax reversals and conservative remedies

Core · target · **partial** · From TAX-001 · Register R-6

**Requirement.** Under RL-107 each item and shipping reversal stays linked to its original provider line and allocates only to that line’s evidenced jurisdictions. Local allocation is labelled derived; unsupported tax remains unallocated for filing review. Non-line goodwill leaves sales tax unchanged and posts a zero-tax adjustment. Payment to a different full address has no tax commitment or fulfillment and uses a reviewed whole-payment refund. Marketplace evidence remains separate and restoration restores observations without spending authority.

**Acceptance.**
1. Under RL-107 partially reverse item and shipping lines and verify allocation uses only each original provider line’s evidenced jurisdictions, derived allocations are labelled and unsupported amounts remain unallocated for filing review.
2. Verify non-line goodwill has zero tax and a different-address payment uses the reviewed full-refund remedy; marketplace reporting stays separate and restored observations provide no sale authority.

**Evidence.** `tests/api/operations.test.mjs`; `tests/ui/tax-settings-journey.mjs`; `tests/ui/tax-commerce-journey.mjs`; `scripts/tax-live-receipt.mjs`; `docs/tax-001-test-mode-receipt.json`
**Gap.** Native test-mode configuration, address-level quotes, paid references, reversals and reports are asserted. RL-107’s original-line jurisdiction attribution, visibly derived or unallocated amounts and jurisdiction-specific nexus inclusion/period/net-sales rules remain unproved; existing whole-order allocation cannot certify those outcomes. Connected marketplace feeds and complete provider detail/live acceptance remain outside recorded proof.

#### RISK-001 — Fraud indicators and human review

Core · target · **partial** · Cites BASE-ROLE-001, BASE-AUDIT-001

**Requirement.** Processor risk signals and payment/address mismatches appear with their provenance in a restricted merchant queue. Configured rules hold fulfillment and notify authorized staff once per order and signal set. Release or fulfillment-only cancellation records its decision maker; money and reserved stock remain separately accountable, and a new provider flag reopens review. Scores never certify fraud or decide refund entitlement. An agent’s release or cancellation carries live and commitment; the company’s policy decides execution. The merchant-role and fulfillment-only boundaries follow RL-2. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Create low-risk and flagged provider test orders, inspect the restricted queue, attempt fulfillment while held and release/cancel with an authorized reviewer.
2. Repeated risk callbacks must not duplicate holds or messages.

**Evidence.** `tests/api/operations.test.mjs`; `tests/ui/risk-journey.mjs`; `tests/ui/staff-journey.mjs`
**Gap.** Audit gap: Repeated callbacks leave exactly one hold, beyond reading one matching revision. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

### Fulfillment, orders and returns

#### SHIP-001 — Shipping zones, live rates, international USD shipping, pickup and delivery

Core · target · **partial** · Rules D-1 · Register R-5

**Requirement.** Merchants configure shipping zones for the US (by state/ZIP) and for Canada and other countries served in USD from the same store, with service eligibility, free/flat/weight-based rules, handling cutoffs and delivery promises; checkout rates packages from current variant weight/dimensions through ShipStation, Shippo or EasyPost for USPS, UPS and FedEx domestic and international services. International rates state that duties and import taxes are the recipient's responsibility unless the merchant enables a supported duties-paid (DDP) landed-cost service through the shipping provider, and checkout collects the destination's address format and the phone number carriers require. Destinations outside configured zones and embargoed destinations are refused before payment. Shoppers choose eligible service, local pickup at a named store location (shown with its address, opening hours, pickup instructions and expected ready time) or local delivery inside the merchant's delivery area (set per location by ZIP codes or a radius, with its own fee, minimum order and delivery instructions) with clear price and instructions; changed address/package invalidates stale quotes. Pickup and local-delivery orders are completed through SHIP-007, never through a carrier label. Each location has a daily handling cutoff, handling days and a business-day and holiday calendar; the delivery date or range promised at checkout is computed from them and the service's transit time, is shown on the product page and in checkout, and the paid order keeps the promise it was sold under. Split-source orders show combined charges and feasible dates. Which rates and services apply to which products is set by shipping profiles (SHIP-004); this clause's zones and rules are the general profile every product starts in. Local currencies and regional storefronts are EXPAND-001.

**Acceptance.**
1. Quote different US ZIPs and package weights with live provider test rates, select pickup/local delivery, change address after selection and verify repricing.
2. Select local pickup and verify the location, hours and instructions are shown and kept on the paid order; enter a ZIP outside the delivery area and verify local delivery is not offered, and below the delivery minimum verify checkout states the amount still needed.
3. Set a 2 p.m. Eastern handling cutoff with one handling day and a holiday the next business day; place orders just before and just after the cutoff and verify promised delivery ranges one business day apart that skip the holiday, kept on each paid order.
4. Quote Canadian and UK addresses in USD with provider rates and verify the duties disclosure.
5. Refuse destinations outside configured zones and show actionable carrier outages; the paid order must retain the selected service and quoted charge.
6. At checkout for a US address verify that live USPS and UPS services are both offered at the provider's current rates, and that a rate changed in the provider test account is reflected in the next quote.

**Evidence.** `src/stall/shipping-charge.ts`; `src/stall/checkout.ts`; `src/stall/stripe.ts`; `tests/api/commerce.test.mjs`
**Gap.** Owner-configured free/flat domestic US shipping is reviewed, charged through Stripe and retained on orders for shipping-only refunds. Zones, live carrier rates, international destinations, pickup/local delivery, profiles and handling promises remain absent; no postage or rate verification is claimed.

#### SHIP-002 — Purchase, print and void carrier labels

Core · target · **missing** · Rules D-1 · Register R-5

**Requirement.** Authorized staff buy and print outbound/return labels through ShipStation, Shippo or EasyPost, prepare manifests and packing slips, and void unused labels with reconciled charges. Labels work out of the box at the shipping provider's own discounted USPS, UPS and FedEx rates with no carrier account of the merchant's own, as Shopify Shipping does; a merchant who has their own carrier accounts and negotiated rates can connect them, and the rate shown names which account it uses. Staff can add parcel insurance for a declared USD value when buying a label, through the provider's insurance (Shippo or EasyPost insurance, or ShipStation's shipping insurance) or the carrier's declared-value coverage; the premium is shown before purchase, counts in the approved spend, reconciles with the label charge, and a lost or damaged insured parcel opens an ORDER-004 claim carrying the insurance reference. Merchants edit the packing-slip template (logo, store and return address, which fields print such as prices, SKUs, images, barcodes, order and gift notes, and a return or thank-you note), preview it on a real order, and every slip printed singly or in a batch (SHIP-005) uses the saved template. International labels carry customs declarations (CN22/CN23 or commercial invoice) generated from each line's customs description, HS tariff code, country of origin, quantity and USD value (CATALOG-001), submitted electronically through the provider where the carrier supports it and printable with the label; a missing HS code or origin blocks purchase with a link to fix the product rather than sending incomplete data. Label purchase binds the order, package, service and approved spend. An uncertain provider response is looked up by the same reference before another purchase; downloadable label data is access-controlled. Labels are bought one order at a time here or as a reviewed batch of many orders (SHIP-005); a merchant who already ships from their own ShipStation or a 3PL buys labels there instead (SHIP-006).

**Acceptance.**
1. Buy and print a label for each supported carrier through a connected shipping provider, lose one successful response, reconcile it, then void an unused label and buy a return label.
2. Buy a label to a Canadian address in USD with HS code and country of origin taken from the product, print the customs form and verify its values; remove a product's HS code and verify purchase is refused with the fix path.
3. With no merchant carrier account connected, buy a USPS label at the provider's rate; then connect a merchant UPS account and verify its negotiated rate is quoted and named.
4. Buy a label insured for a $200 declared value, verify the premium in the reviewed spend and the provider charge, and open a lost-parcel claim from it that carries the insurance reference.
5. Edit the packing-slip template to add a logo, hide prices and add a return note, preview it, and verify the printed slip from a single label and from a batch.
6. Verify one charge/label per operation, usable documents and restricted access.
7. Start each purchase from the order's page in the desk and verify the label prints from there with the order's ship-to address, package and service already filled in.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

#### SHIP-003 — Split fulfillment, tracking and delivery exceptions

Core · target · **partial** · Cites BASE-MAIL-001

**Requirement.** Staff allocate lines to locations/packages, partially fulfill or backorder the remainder, and record carrier/service/tracking per shipment. Provider scans drive shipped, in-transit, delivered, delayed, failed and lost states with timestamp/source; shoppers receive truthful tracking and delivery notices. Carrier delivery is attributed evidence, not a guarantee of physical receipt; shipment edits and duplicates preserve remaining quantities.

**Acceptance.**
1. Split a two-line order across locations, dispatch one parcel, then the remainder; receive duplicate, out-of-order, delayed and delivered tracking callbacks.
2. Verify each shopper view/email and remaining quantity, and open an exception when scans go stale.

**Evidence.** `src/stall/shipment-sync.ts`; `src/stall/ui/order-panel.tsx`; `tests/api/commerce.test.mjs`
**Gap.** Owner refresh reads actual Pier partial/full dispatches, carton tracking and delivery status; split shipments are aggregated by order line. Stall can still prepare/approve a whole-order Pier dispatch. Carrier label purchase, tracking emails and wider delivery exceptions remain absent.

#### SHIP-004 — Shipping profiles for specific products

Core · target · **done** · Cites BASE-ROLE-001, BASE-DATA-001

**Requirement.** Merchants group products or variants into shipping profiles: a general profile every product starts in, plus custom profiles (at least the 99 Shopify allows) for items such as oversized, fragile, free-shipping or local-only goods. Each profile has its own ship-from locations, zones, rates (free, flat, weight- or price-based, carrier-calculated, with optional surcharge or handling fee) and allowed services, and can be pickup-only or local-delivery-only. Products and variants are assigned to a profile in the product editor, the bulk editor and catalog CSV (CATALOG-001/002), and Shopify shipping profiles map across in migration (MIGRATE-001). For a cart that spans profiles, each offered service is priced as the sum of each profile's rate for its own items in that service; a service is offered only when every profile in the cart allows it; a pickup-only or local-delivery-only item removes shipped services for the order and says which item caused it. A variant whose profile does not serve the destination is refused before payment, naming the line and keeping the rest of the basket. Each quote records the profile revisions it used; editing a profile or reassigning a product invalidates open quotes, and the paid order keeps the profile revision and quoted charge it was sold under. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md). Agent profile changes carry live, with company policy deciding them.

**Acceptance.**
1. Configure a general profile ($6 flat), an oversized profile ($25 flat, UPS Ground only), a free-shipping stickers profile and a furniture profile allowing only local pickup and local delivery.
2. Quote a cart with one general and one oversized item to a US ZIP and verify a single UPS Ground option at exactly $31.00; add a sticker and verify the charge is unchanged; add a furniture item and verify shipped services disappear, pickup and local delivery remain and the cause is named.
3. Send the oversized item to a ZIP its profile does not serve and verify refusal before payment naming that line.
4. Bulk-reassign the oversized products to the general profile through the CATALOG-002 grid and a catalog or inventory CSV, verify the open quote is invalidated and the new quote changes, and verify an earlier paid order still shows its original profile revision and charge.

**Evidence.** `tests/api/shipping.test.mjs` — “SHIP-004: profiles price mixed baskets per service, refuse unserved lines before payment, and bulk reassignment invalidates open quotes while paid orders keep their profile revision and charge”; `tests/ui/shipping-journey.mjs` — “shipping”
**Gap.** None.

#### SHIP-005 — Bulk label purchase and batch fulfillment

Core · target · **missing** · Rules D-1 · Register R-5

**Requirement.** From the order list, authorized staff select paid orders (up to 100 per batch per ship-from location, as Shopify allows) and create shipping labels as one batch. Before review, Stall skips and names every order it cannot label, with the reason: already fulfilled, no shipping required (pickup, local delivery or digital only, which complete through SHIP-007 instead), invalid or unverified address, missing customs HS code or country of origin on an international line, payment not yet captured or verified, a risk hold (RISK-001), or stock not reserved. One review screen shows each remaining order's package preset and weight, default service (from its shipping profile and rules, editable per order or in bulk) and label cost, plus the batch's total spend against the approved limit; one exact batch decision binds the exact batch revision and each order's draft under ORDER-002. Each label is bought under its own idempotent reference; an uncertain or lost provider response is looked up before any retry, so every order ends with exactly one label, and failures are listed for fixing without re-buying succeeded labels. The batch produces one combined label PDF (4×6 thermal or letter) and one combined packing-slip PDF in the same order, plus a pick list, and can be reprinted. Each labeled order moves to fulfilled with carrier and tracking (SHIP-003), dispatches against its stock authority once, and its shopper gets exactly one shipment notice (MAIL-001). Staff can also bulk-mark orders fulfilled with tracking numbers from a CSV upload when labels were bought elsewhere. Batch history keeps who approved, spend, outcomes and skipped orders. An agent batch call carries money and external; the company’s policy decides execution.

**Acceptance.**
1. Select a mixed batch of paid orders: valid domestic orders, one already fulfilled, one pickup-only, one with an undeliverable address and one international order whose product lacks an HS code.
2. Verify each excluded order is skipped with its reason, review per-order services and total spend in the provider test account, change one order's service, and approve the batch once.
3. Lose one provider purchase response and verify reconciliation leaves exactly one label per order and one provider charge each.
4. Download one combined label PDF and one packing-slip PDF and verify their order and count; verify every labeled order is fulfilled with tracking, its stock dispatched once, and each shopper received exactly one shipment notice.
5. Bulk-mark three further orders fulfilled from a tracking CSV and verify the same outcomes.

**Evidence.** `src/stall/fulfilment.ts`
**Gap.** No implementation found: fulfillment prepares and approves one whole-order Pier shipment at a time; batch selection, labels and combined documents are absent.

#### SHIP-006 — Merchant shipping apps and 3PLs as fulfillment connections

Core · target · **missing** · Rules D-1 · Register R-5

**Requirement.** A merchant who already packs in their own ShipStation account, or ships through a 3PL such as ShipBob or ShipMonk, connects it as the fulfillment connection for a location or for the whole store. Paid orders cleared of payment and risk holds are sent once, with lines, SKUs, weights, customs data, ship-to address, the shopper's selected service and paid shipping, and order and gift notes. A shipment created there (label bought in ShipStation, or a 3PL dispatch) writes carrier, service and tracking back to the Stall order, records the fulfillment, dispatches stock against the line's stock authority once and sends one shipment notice; partial shipments keep the remaining quantities open. Address and line edits and cancellations in Stall propagate to the connection, and an edit or cancellation the external tool has already shipped against is refused in Stall with the shipment named. Orders routed to a connection are not offered for Stall label purchase, so nothing is labeled twice. A 3PL connection may also be the variant's stock authority through STOCK-001's alternate adapter. Duplicate, late and out-of-order callbacks reconcile by the external order and shipment IDs; connection health and orders stuck unsent or unshipped past a set time are visible as staff work.

**Acceptance.**
1. Connect a ShipStation test account as the fulfillment connection.
2. Place paid orders and verify each appears in ShipStation exactly once with its service and notes; buy a label there and verify tracking writes back, the Stall order is fulfilled and the shopper gets one shipment notice.
3. Edit an unshipped order's address and cancel another, and verify both propagate; try to cancel a shipped order and verify refusal.
4. Replay the shipment callback and verify no second fulfillment or notice, and verify routed orders are absent from Stall's label batch.
5. Repeat the order-to-shipment journey with a ShipBob or ShipMonk sandbox, including stock read through the 3PL.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented: no ShipStation or 3PL order export or tracking write-back exists.

#### SHIP-007 — Local pickup and local delivery fulfillment

Core · target · **missing** · Rules D-1

**Requirement.** Pickup and local-delivery orders follow their own fulfillment states and never need a carrier, label or tracking number. A pickup order shows in the order list and a pickup queue with its pickup location: staff set the items aside and mark it **ready for pickup**, which sends the shopper one ready-for-pickup notice (MAIL-001: email, plus SMS with consent) carrying the location's address, hours and pickup instructions; when the customer collects, staff mark it **picked up** (optionally recording who collected after an order-number or name check), which fulfills the order. A local-delivery order goes from unfulfilled to **out for delivery**, which sends one out-for-local-delivery notice with the expected window and delivery instructions, then to **delivered**, which fulfills the order and sends one delivered notice; a failed attempt records a reason, returns the order to ready for delivery and creates a staff task. Staff print a pick list for pickup orders and a delivery list for the driver (each stop's name, address, phone, delivery instructions, items and order notes, sorted by ZIP or a route order staff set). Each step is an attributable staff action under the same role checks from the order desk, the pickup and delivery lists (several orders at once) and the MOBILE-002 merchant app. Stock dispatches once against each line's stock authority (Pier, the alternate connector or STOCK-003 store-managed counts) at the pickup or delivery location, when a pickup order is picked up or a delivery order goes out for delivery; a partial pickup keeps the remaining lines open. Repeating a step, a double tap or a stale screen observes the current state and sends no second notice or dispatch. A pickup order not collected within the merchant's pickup window (for example 7 days after ready) becomes a staff task with an optional reminder notice, and staff can cancel and refund it under ORDER-004 with a reason, releasing the set-aside stock. The customer's order view and the merchant's history show each state, who set it and when.

**Acceptance.**
1. Buy a pickup order and a local-delivery order through checkout with a test card.
2. Mark the pickup ready and verify exactly one ready-for-pickup email (and one SMS for a consenting shopper) carrying the location, hours and instructions; mark it picked up and verify the order is fulfilled with no carrier or tracking number and its stock dispatched once at that location.
3. Mark the delivery out for delivery, then delivered, and verify one notice per step and a fulfilled order; print the delivery list and verify each stop's details.
4. Repeat each step from the desk and the merchant app and verify no second notice or dispatch.
5. Leave a second pickup order uncollected past its window, verify the staff task, then cancel and refund it under ORDER-004 and verify one refund and released stock.

**Evidence.** `src/stall/fulfilment.ts`
**Gap.** No implementation found: fulfillment has only an approved whole-order Pier shipment; pickup and local-delivery states, notices, lists and uncollected-order handling are absent.

#### ORDER-001 — Searchable retail order history

Core · target · **done** · From ORDER-001 · Cites BASE-ROLE-001, BASE-DATA-003, BASE-AUDIT-001

**Requirement.** The merchant desk combines status, customer, date, SKU, channel and overdue filters across the complete order set, with a full count and oldest matches. It joins immutable commercial snapshots, assignments, provider references and attributable history without borrowing later catalog or address changes. Time labels follow ORDER-007, internal notes ORDER-008, manual payments ORDER-009, and risk/draft invoices ORDER-006.

**Acceptance.**
1. Create a manual order and a storefront order, assign staff and notes, filter an overdue partial shipment, and open its full history.
2. Change a catalog price/customer address and verify historical commercial snapshots and original provider references remain.
3. Search more than 100 orders by email, name and SKU and find the oldest match with the full count.

**Evidence.** `tests/api/commerce.test.mjs` — “ORDER-009: manual paid sales reserve once, preserve commercial truth and record reviewed refunds without moving money”; “payment survives a lost Pier response and duplicate delivery reserves only once”; “ORDER-007 / ORDER-001: time zones and revision-checked staff assignments survive transfer without granting authority”; “warehouse dispatches refresh into Stall without a second dispatch; partial work stays unfinished”; “OPEN-001: an owned installation publishes 200 products, adds 10 staff and takes 1000 paid orders without author fees or gates”; `tests/api/data.test.mjs` — “ORDER-008: internal notes and tags require human staff, exact revisions and owner redaction”; `tests/ui/journey.mjs` — “orderDeskJourney (through tests/ui/order-desk.mjs)”; `tests/ui/order-desk.mjs`
**Gap.** None.

#### ORDER-007 — Shop time zones and daylight-saving dates

Core · target · **partial** · From ORDER-001 · Cites BASE-ROLE-001, BASE-DATA-003, BASE-AUDIT-001

**Requirement.** The merchant-selected IANA zone controls labels and inclusive placed-date filters; stored and exported commercial times stay UTC. The initial zone is America/Chicago. A saved zone changes labels from the next request without rewriting history, and each event shows its own daylight-saving offset. Repeated local times use their first occurrence and skipped times the first instant after the gap; every clause using a local day or schedule inherits these rules. Agent settings changes carry live and follow company policy.

**Acceptance.**
1. Save America/New_York as owner; verify a member without the settings role is refused, and an agent’s live-class call follows the held company policy.
2. Verify an order placed at 23:30 Chicago time moves to the next date in labels and the date filter while its stored and exported UTC time is unchanged.
3. Verify orders on both sides of a fall-back and a spring-forward transition show their own offsets on the right inclusive dates.

**Evidence.** `tests/api/commerce.test.mjs`; `tests/api/data.test.mjs`; `tests/ui/journey.mjs`; `tests/ui/order-desk.mjs`
**Gap.** Audit gap: Agent live-class decision under an actual held company policy; Chicago previous date labels (assertion is in uncited tests/ui/order-desk.mjs); New York next date label (assertion is in uncited tests/ui/order-desk.mjs); Spring-forward and fall-back labels show each event offset (assertion is in uncited tests/ui/order-desk.mjs). Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

#### ORDER-008 — Internal order notes, tags and erasure

Core · target · **partial** · From ORDER-001 · Cites BASE-ROLE-001, BASE-DATA-003, BASE-AUDIT-001

**Requirement.** Order notes and tags are internal plain text with authorship and time; corrections append, and only the owner redacts with a reason. They are absent from shopper views, notices, slips, provider payloads and API events, and separate from CART-001 shopper notes. Customer erasure replaces note text and removes tags and manual payment references while retaining anonymous authorship, including after transfer. RL-3 governs this retained-history boundary; an agent’s note access follows its grant and company policy.

**Acceptance.**
1. Under the held company policy verify an ungranted member, an agent without note access and the public shop never receive a note or tag, and redact a note as owner.
2. Erase the customer and verify the note text is replaced, the tags and payment reference are removed and authorship is kept, also after archive restore.

**Evidence.** `tests/api/commerce.test.mjs`; `tests/api/data.test.mjs`; `tests/ui/journey.mjs`; `tests/ui/order-desk.mjs`
**Gap.** Audit gap: Member denied response excludes populated notes and tags beyond its refusal status. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

#### ORDER-009 — Paid manual retail orders and recorded refunds

Core · target · **done** · From ORDER-001 · Cites BASE-ROLE-001, BASE-DATA-003, BASE-AUDIT-001

**Requirement.** Staff record already-paid retail sales from current catalog quantities, customer details and reviewed exact USD totals. Cash, check, bank transfer or other receipt is expressly staff-recorded, never processor-verified, with a nonfuture received date in the shop zone. Stock uses the ordinary reservation and shortfall recovery, while a refund records staff action within ORDER-003 limits without a processor call. Manual orders explicitly record no tax and send no confirmation. Agent financial actions carry money and follow company policy; unpaid orders and invoices remain ORDER-005 and PAY-001.

**Acceptance.**
1. Record a manual order paid by check and verify the staff-recorded label, one Pier reservation, the explicit absence of a tax record, no message sent and the Manual channel filter. Then refund it and verify a recorded refund within ORDER-003 limits with no processor call.

**Evidence.** `tests/api/commerce.test.mjs` — “ORDER-009: manual paid sales reserve once, preserve commercial truth and record reviewed refunds without moving money”; `tests/api/data.test.mjs`; `tests/ui/journey.mjs` — “orderDeskJourney (through tests/ui/order-desk.mjs)”; `tests/ui/order-desk.mjs`
**Gap.** None.

#### ORDER-006 — Complete retail order desk: risk and draft invoices

Core · target · **missing**

**Requirement.** The merchant desk searches and filters orders by risk (RISK-001). Staff create draft retail orders and send payable invoices (ORDER-005).

**Acceptance.**
1. Create an order paid from a draft invoice (ORDER-005), filter orders by risk, and open its full history.

**Evidence.** None.
**Gap.** Risk records/filter (RISK-001) and draft orders/payable invoices (ORDER-005) remain absent. Current paid manual and storefront orders are ORDER-001.

#### ORDER-002 — Exact shipment approval and one dispatch

Core · target · **partial** · Cites BASE-OPS-003 · Rules D-2

**Requirement.** A shipment binds an exact draft against a paid, reserved order. Its agent call carries external, with company policy deciding execution; the held policy obtains an exact person approval. Approval is durable before the dispatch effect of each line's stock authority: the Pier dispatch, the alternate stock connector's fulfillment call, or, for untracked and store-managed variants (STOCK-003), a manual fulfillment record with merchant-entered carrier, service and tracking number that drives tracking (SHIP-003) and the shipment notice (MAIL-001). Stale drafts fail and lost responses reconcile to one dispatch with the original reservation, reference and quantities. Repeating a completed approval observes the same shipment. In a label batch (SHIP-005) one reviewed approval binds every order's exact draft in the batch, and each order still dispatches once; an order routed to an external fulfillment connection (SHIP-006) dispatches once from that connection's tracking write-back under the same reconciliation. Pickup and local-delivery orders complete through SHIP-007's attributable staff steps with no carrier or tracking number and dispatch once at their location. A stock-provider connection cannot silently redirect an existing order to another inventory account.

**Acceptance.**
1. Prepare a shipment through the desk/command route, reject a stale revision, lose the approved dispatch response, reconcile and repeat approval.
2. Inspect one Pier shipment, released reservation and matching stock ledger quantities.
3. Repeat with the alternate stock connector, and with no stock system fulfill manually with a typed USPS tracking number; verify one fulfillment, the shopper's tracking notice and decremented store-managed stock.
4. Complete a pickup order through SHIP-007 and verify one dispatch at the pickup location with no tracking number required.

**Evidence.** `src/stall/fulfilment.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs`
**Gap.** Current whole-order approval checks Pier first; an already shipped or partly shipped order names its state and requires the remaining work in Pier. Key and restore refusals retain Pier’s reason. Actual Pier dispatches are read back on owner refresh; alternate-connector dispatch and manual fulfillment with typed tracking are absent, and carrier/partial-fulfillment breadth remains SHIP-002/003.

#### ORDER-003 — Reviewed line refunds without duplicate money movement

Core · target · **partial** · Cites BASE-OPS-003, BASE-ROLE-001 · Rules D-2

**Requirement.** Refunds bind the exact purchased lines, reason and computed amount; pending and completed attempts consume the original refundable value and quantities. Shipping-only refunds consume paid shipping; goodwill carries a reason and consumes value without changing refundable quantities. Failed or canceled attempts release their budgets. Original payment references reconcile uncertain outcomes without another payout, and money movement never asserts stock return. Tax and accounting treatment follow TAX-004 and ACCOUNT-001. Configured finance limits and separation apply to people; an agent’s equivalent call carries money and the company’s policy decides it. [Commerce mechanics](docs/COMMERCE-MECHANICS.md) defines exact-cent allocation and historical shipping bounds.

**Acceptance.**
1. Refund one line of a shipped two-line order, lose the processor response, reconcile and repeat approval.
2. Reject a stale or duplicate/over-value refund and inspect one processor refund, unchanged retained line and no stock return.
3. On a delivered order refund the shipping charge alone, then a $5.00 goodwill amount with a late-delivery reason; verify one processor refund each, unchanged refundable line quantities, the refundable value reduced by both, and a further amount above the remaining value refused.

**Evidence.** `src/stall/refunds.ts`; `src/stall/refund-values.ts`; `src/stall/ui/refund-form.tsx`; `src/stall/shipping-charge.ts`; `tests/api/commerce.test.mjs`; `tests/ui/journey.mjs`
**Gap.** Audit gap: Retained unrefunded line unchanged after the item refund; Delivered-order precondition actually established before refund; Late-delivery reason read back after completion. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

#### ORDER-004 — Versioned edits, cancellation and claims

Core · target · **partial**

**Requirement.** Authorized staff edit eligible unfulfilled lines, addresses and delivery methods under a version check, with recalculated tax/shipping and explicit shopper agreement for changed goods or charges. Cancellation voids or refunds payment, releases reservations and reports carrier/stock work still pending; an uncollected pickup order (SHIP-007) is canceled the same way, releasing its set-aside stock. A lost or damaged parcel claim carries any label insurance reference (SHIP-002). Damage, non-delivery and other claims retain evidence, owner, decision and linked replacement/refund without overwriting the original order.

**Acceptance.**
1. Race two edits on an unfulfilled order, obtain shopper approval of a changed total, cancel before and after capture, cancel an uncollected pickup order (SHIP-007) and verify its set-aside stock is released, and resolve a lost-parcel claim on an insured label (SHIP-002) carrying its insurance reference.
2. Verify stale edits fail and each capture/void/refund/stock release and customer notice reconciles once.

**Evidence.** `src/stall/store.ts`; `src/stall/fulfilment.ts`; `src/stall/refunds.ts`
**Gap.** Revision checks exist for current drafts/effects; general edits, cancellation and claims are absent.

#### ORDER-005 — Draft orders, custom lines and payable invoices

Core · target · **missing**

**Requirement.** For phone, email and commissioned orders, staff build a draft for a new or existing customer with catalog variants, custom line items (title, USD price, quantity, taxable or not, and whether it ships and its weight), line or order discounts with a reason, shipping (rated through SHIP-001/004 or a custom charge) and tax calculated through TAX-001, including customer exemptions; staff may optionally hold stock for the draft (STOCK-002). From the draft staff send an invoice email (MAIL-001) with an optional message and a secure, expiring checkout link. The customer pays through Stall checkout with the PAY-001 methods; if they change the shipping address, tax and shipping are recalculated and shown before payment. A verified payment (PAY-003) converts the draft into exactly one paid order that keeps the draft reference, and the draft then closes. Editing a draft after its invoice was sent creates a new revision and invalidates the old link, which then tells the customer the invoice was updated and pays nothing until a fresh invoice is sent; a second payment through a link whose draft is already paid is refused, and a duplicate payment event reconciles to the same order. Staff can instead record payment by a manual method (PAY-001). The draft list shows each draft's invoice state (not sent, sent, opened, paid, expired), and drafts can be duplicated or deleted without affecting orders.

**Acceptance.**
1. Create a draft with a catalog variant, a custom engraved line at a custom USD price, a 10% order discount and a rated shipping charge, and verify provider-backed tax.
2. Send the invoice, open the delivered email's link as the customer, change to a different-state address and verify recalculated tax before paying with a test card.
3. Verify exactly one paid order carrying the draft reference and the custom line.
4. On a second draft send the invoice, edit a line, and verify the old link refuses payment until the new invoice is paid; open the paid first link again and verify a second payment is refused, and replay the payment webhook to verify no second order.

**Evidence.** `src/stall/checkout.ts`
**Gap.** No implementation found: orders start only from storefront checkout; staff drafts, custom lines and invoice links are absent.

#### RETURN-001 — Customer self-service returns, cancellations and exchanges

Core · target · **partial** · Cites BASE-ACCESS-004, BASE-INPUT-003, BASE-DATA-003 · Rules D-2, D-3

**Requirement.** Customers request cancellation, return or exchange by one order’s eligible lines, quantities and reasons, and see policy, decisions and progress. Merchant policy explains windows, condition, final-sale exceptions, fees, return shipping and replacement availability. Under RL-106 independently verified mailbox custody is required for requests and private photos, eligibility failures explain their rule and offer a person-reviewed exception or dispute route. Exchange stock has a disclosed reservation deadline, with cancellation or expiry releasing it and durably reconciling quantities. Requests, commercial decisions, physical receipt and money remain distinct: a request or acceptance alone moves neither goods nor money. The first request creates visible assigned follow-up under FLOW-001. RETURN-002 owns physical and financial resolution. An agent’s binding eligibility decision carries commitment, financial resolution money and outside messages external, with company policy deciding execution. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. As guest and account customers request a cancellation, partial return and size exchange; test expired/final-sale items and another customer's link.
2. Verify staff notification, an explained decision, exchange reservation and customer-visible progress without duplicate requests.
3. Under RL-106 require independent mailbox verification before a guest or account creates a return or exchange or reads private photos; a one-order status link alone is insufficient.
4. Explain an eligibility failure and exercise a person-reviewed exception or dispute without losing the request or its explanation.
5. Set and disclose an exchange reservation deadline; cancel one and expire another, verify each releases its stock once and reconciles the durable reservation and order quantities.

**Evidence.** `tests/api/returns.test.mjs`; `tests/api/operations.test.mjs`; `tests/api/data.test.mjs`; `tests/ui/request-journey.mjs`
**Gap.** Native request, photo, decision, exchange-reservation and progress slices are asserted. RL-106’s independent mailbox step-up for guest requests/photos, exception/dispute route, disclosed reservation expiry and explicit release/reconciliation remain unimplemented or unproved. RETURN-002 still owns goods and financial recovery.

#### RETURN-002 — Physical receipt, restocking and reconciled resolution

Core · target · **partial** · Cites BASE-OPS-003 · Rules D-2

**Requirement.** Return cases connect authorization, provider return label, tracking, staff inspection/condition, accepted quantities, restock/quarantine/disposal in Pier or the stock adapter, tax/shipping/fee adjustments and the reconciled refund/store credit or exchange shipment. Stock is added only after recorded physical receipt/inspection; money and stock can complete separately but unresolved work stays visible. Duplicate receipt/refund callbacks cannot increase either balance twice.

**Acceptance.**
1. Return one damaged and one resellable unit, purchase/track a label, record staff inspection, quarantine one and restock the other, then refund or exchange.
2. Lose stock/refund responses and reconcile to one receipt, one financial resolution and a closed customer-visible case.

**Evidence.** `src/stall/refunds.ts`; `tests/api/commerce.test.mjs`
**Gap.** Reconciled line refunds deliberately avoid restocking; return authorization, labels, inspection and restock workflow are absent.

### Customers, follow-up and channels

#### CUSTOMER-001 — Customer directory, accounts and order history

Core · target · **partial** · Cites BASE-SIGNIN-001, BASE-ROLE-001, BASE-DATA-006 · Rules D-3

**Requirement.** Merchants maintain deduplicated customer profiles, addresses, tags, segments, notes and order lifetime value. Customers register, recover access, manage addresses and read their independently verified mailbox’s imported and new orders, tracking, returns, gift balances and refunds. Directory merges combine merchant metadata without transferring mailbox custody. Lifetime value is paid USD order value less succeeded refunds, with live tag, spend, count and state segments. Under RL-103 merchant enablement admits independently verified self-service without per-customer owner admission; invitations remain single use. Unverified identity expires after seven days and request metadata after thirty, remaining local. Historical imports carry exact source references and reconciled totals without commerce authority. Gift and goodwill balances use a mailbox-bound append-only exact-cent ledger and reviewed reasons, with retained opaque financial history after erasure; redemption and delivery remain PROMO-002 and MAIL-001. Agent directory changes carry standard, financial balance changes money, and the company’s policy decides them. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Import two similar customer records, resolve a duplicate, place guest/account orders and link only after verified email ownership.
2. Sign in as each customer, recover access and attempt foreign order/address/return reads and writes through direct APIs.
3. Tag customers, build a segment by tag, total spent, order count and state, and verify membership updates after a new order and a refund; verify each customer's lifetime value and order count equal the sum of their orders net of refunds.
4. Under RL-103 enable accounts as the merchant and register a customer by independent mailbox verification without individual owner admission; verify single-use invitations, explicit account-purpose disclosure, seven-day identity and thirty-day request-metadata expiry, and exact-cent balance custody separate from metadata merges.

**Evidence.** `tests/api/data.test.mjs`; `tests/ui/customer-account-journey.mjs`; `tests/ui/customer-directory-journey.mjs`; `tests/api/customer-registration.test.mjs`; `tests/api/customer-history.test.mjs`; `tests/api/customer-balances.test.mjs`; `tests/ui/customer-registration-journey.mjs`; `tests/ui/customer-history-journey.mjs`; `tests/ui/customer-balances-journey.mjs`; `tests/ui/customer-order-status-journey.mjs`
**Gap.** Native directory, individually invited accounts, address/history and balance slices are asserted. Merchant-enabled self-service signup under RL-103 still needs supported Base signup; full return/redemption/delivery joins and retained-financial-basis proof remain incomplete. Seven-day identity and thirty-day metadata minimization remain required.

#### CUSTOMER-002 — Consent, preferences and customer privacy

Core · target · **partial** · Cites BASE-PUBLIC-001, BASE-DATA-003, BASE-DATA-006 · Rules D-3

**Requirement.** Customers choose email and SMS marketing separately from service notices at checkout, account, newsletter, contact and popup doors, with source, wording revision, capture time and withdrawal history. Privacy controls cover cookies, pixels and server events, including Google Consent Mode and California opt-out rights. Under RL-104 categories remain denied until a current choice, Global Privacy Control suppresses advertising, and selected region may tailor disclosure without weakening either rule. Independently verified mailbox custody governs preference writes and anonymous capture proves that custody too. Proven imported consent cannot override later withdrawal or erasure suppression; restoration cannot reactivate it. Customer access and erasure requests identify retained financial records and downstream follow-up. Connected marketing channels inherit those choices. Any agent action affecting regulated customer documents carries sensitive, and company policy decides execution. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Import subscribed/unsubscribed/unknown contacts, change preferences at checkout, account and the footer signup, unsubscribe through a delivered message and inspect downstream suppression.
2. Refuse analytics and marketing on the banner in one visit and send Global Privacy Control in another; verify no pixel, server conversion event or ad cookie is sent while checkout works, then accept and verify events resume only from that point.
3. Request access/erasure and restore an older archive with the later journal; verify no marketing reactivation or foreign customer access.
4. Under RL-104 capture preferences only with independent mailbox proof, including anonymous signup or checkout capture; select a different region and verify it cannot weaken current-choice denial, Global Privacy Control or a later withdrawal carried through import or restore.

**Evidence.** `tests/api/data.test.mjs`
**Gap.** Verified-session HTTP choices, imported proof, suppression, selected region and restore are asserted. Anonymous mailbox-proved capture, banner screens, delivered unsubscribe, installed pixels, provider propagation, geolocation and deletion execution remain unproved; RL-104 keeps current-choice and GPC suppression binding.

#### CUSTOMER-003 — One-click reorder from order history

Core · target · **done** · Cites BASE-ACCESS-004 · Rules D-3

**Requirement.** A signed-in customer's account lists their orders newest first with date, items, total, status and tracking (CUSTOMER-001), and each past order offers Reorder. One click builds a cart (CART-001) holding the same variants, quantities and still-valid personalization, with the order's shipping address preselected, at current prices and availability; a line whose variant is archived, unpublished or sold out is left out and named, and every price change since the original order is shown before checkout. Reorder never charges, holds or reserves stock or skips checkout review: the shopper reviews current totals, tax and shipping and pays through PAY-001 like any order. A secure guest order link offers the same reorder into a guest cart; nobody can reorder or read another customer's order. Guest links are revocable, expire within seven days, confer one-order custody and do not survive export, restore, erasure or mailbox change. Reorder copies no prior payment authority, private file capability or checkout answers; all current questions, delivery and enabled tax need fresh review. The detailed link-custody rules are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Sign in as a customer with two past orders, open order history and verify both with their dates, totals and status.
2. Reorder a three-line order after one variant's price changed and another sold out; verify the cart holds the two available lines at current prices with the price change and the sold-out line named, and that no payment, hold or reservation exists before checkout.
3. Complete checkout and verify a new order with its own payment while the original order is unchanged.
4. Reorder from a guest order link, then try to reorder another customer's order through the direct API and verify refusal.

**Evidence.** `tests/api/commerce.test.mjs` — “verified account reorder names current price and stock changes without spending before a new checkout”; `tests/api/operations.test.mjs`; `tests/ui/customer-account-journey.mjs` — “customer-account”
**Gap.** None.

#### MAIL-001 — Transactional confirmations and delivery evidence

Core · target · **missing** · Cites BASE-MAIL-001 · Rules D-1, D-3 · Register R-7

**Requirement.** Branded email through SendGrid or the owner-selected Base mail adapter delivers order/payment confirmation, ready-for-pickup (with the location, hours and pickup instructions), picked-up, out-for-local-delivery and local-delivered notices (SHIP-007), shipment/tracking, delivery, cancellation, return/exchange and refund notices, with a downloadable PDF receipt or invoice from the message and the customer's order view. Staff receive a new-order email by default, with recipients configurable per store. Shoppers who opt in to SMS (CUSTOMER-002) receive shipment, ready-for-pickup, out-for-delivery and delivery texts through Twilio, with STOP handling. A shopper can ask to be notified when a sold-out variant returns; one back-in-stock message goes out when sellable availability returns, and requests expire. Notices derive from committed order transitions and include accurate totals/status and secure links. Merchants edit each notification's template (logo, colors, subject and body copy with order variables), preview it with a real order, send a test and turn optional notices on or off; required order notices cannot be disabled. Mail sends from the merchant's own domain once its SPF, DKIM and DMARC records verify; until then it sends from the installation's verified domain with the merchant's address as reply-to, and a domain that fails verification cannot be selected as sender. Marketing suppression does not silently suppress necessary service mail.

**Acceptance.**
1. Buy, split-ship, deliver, return and refund an order through public doors; inspect the corresponding provider messages, safe order links and the PDF receipt, and confirm the default staff new-order email.
2. With SMS consent verify shipment and delivery texts and STOP.
3. Mark a pickup order ready and a local-delivery order out for delivery and delivered (SHIP-007), and verify one notice per step carrying the location, hours and instructions.
4. Edit the order-confirmation template's logo, color and copy, preview it, send a test, and verify the next delivered confirmation matches.
5. Add a sender domain, publish its DNS records and verify DKIM and SPF pass in the delivered message's headers; verify an unverified domain cannot be selected.
6. Request a back-in-stock notice on a sold-out variant, restock it and verify exactly one message.
7. Repeat callbacks, inject a bounce and lose a send response; verify deduplication, visible uncertainty and staff follow-up without falsely claiming inbox receipt.

**Evidence.** None.
**Gap.** No implementation found. Shared sign-in mail infrastructure does not implement order/customer transactional notifications.

#### RECOVERY-001 — Abandoned-checkout recovery to a valid basket

Core · target · **missing** · Cites BASE-MAIL-001, BASE-OPS-003 · Rules D-3

**Requirement.** Merchants configure consent-aware recovery timing, templates, frequency caps and incentives. An eligible abandoned checkout receives a secure expiring cart link; returning shoppers get current prices, stock, tax and delivery options with changes explained. Payment, unsubscribe, erasure or merchant pause cancels pending recovery; duplicate jobs do not resend. Reports attribute recovered orders and costs without counting unrelated purchases.

**Acceptance.**
1. Abandon guest/account checkouts, advance the configured schedule, receive one recovery message and return through its link after price/stock changes.
2. Buy, unsubscribe and erase before later steps; verify suppression, expiry, renewed review and accurate recovered-order attribution.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

#### MARKET-001 — Mango and consent-aware lifecycle marketing connections

Core · target · **missing** · Cites BASE-DATA-004, BASE-MAIL-001 · Rules D-1, D-3

**Requirement.** Stall connects catalog, customer consent/segments, order, checkout and refund events to sibling [Mango](https://github.com/just-every/run-mango), and supports Klaviyo and Mailchimp email/SMS stacks. Mapping previews, scoped authorization, backfill, suppression and delivery outcomes are inspectable. Mango owns cross-campaign marketing work; Stall owns commerce eligibility, checkout recovery and order truth. No sale or external contact list silently creates marketing consent.

**Acceptance.**
1. Authorize Mango and each supported marketing adapter, preview a segment/event backfill, place and refund an order and withdraw consent.
2. Inspect matching event identities and suppressed contact state downstream; revoke the connector and verify pending sends stop and failures remain actionable.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

#### CHANNEL-001 — Google Shopping, Meta/Instagram, TikTok Shop and Pinterest

Core · target · **missing** · Cites BASE-DATA-004 · Rules D-1

**Requirement.** Merchants publish approved product/variant media, USD price, availability and shipping/tax attributes to Google Merchant Center/Shopping, Meta/Instagram Shops, TikTok Shop and Pinterest catalogs (for shoppable Pins and catalog ads), with per-channel mapping, validation and rejection repair. Where a channel accepts orders, channel orders, cancellations, fulfillment, returns and refunds synchronize to the same retail order and stock reservations. Meta's Facebook and Instagram Shops adapter is a catalog feed plus website checkout: product taps open Stall's product page and checkout with the source attributed, because Meta ended in-app checkout for US shops; Google and Pinterest are likewise feed surfaces whose purchases complete on the website, while TikTok Shop takes orders in-app and synchronizes them. Feed-only surfaces state that limit explicitly; remote and direct sales cannot both spend the last unit unnoticed. Ad pixels and conversion events for the same platforms are CHANNEL-003.

**Acceptance.**
1. Connect each named channel, publish a variant, inspect a rejection and correct it, then change price/stock.
2. In each supported order sandbox import an order and duplicate event, ship/refund it and verify remote status, one reservation and channel-attributed analytics; test revoked channel access.
3. Open a product from the Meta test catalog and verify it lands on Stall's product page and completes in Stall checkout with Meta recorded as the order source.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

#### CHANNEL-002 — Marketplace adapters without becoming a marketplace

Core · target · **missing** · Cites BASE-DATA-004 · Rules D-1

**Requirement.** Optional Webgility-compatible Amazon, eBay and Walmart integrations map listings/SKUs, orders, fees, fulfillment and returns into the same commerce/accounting records. Conflicts, provider limits, channel-specific policy and stale inventory are explicit. Stall remains the merchant's online-store product and does not operate a buyer/seller marketplace.

**Acceptance.**
1. Connect each selected marketplace through Webgility or its supported adapter, backfill and replay an order/refund, change stock and reconcile fees.
2. Show one retail order/stock effect and matching ledger entries, with a visible unresolved mapping case.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

#### CHANNEL-003 — Ad pixels, conversion APIs and custom storefront events

Core · target · **missing** · Cites BASE-PUBLIC-001, BASE-DATA-004 · Rules D-1, D-3

**Requirement.** Merchants connect GA4, Google Ads conversion tracking with enhanced conversions, the Meta Pixel with the Conversions API, and the TikTok pixel with the Events API through their own accounts, and can add sandboxed custom pixels (for example Pinterest or an affiliate network) in a customer-events manager. The storefront and checkout emit one standard event stream (page view, product view, search, add to cart, begin checkout, add shipping and payment info, purchase, and refund where the platform accepts it) carrying variant IDs, quantities, USD value, currency and order ID. Browser and server copies of an event share an event ID so each platform deduplicates them; purchase fires once per verified paid order (PAY-003), never from a browser success page alone. Hashed customer identifiers are sent only with marketing consent, and CUSTOMER-002 consent and Global Privacy Control govern every pixel and server event. Each connection shows delivery status, platform diagnostics and rejected events; custom pixels run sandboxed with no access to payment fields or other pixels' data.

**Acceptance.**
1. Connect GA4 (DebugView), Google Ads conversion diagnostics, the Meta Pixel and Conversions API (Events Manager test events) and the TikTok pixel and Events API (test events).
2. Browse, search, add to cart, begin checkout and buy; verify each platform receives each event once with matching event ID, order ID and USD value, with browser and server copies deduplicated.
3. Replay the paid webhook and reload the receipt page and verify no second purchase; refund the order and verify the refund event where supported.
4. Refuse analytics and marketing consent, and separately send Global Privacy Control, and verify no pixel or server event fires; install a custom pixel and confirm it receives subscribed events but cannot read payment fields.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

#### CHANNEL-004 — Embeddable Buy Button and checkout links

Core · target · **partial** · Cites BASE-PUBLIC-001, BASE-PUBLIC-002, BASE-SECRET-001 · Rules D-1

**Requirement.** Merchants generate an embeddable Buy Button, product card or collection widget for another website (a blog, WordPress or a landing page) and shareable checkout links that preload chosen variants, quantities and an optional discount. Embeds show live published price and availability, add to a Stall cart and complete payment in Stall's checkout with its tax, shipping, consent and payment rules; orders are attributed to the Buy Button or link channel in ANALYTICS-001. Each embed is restricted to the merchant's allowed domains, carries no credentials, and stops selling when its product is unpublished or sold out.

**Acceptance.**
1. Generate a Buy Button and a collection widget, embed them on a test page on an allowed external domain, and buy through them; verify the order, stock and channel attribution.
2. Open a checkout link with two preloaded variants and a discount and verify the reviewed totals.
3. Embed on a disallowed domain and verify refusal, then unpublish the product and verify the button stops selling.
4. Generate and revoke configurations under current authority; read only public product data without credentials or tracking. Create a separate cart with current questions, delivery, tax consent and payment review; restored configurations remain inactive, and order exports preserve the embed or link channel.

**Evidence.** `tests/api/commerce.test.mjs`; `tests/ui/buy-link-journey.mjs`; `docs/BUY-LINKS.md`
**Gap.** Audit gap: Tracking-free script and all its network requests explicitly checked. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

#### REVIEWS-001 — Verified reviews, upsells and cross-sells

Core · target · **missing**

**Requirement.** Merchants collect verified-purchase reviews with star ratings, text and photos natively or through Judge.me, Yotpo, Okendo or Loox adapters, moderate abuse with a visible policy, reply publicly, and merchandise related products, bundles, upsells and cross-sells against current price/stock. Product pages show the rating and reviews with Product, Review and AggregateRating structured data so search results can show stars. Requests obey consent/contact rules. Existing reviews move in through MIGRATE-007 and stay labeled as imported with their source's provenance. Paid incentives, imported reviews or AI-generated text cannot masquerade as a new verified customer review.

**Acceptance.**
1. Fulfill an order, send a permitted review request via the native door and the Judge.me and Yotpo adapters, collect a photo review, moderate a reported review and show purchase provenance.
2. Fetch the product page HTML and validate its review structured data.
3. Add a recommended bundle to cart, exhaust one component and verify the offer updates without overselling.
4. Set manual related products on one product and automatic related products (same collection and frequently bought together) on another; verify each product page shows only published, in-stock related products, sell one out and verify it drops from the recommendations, and add a cart-page cross-sell and verify it lands once in the basket at its current price.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

### Reporting, accounting and migration

#### ANALYTICS-001 — Sales, conversion and contribution margin

Core · target · **partial** · Cites BASE-DATA-003, BASE-ROLE-001

**Requirement.** Merchants inspect date/channel/product/variant/customer reports and traffic-source reports (sessions, conversion and sales by referrer, source and medium, UTM campaign, source, medium and content, landing page, device and location, under a stated last non-direct-click attribution window) for visits, product views, add-to-cart, checkout, payment conversion, gross/net sales, discounts, tax, shipping collected/cost, fees, refunds, gift liability and contribution margin using recorded cost data. Funnels disclose consent-limited/unknown traffic, bot exclusions, attribution window and historical import provenance. Reports drill to orders and export; canceled, test, imported and duplicate events never inflate new conversion. Minimized capture lasts thirty days; sessions last thirty minutes, and last non-direct attribution uses thirty days. Historical imports create no live sale or conversion.

**Acceptance.**
1. Arrive through a UTM-tagged email link, a search referrer and a direct visit, and buy after two of them; verify the traffic-source report attributes sessions, conversion and sales to the right campaign, referrer and landing page.
2. Follow a known visitor-to-refund journey, import historical sales, replay events and compare channel/date totals with orders and processor/accounting references.
3. Remove cost/analytics consent and verify unknowns are labeled rather than fabricated margin or visits.
4. Open the best-sellers report for a date range and verify products and variants ranked by units sold and by net sales after refunds match the orders exactly, and that its conversion rate equals paid orders over sessions for the same window.
5. Apply the stated capture retention, shop-date attribution window and current analytics choice; remove linked capture after withdrawal or erasure, and verify restored observations confer no visitor, cost or import authority.

**Evidence.** `tests/api/commerce.test.mjs`; `tests/ui/analytics-journey.mjs`
**Gap.** ct approval pending for the adopted 30-day capture retention, minimized commercial source retention and native owner or administrator report-access boundary above. Native accounting posting evidence remains ACCOUNT-001; absent references are labelled unknown. No original acceptance point is waived.

#### ACCOUNT-001 — Reconciled QuickBooks Online and NetSuite posting

Core · target · **missing** · Cites BASE-OPS-003, BASE-DATA-004 · Rules D-1

**Requirement.** QuickBooks Online maps customers, products, sales receipts/invoices, taxes, shipping, discounts, gift-card liability, refunds, processor fees and payouts to the merchant's reviewed accounts. Exportable sales/order/payment CSVs support accountants; NetSuite posting is available through Webgility or a documented ERP adapter. Sync exposes pending/posted/rejected/uncertain states, original remote IDs and a reconciliation report; a changed mapping or duplicate event never silently double-posts revenue.

**Acceptance.**
1. Preview account/tax mappings, post a sale, gift redemption, partial refund, fee and payout to QuickBooks Online and the selected NetSuite adapter sandbox.
2. Replay, lose a response and correct an account rejection; reconcile net sales, tax liability and cash to provider and exported records.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

#### MIGRATE-001 — Full reviewed Shopify migration

Core · target · **partial** · Cites BASE-DATA-001, BASE-INPUT-001, BASE-SECRET-001

**Requirement.** A Shopify switching merchant previews and imports products/variants/media/collections and product/variant metafields mapped to custom fields, customers/addresses/consent, historical orders/lines/payments/refunds/fulfilments, shipping profiles (SHIP-004), product reviews from the merchant's review app (MIGRATE-007) and URL redirects with source IDs, count/value reconciliation and explicit unsupported/conflict rows. Store content moves with it: pages (such as About, FAQ, Shipping and Returns, Contact) and store policies (refund, privacy, terms of service, shipping); blogs and their articles with body, images copied into owned storage, author, tags, excerpt, SEO fields and original published date; and the main, footer and nested navigation menus, re-linked to the migrated products, collections, pages and articles. These are read through the Admin API (Page, Blog, Article and Menu objects) because Shopify's CSV exports omit them, and each keeps its original handle or gets one redirect. Active discounts transfer with the same rules so codes already handed out keep working at cutover: code and automatic discounts, amount and percentage off products, collections or the order, Buy X get Y, free shipping over a threshold, with their date windows, eligibility, minimums, combination rules, usage limits and each code's remaining usage, including bulk single-use code batches whose already-redeemed codes stay refused (PROMO-001), read from Shopify's discount export and the Admin API. Discounts that cannot map, such as app-owned discounts or Shopify Functions or Scripts logic, are listed in the coverage report (MIGRATE-006) with the codes affected, never dropped. Gift card balances are transferred or individually reconciled (MIGRATE-006). Incremental cutover catches changes before DNS switch. Historical financial/stock events are read-only provenance and never re-charge, reserve stock, send recovery mail or pretend to prove new conversion. Current reviewed product import/undo guarantees are retained.

**Acceptance.**
1. Use Shopify exports and authorized Admin API data for a representative store, including metafield definitions and values, shipping profiles, a Judge.me review export, content pages and policies, two blogs with articles, the main and footer menus, and discounts covering a code discount, an automatic discount, a Buy X get Y, free shipping over a threshold and a partly redeemed single-use code batch; dry-run counts/values and redirects, apply/resume, reconcile customers/orders/refunds/balances and custom fields, then import the cutover delta.
2. Verify each page and article renders at its original handle (or through one redirect) with its published date, author, tags and images served from owned storage, and each menu links to the migrated objects.
3. Apply each migrated discount in checkout and verify the same rules and remaining usage, and that an already-redeemed single-use code is refused; verify an app-owned discount and a Shopify Functions discount are listed in the coverage report with their codes.
4. Open old links and customer history; verify no external money/stock/mail effects and undo preserves later native work.
5. Time the migration of a representative store of 500 products with variants, 2,000 customers and 5,000 orders from connecting the Shopify source to a reconciled, cutover-ready store (dry run, review, apply and delta) and verify it completes within four hours of elapsed time, recording the measured time.

**Evidence.** `src/stall/imports/csv.ts`; `src/stall/imports/service.ts`; `tests/api/imports.test.mjs`
**Gap.** Only a bounded six-column product CSV stages simple unpublished products; full Shopify objects, media, variants, customers, orders, content pages, blogs, menus, discounts and redirects are absent.

#### MIGRATE-002 — Squarespace Commerce migration

Core · target · **missing** · Cites BASE-DATA-001, BASE-INPUT-001, BASE-SECRET-001

**Requirement.** A Squarespace Commerce merchant migrates products/variants/images, customers/profiles and consent evidence, historical orders/fulfillment/refunds, content and URL redirects through available exports and authorized APIs. The migration preview names source omissions and offers reviewed supplemental mappings for content, balances or records absent from a native export. Counts, USD totals and old URLs reconcile before cutover; source passwords/payment secrets do not transfer.

**Acceptance.**
1. Import a representative Squarespace store via its available export/API doors, supplement missing source fields in the preview and reconcile variant/customer/order/refund counts and values.
2. Cut over old URLs, verify history and customer reactivation, and prove imports cause no payment, stock or email side effects.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

#### MIGRATE-003 — BigCommerce migration

Core · target · **missing** · Cites BASE-DATA-001, BASE-INPUT-001, BASE-SECRET-001

**Requirement.** A BigCommerce merchant migrates catalog/options/variants/media/categories, customer/address/consent data, orders/transactions/refunds/shipments, coupons/gift liabilities and redirects using reviewed export/API mappings. App-owned fields and unsupported objects are listed for explicit mapping. Original IDs and USD totals reconcile and a cutover delta preserves later work without importing source authority or replaying commerce effects.

**Acceptance.**
1. Preview and apply a BigCommerce export/API migration containing variant options, partial shipment/refund, a gift liability and redirects; reconcile source counts and totals, rerun the delta and verify no duplicate objects, stock reservations, charges or notices.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

#### MIGRATE-004 — WooCommerce and extension migration

Core · target · **missing** · Cites BASE-DATA-001, BASE-INPUT-001, BASE-SECRET-001

**Requirement.** A WooCommerce merchant migrates products/variations/media/categories, customers/consent and order/refund/fulfillment history using CSV and authenticated REST exports; maps permalinks to redirects; and gets a per-extension inventory of discounts, gift cards, subscriptions, reviews (imported through MIGRATE-007) and custom fields. Unsupported extension data has a reviewed adapter/supplement path and explicit cutover work rather than disappearing. Secrets, password hashes and stored payment credentials are excluded.

**Acceptance.**
1. Import a WooCommerce store with variable products, a refunded order and representative extension/custom fields.
2. Inspect omissions/mappings before apply, reconcile source values and URL redirects, then repeat the delta and customer activation without replaying historic sales.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

#### MIGRATE-005 — Open-engine and creator-store move-in

Core · target · **missing** · Cites BASE-DATA-001, BASE-INPUT-001, BASE-SECRET-001

**Requirement.** Medusa, Saleor and Fourthwall merchants can map their authorized export/API data into the same reviewed migration process for available products/variants, customers, orders, fulfillment/refunds, content and redirects. The preview inventories provider-owned production, memberships and subscription records, lists inaccessible data and supports reviewed supplements/partner handoff. No adapter invents source consent, passwords, processor authority or missing fulfillment evidence.

**Acceptance.**
1. For each named source preview an authorized export/API sample and source-field coverage, apply and resume its mapped catalog/customer/order history, reconcile totals/redirects and explicitly resolve unavailable creator-production/subscription records before cutover.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

#### MIGRATE-006 — Cutover completeness, source limitations and outstanding liabilities

Core · target · **partial** · Cites BASE-DATA-001, BASE-INPUT-001, BASE-SECRET-001

**Requirement.** Every migration maps source store/entity IDs, paginates to completion, groups multi-row products/orders correctly and distinguishes stock-bearing variants from modifiers. Media is copied into owned storage before retiring source URLs. A coverage report lists export/API omissions, inaccessible fields, custom/extension data and unresolved records; nothing is silently discarded or labeled fully migrated while unresolved. Content pages, policies, blog articles and navigation menus are counted in the coverage report like commerce records. Live discount codes carry their rules, remaining usage and redeemed single-use codes, so no code becomes reusable or invalid at cutover, and a code redeemed on the source after an import is caught by the cutover delta. Product/collection/content redirects reject loops and collisions. Customer access requires reactivation/reset, not imported passwords. Issued gift balances reconcile as liabilities with secure carryover/reissue and duplicate-redemption prevention. Subscription schedules and processor authority require provider-approved transfer or renewed authorization before billing; historic orders never authorize new charges. A resumable cutover delta and rollback preserve native changes and prevent duplicate source IDs.

**Acceptance.**
1. For each source in MIGRATE-001/002/003/004/005 import continuation rows, variants/modifiers, guest orders, unknown consent, a partially refunded order and a gift liability; interrupt pagination and resume.
2. Retire a source image URL and follow old product/content URLs.
3. Redeem a migrated single-use code on the source after the first import, run the delta and verify it is refused in Stall; verify pages, articles and menus appear with counts in the coverage report.
4. Inspect count/value/omission reports, resolve collisions, activate a customer and verify no password, new charge, renewal, stock or message side effect comes from historical data.

**Evidence.** `src/stall/imports/service.ts`; `src/stall/imports/targets.ts`; `tests/api/imports.test.mjs`
**Gap.** Current product import binds reviewed source/native snapshots and protects undo; complete cross-platform cutover, media, redirects, customer activation and outstanding liability handling are absent.

#### MIGRATE-007 — Product review and rating migration

Core · target · **partial** · Cites BASE-DATA-001, BASE-INPUT-001, BASE-SECRET-001

**Requirement.** A switching merchant imports existing product reviews from their review app so product pages keep their stars from day one. Stall reads the Judge.me CSV export (product handle or ID, rating, title, body, reviewer name and email, date, verified flag, photo URLs and merchant reply), which other review apps also accept, and Yotpo, Okendo, Loox, Stamped and Shopify Product Reviews exports, plus the Judge.me and Yotpo APIs where the merchant authorizes them; WooCommerce and BigCommerce native reviews come through MIGRATE-003/004. Reviews map to products by handle, SKU or source product ID using the migration's source-ID map, and reviews that match no product are listed as orphans with a reason and can be re-mapped before apply. Each review keeps its original date, rating, title, body, reviewer display name and merchant reply; its verified status is kept as the source app's claim (shown as verified by that app) and never counts as a new Stall verified purchase. Photos and videos are copied into owned storage before the source app is canceled (MIGRATE-006). Reviewer emails are held for review-request eligibility under CUSTOMER-002 and never create marketing consent. Imported reviews render with structured data and an imported label, never trigger review-request or other mail, and feed product ratings. A dry run shows counts, orphans and duplicates; re-running the import matches by source review ID, or by content hash when the source has no ID, so it creates no duplicates; undo removes only imported reviews.

**Acceptance.**
1. Dry-run and import a Judge.me CSV export and a Yotpo export for a migrated catalog, including a review for a deleted product and a photo review.
2. Verify the orphan is listed, each review maps to the right product by handle or ID, keeps its original date and source verified status, and its photo is served from owned storage after the source URL is retired.
3. Fetch the product page and validate the structured data and the imported label; confirm no review-request or marketing mail was sent and the imported reviews are not counted as new verified purchases.
4. Re-run both imports and verify no duplicates, then undo one import and verify native reviews remain.

**Evidence.** `tests/api/imports.test.mjs`; `tests/ui/review-import-journey.mjs`
**Gap.** Judge.me and Yotpo authorized API import adapters and native BigCommerce and WooCommerce review intake remain unimplemented or unproved; their duties remain MIGRATE-007 requirements and are not explicitly inherited in both receiving entries. Stamped mapped fields and the legacy Shopify subset are documented source-format boundaries, not complete native-export proof. CUSTOMER-002 retains request eligibility and REVIEWS-001 retains native collection, moderation and permitted requests. Connection-pinned media egress remains an unresolved runtime boundary under API-001 and the Base guarantees. Qualifying exact-SHA push Verify of the newly loaded review browser journey remains required before landing. All original MIGRATE-007 requirements remain.

#### EXPORT-001 — Business CSVs and complete merchant exit

Core · target · **partial** · Cites BASE-DATA-001, BASE-SECRET-001, BASE-ROLE-001

**Requirement.** Merchants export the shop’s product, customer, order, payment, refund, shipment and reconciliation records as documented business CSV and JSON, alongside its complete archive. Schema, currency, time zones, resource bounds and excluded unavailable record kinds are explicit; exports never silently truncate and let an independent operator account for outstanding commerce. Each newly delivered record kind joins these business exports before shipping. The export scope is distinct from the restoration archive; both exclude credentials and installation authority. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Export a populated shop through the desk/API and open its product/customer/order/payment CSVs and complete archive in an independent reader.
2. Reconcile records and exact totals, verify explicit bounds/exclusions and refuse an unauthorized export.

**Evidence.** `src/stall/exports.ts`; `src/stall/tools.ts`; `src/stall/ui/business-exports.tsx`; `docs/BUSINESS-EXPORTS.md`; `tests/api/data.test.mjs`; `tests/api/commerce.test.mjs`
**Gap.** Audit gap: Declared resource bounds and excluded future record kinds asserted. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

### Roles, integrations and dependable operations

#### ROLE-001 — Staff and app least privilege

Core · target · **partial** · Cites BASE-ROLE-001, BASE-ACCESS-004

**Requirement.** The merchant role matrix distinguishes catalog, fulfillment, customer support, marketing, finance and administrator work, customer self-access and scoped applications. Refund ceilings and separation are configurable; single-role grants are owner-managed. Fulfillment and support can work internal order notes and tags, finance can record paid manual orders and prepare or decide refunds, and owner-only redaction, erasure, connection custody and whole-business export remain separate functions. Customer records use independently verified mailbox custody and exclude staff annotations. Under RL-4 new human-role grants start with a zero refund ceiling and another-person approval unless the owner configures otherwise; agent access calls carry access, and their financial calls carry money, with each disposition set by company policy. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Invite each role, perform its permitted workflow and try foreign customer, finance, bulk/export and direct API actions.
2. Downgrade/revoke an active session/app grant during a prepared job and verify the next effect is refused without leaking private records.

**Evidence.** `tests/api/commerce.test.mjs`; `tests/api/data.test.mjs`; `tests/ui/staff-journey.mjs`
**Gap.** Audit gap: Catalog and fulfillment mutations read back after permitted workflow; Marketing setting read back after permitted workflow; Customer support tags read back after permitted workflow; Administrator changed setting read back after permitted workflow; Private data absent from every denied response after revoke. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

#### AGENT-001 — Exact agent commerce actions under company policy

Core · target · **partial** · Cites BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008

**Requirement.** Agent access supports product, shipment and refund preparation and their corresponding exact-revision commerce actions. Product publication carries external and live; shipment carries external; refunds carry money. The company’s policy decides whether each action runs, is reviewed, awaits approval or is off. Under the held policy the named person approves the saved product, shipment and refund revisions. Revocation and expired or stale authority prevent an effect. Wider export, restore and erasure jobs have their own sensitive, security or destructive classes in the Agent surface, with their disposition decided by the company. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Under the held company policy grant an agent access and prepare a product draft; its external and live publication waits for the named person’s exact-revision decision. Exercise export and erasure under their declared classes, and verify declined actions have no effect. Revoke the grant and retry direct reads and writes.
2. Under that policy prepare shipment and refund drafts carrying external and money respectively; verify exact approval, stale-revision refusal and expired-grant refusal. Under all-autonomous policy each permitted class runs without waiting for a person.

**Evidence.** `src/stall/api.ts`; `src/stall/products.ts`; `src/stall/fulfilment.ts`; `src/stall/refunds.ts`; `tests/api/commerce.test.mjs`; `tests/api/data.test.mjs`
**Gap.** Audit gap: Held company-policy classification and decision rather than fixed native gate; Export and erasure dispositions evaluated by their declared classes; All-autonomous company policy completes each permitted class. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

#### API-001 — Documented headless API and signed events

Core · target · **partial** · Cites BASE-ROLE-001, BASE-OPS-003, BASE-DATA-004 · Rules D-1

**Requirement.** A merchant builds a custom storefront with versioned catalog, cart, checkout, customer and order APIs and independently scoped app credentials. Minimal signed order, customer, stock, promotion and return events retain durable identities, subscription filtering, delivery history and replay controls. Under RL-101 current app-management authority authorizes an exact scoped subscription and destination once; matching deliveries follow that subscription and company policy. Customer authentication remains independent, revocation remains effective, and unknown effects reconcile before replay. Native transport must qualify DNS and TLS peer custody before enabling arbitrary egress; further return lifecycle states join the event set as delivered. Extensions do not share administrative sessions. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Use a documented external storefront client to buy and view its own order, subscribe to signed events and reject a tampered delivery.
2. Replay and reorder callbacks, revoke its credential and verify one commercial effect and bounded access.
3. Under RL-101 authorize one exact subscription and destination, deliver matching minimal signed events according to company policy without a new owner decision for each event, revoke the scope and reconcile uncertain replay by the original event identity.

**Evidence.** `docs/HEADLESS-API.md`; `tests/api/commerce.test.mjs`; `tests/api/operations.test.mjs`; `tests/api/data.test.mjs`
**Gap.** The scoped native purchase and signed-event slice is asserted. Connection-pinned DNS/TLS egress remains unavailable, and subscription-governed automatic delivery, complete headless commerce and additional return lifecycle events under RL-101 remain unproved.

#### FLOW-001 — Event and scheduled workflows with visible follow-up

Core · target · **partial** · Cites BASE-OPS-003, BASE-OPS-004, BASE-AGENT-007 · Rules D-1

**Requirement.** Merchants configure event and scheduled triggers for orders, customers, stock, promotions and returns, with conditions, quiet hours, assigned staff and due dates. Dry runs explain matches; versioned rules deduplicate tasks, notifications, integration actions and commerce preparation, and expose loops, failures and uncertain work. Under RL-105 rule, assignee, function and order authority are rechecked at effect time. Preparation and assigned stock follow-up never assert shipment, stock movement or accounting posting. Commerce executes through its separately authorized door, and company policy decides agent execution for that door’s classes. Restore retains history without local activation. Shop-zone scheduling follows ORDER-007. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Configure low-stock, overdue fulfillment, return-request and scheduled reconciliation rules; dry-run and activate them, replay events and stop a rule with pending work.
2. Inspect one task/effect per event and correct owner/due date, not a silent failed background job.
3. Under RL-105 change rule, assignee, function or order authority during preparation and verify the effect uses current authority; company policy decides the commerce action’s classes, and an assigned task never asserts stock, shipment or accounting effects.

**Evidence.** `tests/api/operations.test.mjs`; `tests/api/data.test.mjs`; `tests/ui/staff-journey.mjs`; `tests/ui/workflow-journey.mjs`
**Gap.** Versioned native rules, deduplicated follow-up and human shipment preparation are asserted. RL-105’s policy-governed commerce execution and effect-time authority across broader actions remain unproved. Physical return stock resolution, accounting, approved integration and budget effects remain owed; safe egress is blocked by API-001.

#### INTEGRATION-001 — Owned connections and recoverable external work

Core · target · **partial** · Cites BASE-SECRET-001, BASE-DATA-004, BASE-OPS-003, BASE-AUDIT-001 · Rules D-1

**Requirement.** Owned connections and external commerce work keep account-bound custody, explicit mapping and data-boundary previews, durable commercial intent, original correlation, committed attempts and observed or uncertain outcomes. Stripe recovery reads and validates the original operation; Pier recovery reads current state before replaying the identical durable-receipt command or observing an original completed dispatch. Revocation stops new work, rotation preserves account identity, and restart or transfer never creates a replacement uncertain effect. Configuration and timestamped observation remain distinct. The same commerce-specific custody applies whenever a new provider is delivered; [commerce mechanics](docs/COMMERCE-MECHANICS.md) records provider-specific recovery.

**Acceptance.**
1. Revoke/rotate an account during queued work, lose successful responses at each provider edge and restart the worker.
2. Inspect pending/uncertain work, reconcile by original reference, and prove no new effect identity or secret appears in UI, logs, exports or restored authority.

**Evidence.** `src/stall/connections.ts`; `src/stall/integration-work.ts`; `src/stall/stripe-recovery.ts`; `src/stall/pier-work.ts`; `src/stall/pier.ts`; `src/stall/ui/provider-boundaries.tsx`; `tests/api/operations.test.mjs`; `tests/api/pier-work.test.mjs`; `tests/api/data.test.mjs`; `tests/ui/integration-journey.mjs`
**Gap.** Audit gap: Actual worker interruption and same-store restart while work is pending; No secret in browser data and rendered UI; No secret in captured application logs across those operations. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

#### SECURITY-001 — Guarded native commerce doors

Core · target · **partial** · Cites BASE-ACCESS-002, BASE-ACCESS-004, BASE-ROLE-001, BASE-AGENT-007

**Requirement.** The public catalog and checkout remain usable while native private commerce, import and export doors enforce their scoped roles. Browser origin boundaries and the held company policy protect product, shipment and refund decisions; an agent call is classified under AGENT-001 rather than treated as a person’s approval. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Call private state, product commands, imports and exports anonymously/as a member; attempt cross-origin browser mutation and, under the held company policy, an agent publication carrying external and live; revoke the grant and repeat.
2. All fail without the prohibited write or private response, while public catalog and valid checkout remain usable.

**Evidence.** `src/stall/access.ts`; `src/stall/api.ts`; `src/stall/tools.ts`; `tests/api/commerce.test.mjs`; `tests/api/imports.test.mjs`; `tests/api/data.test.mjs`
**Gap.** Audit gap: Every denied-route payload excludes private records and every denied mutation leaves state unchanged. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

#### DATA-001 — Validated archive and inactive receiving authority

Core · target · **partial** · Cites BASE-DATA-001, BASE-BACKUP-001, BASE-SECRET-001

**Requirement.** Shop archives preserve commerce, decision and provider history, import-source custody and the later erasure journal. Receiving-owner sessions and configuration stay local; source credentials and grants are historical records without destination authority. An archive restores no charge, shipment, refund or message. Tampered archives and nonempty destinations cannot partially publish commerce. [Commerce mechanics](docs/COMMERCE-MECHANICS.md) records the validation and inactive-authority format.

**Acceptance.**
1. Export a populated shop with imports and commerce history, restore through the public portability doors into an empty installation and reconcile records.
2. Attempt changed bytes and a second restore, then try source session/grant credentials at the destination; verify refusal and no provider replay.

**Evidence.** `src/stall/tools.ts`; `src/stall/portability-policy.mjs`; `tests/api/data.test.mjs`
**Gap.** Audit gap: No provider replay explicitly counted during restoration. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

#### ERASURE-001 — Owner-directed contact erasure and backup fencing

Core · target · **partial** · Cites BASE-DATA-003, BASE-DATA-006

**Requirement.** Customer contact erasure resolves unshipped and uncertain shipment or refund work first, removes commerce email, address and checkout fingerprints, and retains anonymous financial history and decision references. A later source journal fences a pre-erasure archive; isolated old offline copies cannot discover later erasure and provider-held records require separate follow-up. An agent erasure carries destructive and the company’s policy decides execution; any confirmation attributed to the owner comes from that owner. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Attempt erasure before shipment and with wrong confirmation, then resolve work and erase.
2. Inspect retained totals/approvals with no contact/address/fingerprint; restore a post-erasure archive and refuse an old archive when supplied the later journal, with no partially restored rows.

**Evidence.** `src/stall/erasure.ts`; `src/stall/portability-policy.mjs`; `tests/api/data.test.mjs`
**Gap.** Audit gap: Exact retained decision references after post-erasure restore. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

#### AUDIT-001 — Durable attributable commercial action history

Core · target · **partial** · Cites BASE-AUDIT-001, BASE-OPS-005

**Requirement.** Commercial history joins purchases, product and shipment preparation, decisions, refunds, reconciliation, grants and erasure with immutable decision and provider references. Anonymous commercial references survive customer-contact erasure and archive transfer. Paging is a presentation bound and never a claim that history was deleted or made tamper-evident. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Run a purchase, human approvals, reconciliation, agent grant/revoke and erasure through public commands, read activity and export/restore the shop.
2. Verify relevant actor/action/time and approval/provider references remain without restoring erased customer contact.

**Evidence.** `src/stall/access.ts`; `src/stall/api.ts`; `src/stall/store.ts`; `tests/api/commerce.test.mjs`; `tests/api/data.test.mjs`
**Gap.** Audit gap: Reconciliation-specific actor action and time asserted in history; Grant revocation actor action and time asserted in restored history; Decision and provider references compared across export and restore. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

#### OPS-001 — Owned installation, recovery and explicit operating limits

Core · target · **partial** · Cites BASE-INSTALL-001, BASE-BACKUP-001, BASE-OPS-001, BASE-OPS-002, BASE-DATA-005

**Requirement.** The shop exposes payment and stock-provider readiness, outstanding commerce and bounded storage and cost declarations alongside the shared installation and recovery journey. Backups include outstanding payment, shipment and refund work. Connections remain distinct from timestamped provider observations, which become historical after rotation or restoration. Hosting, storage, processor, tax, carrier, channel and model costs are separate. Processing bounds and growth or retention observations are documented in [operations](docs/OPERATIONS.md); they do not certify sustained capacity. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Follow the fresh-clone RER journey, retain owner/data/settings across reruns, export/restore, stop/restart and diagnose an unavailable required provider.
2. Inspect health and outstanding jobs, bounded storage/cost declarations and outside requests.

**Evidence.** `src/stall/operations.ts`; `src/stall/ops-providers.ts`; `src/stall/ui/operations.tsx`; `docs/OPERATIONS.md`; `tests/api/operations.test.mjs`; `tests/runtime.mjs`; `tests/clone-journey.mjs`; `tests/ui/journey.mjs`
**Gap.** Audit gap: Declared storage and cost bounds checked through the operating door; Outside request inventory reconciled rather than inferred from readiness. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

#### OPS-002 — Run Stall on the owner's own computer or own server

Core · target · **partial** · Cites BASE-INSTALL-001, BASE-OPS-002, BASE-BACKUP-001 · Register R-8

**Requirement.** Stall’s own-computer and owner-server paths preserve the shop’s commerce and local owner settings. The Linux production path provides durable storage, owner-domain HTTPS, supervision after crash or reboot and continuous service beyond the development idle-stop window; its upgrades preserve an existing order. Fresh-machine and live-host receipts are recorded separately from runnable installation fixtures. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. On each supported fresh-machine fixture, run the documented start and verify a local owner, empty real shop and retained settings after restart.
2. Deploy the same checkout with `rer deploy` to an owner's Cloudflare account, sign in and buy through checkout.
3. Follow the server guide on a fresh Linux VPS: serve the shop over HTTPS on a test domain, take an order, reboot the server and verify it returns with the order intact, leave it idle for more than 12 hours and verify it still serves, then upgrade to a newer release and verify migrations apply and the data remains.

**Evidence.** `src/site/run.json`; `scripts/installer/local.mjs`; `deploy.json`; `tests/clone-journey.mjs`
**Gap.** The one-line local start and own-account Cloudflare deploy exist; there is no own-server production path (`rer dev` and `rer preview` are rer-managed servers with a 12-hour idle stop), and the one-line start has no recorded fresh-machine acceptance.

#### BASE-001 — Preserved Base guarantees with scoped replacements

Core · target · **done** · Cites BASE-ACCESS-002, BASE-ROLE-001, BASE-INPUT-001, BASE-INPUT-002, BASE-INPUT-003, BASE-DATA-001, BASE-DATA-003, BASE-DATA-004, BASE-SECRET-001

**Requirement.** Stall’s deltas use processor-hosted card custody, Pier-owned physical stock, plain-text product descriptions and restoration without source authority. These choices do not exempt rich content, media, customer accounts or future connectors from their shared Base duties. Each such feature keeps its own acceptance and conformance obligation; current conformance cannot certify an absent capability. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Run a product purchase and its refund using hosted processor custody and Pier-owned stock; render hostile product/import descriptions as plain text and restore the product history without source authority.

**Evidence.** `src/stall/imports/description.ts`; `src/stall/portability-policy.mjs`; `tests/api/imports.test.mjs` — “BASE-001: hostile descriptions become plain text; malformed and unsupported source rows never write products”; `tests/api/data.test.mjs` — “post-erasure archive restores commercial history and the import journal”; `tests/api/commerce.test.mjs` — “payment survives a lost Pier response and duplicate delivery reserves only once”; “ORDER-003: partial line refund recovery cannot overrefund and never restocks the shipped item”; `tests/ui/journey.mjs` — “BASE-001 browser journey”
**Gap.** None.

#### OPEN-001 — Free and open source under the MIT license

Core · target · **partial** · Cites BASE-DATA-005, BASE-INSTALL-001

**Requirement.** The source and package declare MIT, with rights to run, modify and redistribute. Every delivered commerce capability is included without author-imposed seat, product, order or revenue tiers, transaction charges or upgrade prompts. The merchant sees each paid processor, tax, shipping, messaging, accounting or hosting provider and its pricing before enabling it. Future capabilities inherit this inclusion and disclosure; named incumbents are independent products. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Verify the source license and package declaration are MIT.
2. Install from the public source with no account or key from Stall's authors, publish 200 products, add 10 staff and take 1,000 test-mode orders with no payment, license, cap or upgrade prompt and no fee added by Stall to any order.
3. Begin enabling Stripe and Pier and verify each provider’s name and pricing before activation.

**Evidence.** `LICENSE`; `package.json`; `src/stall/ui/connect-forms.tsx`; `tests/api/commerce.test.mjs`; `tests/ui/journey.mjs`
**Gap.** Audit gap: Executable assertion of MIT source license; Executable assertion of package MIT declaration; No author payment gate across the complete fresh-install journey; No license cap or upgrade prompt across that whole journey; Every supported provider price and activation order asserted. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

### Product separation and specialist extensions

#### BOUNDARY-001 — Separate products with usable commerce connections

Core · target · **partial**

**Requirement.** Stall remains a complete storefront/retail commerce product. [Pier](https://github.com/just-every/run-pier) owns multi-location warehouse inventory, purchasing and wholesale operations; Stall consumes availability and submits reservations, dispatches, quantity adjustments and accepted returns, and keeps simple store-managed retail counts only when no stock system is connected (STOCK-003). [Mango](https://github.com/just-every/run-mango) owns the broader marketing product. A merchant may use other stock/marketing systems through documented adapters; neither sibling is required to sell, edit pages, manage customers or operate Stall's commerce record. Shared code never merges their products.

**Acceptance.**
1. Operate the storefront/order desk with a documented alternate stock/marketing adapter, then connect Pier/Mango and inspect the handoffs.
2. Verify warehouse purchasing/wholesale work and cross-campaign marketing open the linked product while retail orders and recovery remain manageable in Stall.

**Evidence.** `src/stall/pier.ts`; `src/stall/api.ts`
**Gap.** Pier is a separate product adapter today, but mandatory; Mango and alternative-provider handoffs are absent.

#### EXTEND-001 — Subscriptions, POS, digital downloads and creator fulfillment partners

Core · target · **missing**

**Requirement.** Optional specialist adapters cover recurring product subscriptions via Stripe Billing or a subscription provider, physical POS via Square/Stripe Terminal, and creator production/print-on-demand via Fourthwall or Printful/Printify where their supported interfaces permit. Digital download products sold alongside physical goods deliver files from owner storage through expiring, download-limited links after verified payment, with no shipping or stock, and a refund revokes the link. The shopper sees renewal/fulfillment/cancellation terms and the merchant sees linked orders, refunds and stock/accounting effects. Required partner apps, agreements, payment-device/native work and unsupported source objects are explicit delivery work; partner ownership never excuses a broken commerce handoff.

**Acceptance.**
1. Connect the selected subscription, POS and production provider test accounts; renew/cancel a subscription, complete/refund a POS sale and track a made-to-order product.
2. Buy a digital download with a physical item, download it within its limit, exceed the limit and refund to verify the link stops.
3. Reconcile linked retail orders, tax, stock and payouts, and surface provider rejection without claiming fulfillment.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

#### EXPAND-001 — Multiple stores, regions and currencies

Core · target · **missing**

**Requirement.** A merchant can operate separate branded storefronts/channels with regional price lists, languages, currencies, domains, tax/delivery settings and staff access while retaining an explicit source for each order. USD/US is the first supported buying journey, and selling to Canada and other countries in USD from the same store is already SHIP-001/002; this clause adds local currencies, languages and regional storefronts, which use configured providers and jurisdiction rules rather than silently reusing US defaults. Exchange/refund amounts retain original currency and reported conversion basis.

**Acceptance.**
1. Create a second storefront with a different catalog/price list, locale and currency; buy, partially refund and report in each.
2. Verify domain/catalog/role isolation, original-currency reconciliation and refusal of a region lacking configured tax or delivery support.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

#### B2B-001 — Business buying without absorbing wholesale operations

Core · target · **missing**

**Requirement.** Business customers can use approved company accounts, tax-exemption evidence, contract price lists, quote requests, purchase-order references and approved net terms in the storefront. Pier or the merchant's wholesale/order-credit system owns wholesale fulfillment, procurement and credit policy; Stall presents linked quote/approval/payment status and does not grant terms itself. Accounting and tax mappings reconcile the accepted business order.

**Acceptance.**
1. Approve a company buyer, submit a quoted basket/PO, receive authorized pricing/terms from Pier or a wholesale adapter and accept it in the store.
2. Reject an unauthorized employee or expired exemption; reconcile the approved order, shipment and QuickBooks invoice without a second wholesale ledger.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

### Push further: agents operate the commerce job

#### AI-001 — Operate order exceptions to shopper-approved closure

Core · push-further · **partial** · Cites BASE-AGENT-002, BASE-AGENT-007

**Requirement.** An agent joins live payment/authorization, hold/reservation, location availability, warehouse, carrier scans and promised delivery data to detect oversells, stalled fulfillment or delays. It explains the actual order state to the verified shopper with source timestamps, prepares feasible substitute goods or delivery choices and tracks acceptance through fulfillment or cancellation/refund. Substitution commitments carry commitment, outside shopper messages external and financial effects money, each decided by the company’s policy; the shopper explicitly agrees to changed goods/date/price. Unavailable evidence creates a staff task, never an invented delivery promise. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Create a paid stock shortfall and a carrier delay.
2. Have the agent identify each from live references, offer an in-stock substitute/feasible service, apply the company’s policy for commitment, external and money and obtain shopper agreement, and carry one through delivery and another through cancellation/refund.
3. Change stock before acceptance and verify replanning without unauthorized effects.

**Evidence.** `src/stall/payments.ts`; `src/stall/orders.ts`; `tests/api/commerce.test.mjs`
**Gap.** Paid/shortfall states and manual lost-response recovery exist; detection agent, grounded shopper replies, options and closure workflow are absent.

#### AI-002 — Manage returns end to end

Core · push-further · **partial** · Cites BASE-AGENT-002, BASE-AGENT-007

**Requirement.** An agent applies the merchant's versioned return policy to order, delivery and customer-supplied condition evidence, gathers missing facts, prepares eligibility/fee/exchange options and provider labels, and follows scans to staff inspection, accepted restock/quarantine, refund and accounting reconciliation. Staff confirm physical receipt/condition and disputed eligibility; money movement carries money and replacement shipment external, with company policy deciding each against current state. The agent closes a case only when stock and financial/provider references agree and the shopper is informed. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Ask for a return in the authenticated customer experience, let the agent prepare policy-grounded options and a label, record a human inspection that changes one item's condition, then apply the company’s money and external policy to resolution.
2. Lose a restock/refund response and confirm the agent reconciles both once and leaves a refused/disputed case with an assigned human.

**Evidence.** `src/stall/refunds.ts`; `tests/api/commerce.test.mjs`
**Gap.** Revision-approved reconciled refunds are a foundation; policy reasoning, labels, return receipt, restock and agent follow-through are absent.

#### AI-003 — Improve profitable conversion with measured experiments

Core · push-further · **missing** · Cites BASE-AGENT-002, BASE-AGENT-007 · Register R-9

**Requirement.** An agent reads consented funnel/channel reports, variant cost, stock/lead time, shipping/payment fees, return rates and promotion outcomes to propose merchandising, bundle, placement or content experiments with contribution-margin forecasts. It cites the data/window and missing costs, proposes a small budget and rollback, and measures actual net margin and conversion after refunds. Publication and audience exposure carry external and live, pricing and discount spend carry money, and company policy decides execution. Versioned stop rules halt or roll back a losing experiment without silently raising spend. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. With seeded measured store data (test-only visits, orders, variant costs, refunds and stock confined to the test suite) configure an experiment, inspect the agent's source-backed proposal and unknowns, run a bounded change under the company’s external, live and money policy, then observe conversion lift with margin erosion/returns.
2. Verify stop/rollback, stock feasibility and an honest inconclusive result where sample or cost evidence is inadequate.

**Evidence.** None.
**Gap.** No implementation found. Target journey not implemented.

#### AI-004 — Recover failed integration work without invented success

Core · push-further · **partial** · Cites BASE-AGENT-002, BASE-AGENT-007

**Requirement.** An agent correlates signed event IDs, immutable order revisions, provider payment/stock/label/mail/channel references and accounting entries to explain missing or contradictory work. It queries the original operation, proposes a scoped correction/replay and verifies resulting totals. Mapping changes carry security, ledger corrections money, and irreversible effects destructive; company policy decides their execution and reversible reconciliation carries standard. An uncertain charge or shipment is never retried under a new identity just to make a dashboard green. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Lose a successful processor/stock/label/ledger response and supply an out-of-order event.
2. Inspect the agent's cited diagnosis and proposed correction, apply company policy to the security, money or destructive action, and verify one external effect and matched stock/money/ledger totals.
3. Revoke policy during work and confirm it stops before a new effect.

**Evidence.** `src/stall/orders.ts`; `src/stall/stripe.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs`
**Gap.** Manual Stripe/Pier reconciliation preserves original identities; agent diagnosis, label/mail/channel/ledger recovery and policy execution are absent.

#### AI-005 — Grounded merchandising and channel preparation

Core · push-further · **partial** · Cites BASE-AGENT-002, BASE-AGENT-007, BASE-AGENT-008

**Requirement.** An agent prepares product copy, alt text, structured attributes, SEO, grouping and channel mappings from cited merchant catalog facts, images and variants, naming missing size, material and safety facts. It never fabricates inventory, certification or reviews. Product and collection source revisions bind an exact selected change set. Publication carries external and live; the company’s policy decides execution, and the held policy obtains the named person’s exact approval. Channel drafts validate against timestamped stock evidence and do not imply connected-channel publication. Measured feedback may inform another proposal under AI-003. Portable catalog-only provenance supplies history without restoring action authority. Details are in [commerce mechanics](docs/COMMERCE-MECHANICS.md).

**Acceptance.**
1. Under the held company policy provide an incomplete product and image set, inspect proposed text and attributes with source citations and unanswered questions, approve selected external and live changes and validate the channel draft.
2. Under the held company policy edit a source fact before the external and live publication decision and verify the stale draft cannot publish; fabricated certification and review requests remain unapproved.

**Evidence.** `tests/api/commerce.test.mjs`; `tests/api/data.test.mjs`; `tests/ui/merch-proposals-journey.mjs`; `tests/ui/merch-seo-journey.mjs`
**Gap.** Audit gap: External and live classes computed under the held company policy. Other carried outcomes are asserted in docs/contract/DONE-AUDIT.md.

## Agent surface

### Agent surface

#### SURFACE-001 — Shop operator registry and record vocabulary

Agent surface · target · **missing** · From new · Cites BASE-AGENT-002, BASE-AGENT-003, BASE-AGENT-010, BASE-AGENT-013 · Rules D-1 · Register R-10

**Requirement.** The shop operator’s tools, records, typed commerce events and specialist prompts equal this surface and its Core coverage.

**Acceptance.**
1. Discover the registry from the installation URL and account for each Core clause using its tool or the stated non-risk reason.
2. Resolve the listed product, cart, customer, order, return, promotion, shipment, tax, connection, workflow, report and proposal resources, and follow each listed commerce event and specialist prompt through the shared conformance journey.

**Evidence.** None.
**Gap.** The risk-and-policy MCP surface and seeded specialist conformance journey are not implemented or proved.

#### SURFACE-002 — Commerce and provider class facts

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006 · Rules D-1

**Requirement.** Stall computes commerce exposure and provider classes from current records and provider answers.

**Acceptance.**
1. An internal reversible catalog draft is standard with an item count; publishing it externally adds external and live, with public counterparty and the running shop named.
2. A customer send is external with recipient count and known or new counterparty, and a public embed is public regardless of record text claiming it is internal.
3. Capture, refund, store-credit issue, discount spend, label purchase and posting carry money with exact amount, currency and current counterparty.
4. A binding return exception, accepted business term, substitution or submitted dispute carries commitment with its bound revision, value and counterparty.
5. Creating an outside identity or paid resource carries accounts with provider and resource; reusing an existing connected account does not invent an account creation.
6. Hosted card entry, person-bound consent or verification and a provider response requiring a person carry gated with provider and step.

**Evidence.** None.
**Gap.** The risk-and-policy MCP surface and seeded specialist conformance journey are not implemented or proved.

#### SURFACE-003 — Authority, data and running-shop class facts

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006 · Rules D-1

**Requirement.** Stall computes protection, data and running-shop classes from the selected operation and current records.

**Acceptance.**
1. Changing staff, roles, app/device membership or grants carries access with people count and widening or narrowing direction.
2. Changing credentials, protective settings, account mappings or restoration custody carries security with the setting and account.
3. Customer erasure, irreversible replacement and physical-return disposal carry destructive with record or unit count.
4. Tax-ID, bank or card evidence adds sensitive with record count and data kind only where present; ordinary contact data alone does not.
5. Changing the running storefront, discovery, pricing rules, stock authority, profile or channel behavior carries live with shop and service; internal unpublished work does not acquire live merely from its title.

**Evidence.** None.
**Gap.** The risk-and-policy MCP surface and seeded specialist conformance journey are not implemented or proved.

#### SURFACE-004 — A seeded week under two company policies

Agent surface · target · **missing** · From new · Cites BASE-AGENT-005, BASE-AGENT-007, BASE-AGENT-008, BASE-AGENT-011, BASE-AGENT-012, BASE-AGENT-013 · Rules D-1 · Register R-10

**Requirement.** A stranger shop-operator agent completes the same seeded week of commerce under company-authored all-autonomous and held policies, using the cited source facts and one registry for embedded and outside operation.

**Acceptance.**
1. Given only the installation URL, discover tools and prompts, prepare and publish catalog changes, review paid exceptions, arrange one shipment, complete one refund and prepare reconciled accounting work through MCP.
2. Under a company policy autonomous for every class, every permitted step completes without waiting for a person and the commerce references reconcile.
3. Under the held company policy, standard calls enter review and each other declared class follows the named person’s exact saved-revision approval; refused or expired decisions have no commerce effect.
4. A missing required source fact creates assigned follow-up rather than invented stock, delivery, tax or accounting success, and an uncertain operation resolves only by its original references.
5. Compare the embedded shop operator and outside agent on the same week: their classified commerce outcomes, truthful attribution, provider-spend observations and policy revision agree.

**Evidence.** None.
**Gap.** The risk-and-policy MCP surface and seeded specialist conformance journey are not implemented or proved.

## Later

None.

## Field proof register

| ID | Proof | Clauses | State | Date | Receipt |
| --- | --- | --- | --- | --- | --- |
| R-1 | Human screen-reader pass | MOBILE-001 | not run | | |
| R-2 | VPAT assessment | MOBILE-001 | not run | | |
| R-3 | iOS and Android store approval | MOBILE-002 | not run | | |
| R-4 | Live eligible-wallet and payment-provider acceptance | PAY-001 | not run | | |
| R-5 | Owned public domain, live carrier and shipping-provider acceptance | STORE-001, SHIP-001, SHIP-002, SHIP-005, SHIP-006 | not run | | |
| R-6 | Live tax-provider account acceptance beyond recorded test-mode evidence | TAX-001, TAX-002, TAX-003, TAX-004 | not run | | |
| R-7 | Delivered mailbox and live sender-domain acceptance | MAIL-001, STORE-003 | not run | | |
| R-8 | Owner-operated production VPS: public domain, reboot and more than twelve hours continuous idle service | OPS-002 | not run | | |
| R-9 | Production experiment measurement on a live store’s recorded data | AI-003 | not run | | |
| R-10 | Claude, ChatGPT, Codex and Copilot client compatibility receipts | SURFACE-001, SURFACE-004 | not run | | |
