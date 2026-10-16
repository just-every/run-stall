# Stall target product contract

Target approved scope: **16 October 2026**. First buyer: a US small retailer or maker selling physical goods in **USD** through an owned branded online store.

Stall replaces the online-store job sold by **Shopify, Squarespace Commerce, BigCommerce and WooCommerce**: build and merchandise a store, attract and convert shoppers, take payment, deliver orders, support returns and account for the result. **Medusa, Saleor and Fourthwall** are additional switching/extension reference points. This is the product being built towards, not a description of the current release. No homepage, UI or running behavior changes are authorized by this document round.

The core records are stores/themes/pages, collections/products/variants/media, stock-provider mappings/holds, carts/quotes, customers/consent, promotions/gift balances, tax/delivery quotes, orders/payments, shipments/returns/exchanges/refunds, messages, channel listings, accounting postings and attributable work history. Every record has an explicit store, identity, revision/state and permission boundary appropriate to its job. Historical imports retain provenance and never become current payment or stock authority.

A single switching journey runs from migration and domain cutover through catalogue discovery, checkout, fulfilment, service, return and reconciled books. The clauses specify buyer behavior and the public-door evidence needed to call it complete. Provider test environments/network-edge fakes establish local logic only; live account, domain, carrier, wallet-device and hosted delivery acceptance must be recorded separately. Fixtures are test-only; production has no invented stock, orders, provider success or fallback service.

## Published clauses

## Runtime and store experience

- **HTTP-001 — Real installed and published HTTP surfaces.** The emitted Worker serves health, real assets, the installed Lobby, shop documents and genuine HTTP/document 404s. The independent marketing homepage, /run and /docs remain the Markdown-derived run site; its Run actions lead to /run. The RER operations contract in SEED-COMMAND-CONTRACT.md remains binding. Build and deploy never run tests.

  **Acceptance evidence:** Build and serve the emitted Worker; GET /health, /, /shop and built assets, then unknown document/API paths. Verify successful responses and real 404 status codes; build the run site and follow its public links.

- **STORE-001 — Merchant themes, page builder and custom domain.** A merchant chooses and edits a branded theme with logo, colors, typography, navigation, reusable sections and responsive page templates; previews an unpublished revision; publishes or rolls back it without losing catalogue or orders. The merchant connects an owned domain with verified DNS, TLS and canonical redirects. Editable theme source and assets remain owned and exportable.

  **Acceptance evidence:** In the merchant desk create a reusable hero/product section, preview on desktop and phone, publish to a verified test domain, then roll back. Follow HTTPS and www/canonical redirects and confirm existing product links and orders survive.

- **STORE-002 — Navigation, collections and product discovery.** Shoppers browse menus, manual or rule-based collections and category landing pages, search product names/SKUs/attributes, and filter/sort by price, availability, variant attributes and collection. Results, counts, empty states and shareable URLs agree with published, sellable catalogue data; unpublished products stay private.

  **Acceptance evidence:** Publish a varied catalogue, navigate collections, search and combine filters on desktop and phone. Change publication and stock, refresh the public results, and verify matching counts, saved URLs and a useful no-results state.

- **STORE-003 — Content, blog and search visibility.** Merchants manage content pages, blog posts, policies, menus, product/collection SEO titles and descriptions, image alt text, canonical URLs, sitemap, robots policy, social previews, structured product data and permanent redirects. Draft/scheduled content is previewable and changes retain publication history. Moving a product URL preserves discovery through redirects.

  **Acceptance evidence:** Create and schedule a blog post and policy page through the desk, publish a product with SEO metadata, fetch its rendered HTML/sitemap, and rename its slug. Verify old URLs redirect once and unpublished content is absent from public search and feeds.

- **MOBILE-001 — Accessible mobile shopping and merchant work.** The complete catalogue-to-receipt, account, return and merchant order workflows work at 390 and 1440 pixels with keyboard and screen-reader labels, visible focus, sufficient contrast and actionable errors. WCAG 2.2 AA is the target. Human-readable state and freshness distinguish unavailable data from zero stock or success; failed actions retain input and prevent duplicate submission.

  **Acceptance evidence:** Use the built storefront and desk at both widths to buy variants, recover a validation failure, read order status, request a return and process it. Complete the same essential controls by keyboard and inspect accessible names and focus after dialogs/errors.

- **MOBILE-002 — Native merchant apps and timely order attention.** iOS and Android merchant apps provide secure sign-in, order/customer lookup, product/photo edits, stock visibility, barcode-assisted picking, fulfilment, returns and approval notifications under the same role checks as the web desk. Offline drafts show stale data and reconcile conflicts before effects; device revocation removes authority and lock-screen notices avoid customer details.

  **Acceptance evidence:** On each platform receive a new-order notification, scan a purchased SKU, prepare fulfilment offline, change the order elsewhere, and reconnect. Verify the conflict requires fresh approval; revoke the device and confirm private reads and actions fail.

## Catalogue and stock

- **CATALOG-001 — Products, variants and media.** The desk maintains products, handles, SKUs, variant options/combinations, USD prices and compare-at prices, cost basis, taxable categories, categories/tags/attributes, collections, image galleries and video/alt text. Each variant has independent availability and shipping weight/dimensions. Draft, scheduled, published and archived states preserve historical purchased descriptions/prices and expose only approved current listings.

  **Acceptance evidence:** Create a product with size/color variants, multiple images, cost, weight and tax category; publish an approved revision. Buy one variant, change its current price and archive another; verify gallery/selection and immutable order snapshots through public product and order views.

- **CATALOG-002 — Bulk catalogue operations and portable files.** Merchants import, export and bulk-edit products/variants, collections, prices, publication, tax/stock settings, weight and dimensions. A dry run shows creations, changes, conflicts and rejected rows before an exact reviewed apply; jobs resume without duplicates and offer undo only where later native edits or orders will be preserved. Original source custody and row-level outcomes remain inspectable.

  **Acceptance evidence:** Upload a mixed valid/invalid catalogue file, inspect a read-only preview, apply the reviewed rows, resume an interrupted batch, export them and undo untouched changes. Edit/purchase an imported SKU first and verify undo reports the protected row rather than overwriting it.

- **STOCK-001 — Live availability through Pier or another stock system.** Stall displays variant-level sellable availability from multi-location stock and reserves against the selected location/fulfilment policy. Pier is an optional first-class adapter; a documented connector lets a merchant retain another stock system. Stall owns storefront merchandising and retail order experience; Pier owns the Cin7/inFlow-style inventory, purchasing and wholesale order system. Backorder/preorder rules, lead times, safety stock and stale-provider behavior are visible before purchase. Confirmed changes synchronize both ways without becoming a second warehouse ledger.

  **Acceptance evidence:** Connect Pier, publish variants across two locations, make an external stock change and verify public availability. Repeat via the documented alternate adapter; test backorder refusal/allowed lead time, stale stock and duplicate reservation events with matching stock-provider references.

- **STOCK-002 — Expiring checkout holds and stock race resolution.** Checkout rechecks availability and creates a bounded stock hold before payment commitment. Holds expire or release after abandonment, failed payment and cancellation; a verified payment converts the same hold into a reservation once. Late payment or shortfall remains an explicit exception with feasible fulfilment, shopper-approved substitution or reconciled cancellation/refund rather than silently overselling.

  **Acceptance evidence:** Two shoppers attempt the last unit through checkout. Expire one hold and fail another payment; verify releases. Deliver late/duplicate success and lose a reservation response; confirm one reservation or a visible paid-shortfall case resolved by the shopper-approved outcome.

## Cart, payment and commercial totals

- **CART-001 — Persistent cart and guest or account checkout.** Shoppers add/remove variants, change quantities, retain a cart across refresh/sign-in, and check out as guests or account holders. Native shopping/checkout steps collect US addresses, contact and selected delivery method and show reviewed USD item, discount, gift-card, shipping, tax and final payable totals before committing payment. Material changes require review again; stock, price and address errors preserve the basket. Saved carts never grant access to another customer.

  **Acceptance evidence:** Build a multi-variant cart, reload and sign in, choose a US address and delivery method, apply a discount/gift card and review exact totals. Change price or availability concurrently and verify a fresh review; repeat as a guest and as a different account.

- **PAY-001 — US dollar cards, wallets and PayPal.** The merchant connects their own Stripe and PayPal accounts. Checkout supports USD cards, Apple Pay, Google Pay and Link/Shop-style accelerated wallet checkout using supported provider adapters and eligibility checks. Eligible payment choices and unsupported devices are honestly presented; customer payment credentials stay with the processor and wallet. Refunds and receipts retain original method/currency references.

  **Acceptance evidence:** Complete USD purchases with a card, Apple Pay, Google Pay, Link and PayPal through their supported test/eligible-device doors; inspect provider IDs, amount/currency, failure/cancel paths and a same-method refund. A live provider/device acceptance run is required before claiming production wallet readiness.

- **PAY-002 — Authorization, capture, cancellation and disputes.** Merchants choose supported immediate capture or authorize-then-capture rules, see pending/authorized/captured/failed/expired/cancelled states, and reconcile asynchronous payments, voids, disputes, chargebacks and provider fees. No fulfilment occurs on an unverified browser return or mere authorization. Expired authorization and a disputed payment create accountable staff work; permitted captures/refunds bind current order and provider state.

  **Acceptance evidence:** Authorize an order without capture, attempt fulfilment, capture once, then process a failed/expired authorization, asynchronous success and dispute event. Duplicate/out-of-order callbacks must preserve actual processor state, correct balance and a visible owner action.

- **PAY-003 — Verified payment and duplicate-safe paid reservation.** A signed payment event must match its raw body, timestamp, event identity, original order/session, exact-cent amount and currency, and canonical processor state before an order is treated as paid. Repeated delivery and lost stock responses reconcile to the same paid order and Pier reservation. A paid shortfall remains recorded; a browser success page alone proves nothing. Changed reuse of an idempotency identity is refused.

  **Acceptance evidence:** Through public checkout and the signed webhook send unpaid, stale, wrongly signed, changed-total and duplicate events; lose the Pier response after its commit, then reconcile. Inspect one payment/order/reservation and durable paid-before-reservation history.

- **PROMO-001 — Discounts, automatic promotions and controlled budgets.** Merchants run code and automatic discounts on products, collections, shipping or the order, with date windows, eligibility, minimums, per-customer/total usage, stacking rules and budgets. Checkout explains applied/refused promotions, records the chosen rule revision and emits qualification/redemption/reversal events. Concurrent baskets cannot exceed a shared cap; refund/cancellation treatment is explicit.

  **Acceptance evidence:** Configure overlapping code/automatic campaigns, exercise eligibility and stacking, race the last redemption, cancel one order and partially refund another. Reconcile campaign usage, budget and exact order/tax totals from the merchant report and emitted events.

- **PROMO-002 — Gift cards and stored redemption balances.** Merchants sell or issue gift cards, deliver secure codes, inspect a balance ledger and redeem partially across orders alongside another method. Concurrent redemption, cancellation and refund preserve value exactly once; issuance, expiry restrictions and cash-out handling follow the configured US jurisdiction/policy and are explicit to the shopper. Exported balances and migrated cards reconcile without revealing full codes to unauthorized staff.

  **Acceptance evidence:** Issue a USD gift card, deliver and redeem it partly, race its remaining balance in two checkouts, and cancel/refund the winning order. Inspect the balance ledger, shopper receipt, staff permissions and reconciled migrated opening balance.

- **TAX-001 — US sales tax and exemptions.** Stripe Tax, Avalara AvaTax or TaxJar calculates US state/local sales tax using the merchant's configured registrations, ship-from/destination, product tax categories, exemption evidence and shipping/discount treatment. Checkout shows jurisdictional tax before payment; order records preserve the calculation reference and refunds reverse the correct tax. Provider outage or incomplete configuration blocks a taxed sale with a useful explanation, rather than inventing a zero rate. Tax reports and filing exports support the merchant/adviser.

  **Acceptance evidence:** Configure two US destinations, taxable/exempt goods, a documented exempt customer and discounted shipping. Check provider-backed totals before payment and a partial-return tax adjustment; interrupt the tax provider and verify checkout refuses an unpriced obligation and reports the cause.

- **RISK-001 — Fraud indicators and human review.** Processor fraud signals, address/payment mismatches and order risk appear in a restricted review queue with their provenance. Merchant-configured rules hold risky fulfilment and notify authorized staff; an explicit release/cancel decision records the reviewer. Scores are advisory and never silently assert fraud, capture funds or deny a refund without the configured authority.

  **Acceptance evidence:** Create low-risk and flagged provider test orders, inspect the restricted queue, attempt fulfilment while held and release/cancel with an authorized reviewer. Repeated risk callbacks must not duplicate holds or messages.

## Fulfilment, orders and returns

- **SHIP-001 — Shipping zones, live rates, pickup and delivery.** Merchants configure US shipping zones, service eligibility, free/flat/weight-based rules, handling cutoffs and delivery promises; checkout rates packages from current variant weight/dimensions through ShipStation, Shippo or EasyPost for USPS, UPS and FedEx. Shoppers choose eligible service, local pickup or local delivery with clear price and instructions; changed address/package invalidates stale quotes. Split-source orders show combined charges and feasible dates.

  **Acceptance evidence:** Quote different US ZIPs and package weights with live provider test rates, select pickup/local delivery, change address after selection and verify repricing. Refuse unsupported zones and show actionable carrier outages; the paid order must retain the selected service and quoted charge.

- **SHIP-002 — Purchase, print and void carrier labels.** Authorized staff buy and print outbound/return labels through ShipStation, Shippo or EasyPost using connected USPS, UPS and FedEx accounts/services, prepare manifests and packing slips, and void unused labels with reconciled charges. Label purchase binds the order, package, service and approved spend. An uncertain provider response is looked up by the same reference before another purchase; downloadable label data is access-controlled.

  **Acceptance evidence:** Buy and print a label for each supported carrier through a connected shipping provider, lose one successful response, reconcile it, then void an unused label and buy a return label. Verify one charge/label per operation, usable documents and restricted access.

- **SHIP-003 — Split fulfilment, tracking and delivery exceptions.** Staff allocate lines to locations/packages, partially fulfil or backorder the remainder, and record carrier/service/tracking per shipment. Provider scans drive shipped, in-transit, delivered, delayed, failed and lost states with timestamp/source; shoppers receive truthful tracking and delivery notices. Carrier delivery is attributed evidence, not a guarantee of physical receipt; shipment edits and duplicates preserve remaining quantities.

  **Acceptance evidence:** Split a two-line order across locations, dispatch one parcel, then the remainder; receive duplicate, out-of-order, delayed and delivered tracking callbacks. Verify each shopper view/email and remaining quantity, and open an exception when scans go stale.

- **ORDER-001 — Complete retail order desk.** The merchant desk searches and filters orders by status, customer, date, SKU, risk and channel, and keeps customer/contact/address, original line and total snapshots, payment/stock/fulfilment/return/refund states, notes, tags, assignment and provider references in one history. Staff create draft/manual retail orders, send payable links, and see overdue work without changing historical truth. Merchant-selected US time zones and USD formatting govern business displays.

  **Acceptance evidence:** Create a manual order and a storefront order, assign staff and notes, filter an overdue partial shipment, and open its full history. Change a catalogue price/customer address and verify historical commercial snapshots and original provider references remain.

- **ORDER-002 — Exact shipment approval and one dispatch.** A human owner/admin reviews an exact shipment draft against a paid, reserved order. Approval is durable before the Pier dispatch effect; stale drafts fail and lost responses reconcile to one dispatch with the original reservation, reference and quantities. Repeating a completed approval observes the same shipment. A stock-provider connection cannot silently redirect an existing order to another inventory account.

  **Acceptance evidence:** Prepare a shipment through the desk/command route, reject a stale revision, lose the approved dispatch response, reconcile and repeat approval. Inspect one Pier shipment, released reservation and matching stock ledger quantities.

- **ORDER-003 — Reviewed line refunds without duplicate money movement.** A human approves the exact revision, purchased lines, reason and computed refund amount. Pending and completed refunds count against refundable quantities/value. Approval persists before provider submission, uncertain responses reconcile using the same provider/idempotency references, and repeat approval cannot pay twice. A money refund alone does not assert returned stock or restock an item.

  **Acceptance evidence:** Refund one line of a shipped two-line order, lose the processor response, reconcile and repeat approval. Reject a stale or duplicate/over-value refund and inspect one processor refund, unchanged retained line and no stock return.

- **ORDER-004 — Versioned edits, cancellation and claims.** Authorized staff edit eligible unfulfilled lines, addresses and delivery methods under a version check, with recalculated tax/shipping and explicit shopper agreement for changed goods or charges. Cancellation voids or refunds payment, releases reservations and reports carrier/stock work still pending. Damage, non-delivery and other claims retain evidence, owner, decision and linked replacement/refund without overwriting the original order.

  **Acceptance evidence:** Race two edits on an unfulfilled order, obtain shopper approval of a changed total, cancel before and after capture, and resolve a lost-parcel claim. Verify stale edits fail and each capture/void/refund/stock release and customer notice reconciles once.

- **RETURN-001 — Customer self-service returns, cancellations and exchanges.** An authenticated account or secure guest order link shows order/shipment/refund history and accepts cancellation, return and exchange requests by eligible line/quantity/reason. Merchant policy explains windows, condition, final-sale exceptions, fees, return shipping and available exchange stock. Staff receive review tasks and shoppers see acceptance/refusal and progress; disputed or exceptional decisions require a person. Another shopper cannot access the request or its attachments.

  **Acceptance evidence:** As guest and account customers request a cancellation, partial return and size exchange; test expired/final-sale items and another customer's link. Verify staff notification, an explained decision, exchange reservation and customer-visible progress without duplicate requests.

- **RETURN-002 — Physical receipt, restocking and reconciled resolution.** Return cases connect authorization, provider return label, tracking, staff inspection/condition, accepted quantities, restock/quarantine/disposal in Pier or the stock adapter, tax/shipping/fee adjustments and the reconciled refund/store credit or exchange shipment. Stock is added only after recorded physical receipt/inspection; money and stock can complete separately but unresolved work stays visible. Duplicate receipt/refund callbacks cannot increase either balance twice.

  **Acceptance evidence:** Return one damaged and one resellable unit, purchase/track a label, record staff inspection, quarantine one and restock the other, then refund or exchange. Lose stock/refund responses and reconcile to one receipt, one financial resolution and a closed customer-visible case.

## Customers, follow-up and channels

- **CUSTOMER-001 — Customer directory, accounts and order history.** Merchants manage deduplicated customer profiles, addresses, tags/segments, notes and order lifetime value under permissions. Customers can securely register/sign in, recover access, manage their addresses and see only their own imported and new orders, tracking, returns, gift balances and refund status. Guest-to-account linking requires verified ownership; historical migration never grants access just because names match.

  **Acceptance evidence:** Import two similar customer records, resolve a duplicate, place guest/account orders and link only after verified email ownership. Sign in as each customer, recover access and attempt foreign order/address/return reads and writes through direct APIs.

- **CUSTOMER-002 — Consent, preferences and customer privacy.** Shoppers control email/SMS marketing consent separately from necessary order notices, with timestamp, source, channel and withdrawal history. Import preserves provable consent and leaves unknown consent unsubscribed. Account export/deletion and owner erasure requests expose retained financial records and provider follow-up; suppression propagates to connected marketing systems and survives restore. Sensitive customer data is limited by staff role.

  **Acceptance evidence:** Import subscribed/unsubscribed/unknown contacts, change preferences at checkout/account, unsubscribe through a delivered message and inspect downstream suppression. Request access/erasure and restore an older archive with the later journal; verify no marketing reactivation or foreign customer access.

- **MAIL-001 — Transactional confirmations and delivery evidence.** Configurable branded email through SendGrid or the owner-selected Base mail adapter delivers order/payment confirmation, pickup instructions, shipment/tracking, delivery, cancellation, return/exchange and refund notices. Notices derive from committed order transitions and include accurate totals/status and secure links. Durable message IDs, provider acknowledgement, delivery/bounce/complaint outcomes and failed-work tasks distinguish submitted from delivered; marketing suppression does not silently suppress necessary service mail.

  **Acceptance evidence:** Buy, split-ship, deliver, return and refund an order through public doors; inspect the corresponding provider messages and safe order links. Repeat callbacks, inject a bounce and lose a send response; verify deduplication, visible uncertainty and staff follow-up without falsely claiming inbox receipt.

- **RECOVERY-001 — Abandoned-checkout recovery to a valid basket.** Merchants configure consent-aware recovery timing, templates, frequency caps and incentives. An eligible abandoned checkout receives a secure expiring cart link; returning shoppers get current prices, stock, tax and delivery options with changes explained. Payment, unsubscribe, erasure or merchant pause cancels pending recovery; duplicate jobs do not resend. Reports attribute recovered orders and costs without counting unrelated purchases.

  **Acceptance evidence:** Abandon guest/account checkouts, advance the configured schedule, receive one recovery message and return through its link after price/stock changes. Buy, unsubscribe and erase before later steps; verify suppression, expiry, renewed review and accurate recovered-order attribution.

- **MARKET-001 — Mango and consent-aware lifecycle marketing connections.** Stall connects catalogue, customer consent/segments, order, checkout and refund events to sibling [Mango](https://github.com/just-every/run-mango), and supports Klaviyo and Mailchimp email/SMS stacks. Mapping previews, scoped authorization, backfill, suppression and delivery outcomes are inspectable. Mango owns cross-campaign marketing work; Stall owns commerce eligibility, checkout recovery and order truth. No sale or external contact list silently creates marketing consent.

  **Acceptance evidence:** Authorize Mango and each supported marketing adapter, preview a segment/event backfill, place and refund an order and withdraw consent. Inspect matching event identities and suppressed contact state downstream; revoke the connector and verify pending sends stop and failures remain actionable.

- **CHANNEL-001 — Google Shopping, Meta/Instagram and TikTok Shop.** Merchants publish approved product/variant media, USD price, availability and shipping/tax attributes to Google Merchant Center/Shopping, Meta/Instagram Shops and TikTok Shop, with per-channel mapping, validation and rejection repair. Where a channel accepts orders, channel orders, cancellations, fulfilment, returns and refunds synchronize to the same retail order and stock reservations. Feed-only surfaces state that limit explicitly; remote and direct sales cannot both spend the last unit unnoticed.

  **Acceptance evidence:** Connect each named channel, publish a variant, inspect a rejection and correct it, then change price/stock. In each supported order sandbox import an order and duplicate event, ship/refund it and verify remote status, one reservation and channel-attributed analytics; test revoked channel access.

- **CHANNEL-002 — Marketplace adapters without becoming a marketplace.** Optional Webgility-compatible Amazon, eBay and Walmart integrations map listings/SKUs, orders, fees, fulfilment and returns into the same commerce/accounting records. Conflicts, provider limits, channel-specific policy and stale inventory are explicit. Stall remains the merchant's online-store product and does not operate a buyer/seller marketplace.

  **Acceptance evidence:** Connect each selected marketplace through Webgility or its supported adapter, backfill and replay an order/refund, change stock and reconcile fees. Show one retail order/stock effect and matching ledger entries, with a visible unresolved mapping case.

- **REVIEWS-001 — Verified reviews, upsells and cross-sells.** Merchants collect verified-purchase reviews natively or through Yotpo, moderate abuse with a visible policy, and merchandise related products, bundles, upsells and cross-sells against current price/stock. Requests obey consent/contact rules and review imports preserve provenance. Paid incentives or AI-generated text cannot masquerade as a verified customer review.

  **Acceptance evidence:** Fulfil an order, send a permitted review request via the configured Yotpo/native door, moderate a reported review and show purchase provenance. Add a recommended bundle to cart, exhaust one component and verify the offer updates without overselling.

## Reporting, accounting and migration

- **ANALYTICS-001 — Sales, conversion and contribution margin.** Merchants inspect date/channel/product/variant/customer reports for visits, product views, add-to-cart, checkout, payment conversion, gross/net sales, discounts, tax, shipping collected/cost, fees, refunds, gift liability and contribution margin using recorded cost data. Funnels disclose consent-limited/unknown traffic, bot exclusions, attribution window and historical import provenance. Reports drill to orders and export; cancelled, test, imported and duplicate events never inflate new conversion.

  **Acceptance evidence:** Follow a known visitor-to-refund journey, import historical sales, replay events and compare channel/date totals with orders and processor/accounting references. Remove cost/analytics consent and verify unknowns are labeled rather than fabricated margin or visits.

- **ACCOUNT-001 — Reconciled QuickBooks Online and NetSuite posting.** QuickBooks Online maps customers, products, sales receipts/invoices, taxes, shipping, discounts, gift-card liability, refunds, processor fees and payouts to the merchant's reviewed accounts. Exportable sales/order/payment CSVs support accountants; NetSuite posting is available through Webgility or a documented ERP adapter. Sync exposes pending/posted/rejected/uncertain states, original remote IDs and a reconciliation report; a changed mapping or duplicate event never silently double-posts revenue.

  **Acceptance evidence:** Preview account/tax mappings, post a sale, gift redemption, partial refund, fee and payout to QuickBooks Online and the selected NetSuite adapter sandbox. Replay, lose a response and correct an account rejection; reconcile net sales, tax liability and cash to provider and exported records.

- **MIGRATE-001 — Full reviewed Shopify migration.** A Shopify switching merchant previews and imports products/variants/media/collections, customers/addresses/consent, historical orders/lines/payments/refunds/fulfilments and URL redirects with source IDs, count/value reconciliation and explicit unsupported/conflict rows. Gift balances, discounts and content are transferred or individually reconciled. Incremental cutover catches changes before DNS switch. Historical financial/stock events are read-only provenance and never re-charge, reserve stock, send recovery mail or pretend to prove new conversion. Current reviewed product import/undo guarantees are retained.

  **Acceptance evidence:** Use Shopify exports and authorized API data for a representative store; dry-run counts/values and redirects, apply/resume, reconcile customers/orders/refunds/balances, then import the cutover delta. Open old links and customer history; verify no external money/stock/mail effects and undo preserves later native work.

- **MIGRATE-002 — Squarespace Commerce migration.** A Squarespace Commerce merchant migrates products/variants/images, customers/profiles and consent evidence, historical orders/fulfilment/refunds, content and URL redirects through available exports and authorized APIs. The migration preview names source omissions and offers reviewed supplemental mappings for content, balances or records absent from a native export. Counts, USD totals and old URLs reconcile before cutover; source passwords/payment secrets do not transfer.

  **Acceptance evidence:** Import a representative Squarespace store via its available export/API doors, supplement missing source fields in the preview and reconcile variant/customer/order/refund counts and values. Cut over old URLs, verify history and customer reactivation, and prove imports cause no payment, stock or email side effects.

- **MIGRATE-003 — BigCommerce migration.** A BigCommerce merchant migrates catalogue/options/variants/media/categories, customer/address/consent data, orders/transactions/refunds/shipments, coupons/gift liabilities and redirects using reviewed export/API mappings. App-owned fields and unsupported objects are listed for explicit mapping. Original IDs and USD totals reconcile and a cutover delta preserves later work without importing source authority or replaying commerce effects.

  **Acceptance evidence:** Preview and apply a BigCommerce export/API migration containing variant options, partial shipment/refund, a gift liability and redirects; reconcile source counts and totals, rerun the delta and verify no duplicate objects, stock reservations, charges or notices.

- **MIGRATE-004 — WooCommerce and extension migration.** A WooCommerce merchant migrates products/variations/media/categories, customers/consent and order/refund/fulfilment history using CSV and authenticated REST exports; maps permalinks to redirects; and gets a per-extension inventory of discounts, gift cards, subscriptions, reviews and custom fields. Unsupported extension data has a reviewed adapter/supplement path and explicit cutover work rather than disappearing. Secrets, password hashes and stored payment credentials are excluded.

  **Acceptance evidence:** Import a WooCommerce store with variable products, a refunded order and representative extension/custom fields. Inspect omissions/mappings before apply, reconcile source values and URL redirects, then repeat the delta and customer activation without replaying historic sales.

- **MIGRATE-005 — Open-engine and creator-store move-in.** Medusa, Saleor and Fourthwall merchants can map their authorized export/API data into the same reviewed migration process for available products/variants, customers, orders, fulfilment/refunds, content and redirects. The preview inventories provider-owned production, memberships and subscription records, lists inaccessible data and supports reviewed supplements/partner handoff. No adapter invents source consent, passwords, processor authority or missing fulfilment evidence.

  **Acceptance evidence:** For each named source preview an authorized export/API sample and source-field coverage, apply and resume its mapped catalogue/customer/order history, reconcile totals/redirects and explicitly resolve unavailable creator-production/subscription records before cutover.

- **MIGRATE-006 — Cutover completeness, source limitations and outstanding liabilities.** Every migration maps source store/entity IDs, paginates to completion, groups multi-row products/orders correctly and distinguishes stock-bearing variants from modifiers. Media is copied into owned storage before retiring source URLs. A coverage report lists export/API omissions, inaccessible fields, custom/extension data and unresolved records; nothing is silently discarded or labeled fully migrated while unresolved. Product/collection/content redirects reject loops and collisions. Customer access requires reactivation/reset, not imported passwords. Issued gift balances reconcile as liabilities with secure carryover/reissue and duplicate-redemption prevention. Subscription schedules and processor authority require provider-approved transfer or renewed authorization before billing; historic orders never authorize new charges. A resumable cutover delta and rollback preserve native changes and prevent duplicate source IDs.

  **Acceptance evidence:** For each source in MIGRATE-001/002/003/004/005 import continuation rows, variants/modifiers, guest orders, unknown consent, a partially refunded order and a gift liability; interrupt pagination and resume. Retire a source image URL and follow old product/content URLs. Inspect count/value/omission reports, resolve collisions, activate a customer and verify no password, new charge, renewal, stock or message side effect comes from historical data.

- **EXPORT-001 — Business CSVs and complete merchant exit.** Authorized merchants export products/variants/media references, customers with consent, orders/line details, payment/refund history, shipments/returns, gift liabilities, discounts, redirects, reports and integration reconciliation in documented CSV/JSON formats plus the complete archive. Exports explain schema, currency/time zones and exclusions, never silently truncate, and let a new operator account for outstanding work. Exporting customer data requires an explicit role; credentials never travel.

  **Acceptance evidence:** Export a populated shop through the desk/API and open its product/customer/order/payment CSVs and complete archive in an independent reader. Reconcile records and exact totals, verify explicit bounds/exclusions and refuse an unauthorized export.

## Roles, integrations and dependable operations

- **ROLE-001 — Staff and app least privilege.** Owners invite/revoke staff with distinct catalogue, fulfilment, customer-support, marketing, finance and administrator permissions, plus customer self-access and scoped app credentials. Server-side checks guard every private read, mutation, bulk job and export; role changes/revocation invalidate stale authority. Refund limits and approval separation are configurable, and staff never acquire provider credentials from the UI.

  **Acceptance evidence:** Invite each role, perform its permitted workflow and try foreign customer, finance, bulk/export and direct API actions. Downgrade/revoke an active session/app grant during a prepared job and verify the next effect is refused without leaking private records.

- **AGENT-001 — Human approval of exact agent drafts.** The human owner grants and revokes scoped, expiring agent access. An agent may prepare product, shipment and refund drafts; a signed-in human owner/admin approves their exact revision before publication, dispatch or money movement. Revocation, expired grants and stale revisions fail through the direct transport. Agents cannot approve themselves, grant authority, export/restore private data or erase a customer.

  **Acceptance evidence:** Grant an agent credential, prepare a product draft, attempt its approval/export/erasure as the agent and reject each, approve as a human, then revoke the grant and retry direct reads/writes. Prepare shipping/refund drafts through the same policy and require exact human approval.

- **API-001 — Documented headless API and signed events.** An owner can build a custom/headless storefront using versioned catalogue/cart/checkout/customer/order APIs and scoped integration credentials. Signed order/customer/stock/promotion/return events have stable IDs, minimal payloads, delivery history, subscription filtering and replay controls. Inbound signatures, origin checks, rate limits and idempotency prevent event or request reuse from creating duplicate commerce. Extensions and provider adapters do not require sharing administrative sessions.

  **Acceptance evidence:** Use a documented external storefront client to buy and view its own order, subscribe to signed events and reject a tampered delivery. Replay and reorder callbacks, revoke its credential and verify one commercial effect and bounded access.

- **FLOW-001 — Event and scheduled workflows with visible follow-up.** Merchants configure order, customer, stock, promotion and scheduled triggers with conditions, quiet hours, responsible staff and due dates. Actions create tasks, notify staff, invoke approved integrations or prepare drafts under role/budget limits. Return/cancellation requests notify staff; confirmed returns drive stock work and sales drive accounting. Dry runs explain matching records; loops, duplicates and uncertain external effects stay visible and can be paused or reconciled.

  **Acceptance evidence:** Configure low-stock, overdue fulfilment, return-request and scheduled reconciliation rules; dry-run and activate them, replay events and stop a rule with pending work. Inspect one task/effect per event and correct owner/due date, not a silent failed background job.

- **INTEGRATION-001 — Owned connections and recoverable external work.** Owners connect, test, rotate and revoke provider accounts, preview data mappings and see which data crosses each boundary. Secrets remain installation-local and encrypted under managed secret custody; connected apps have least privilege. Every outgoing payment, stock, label, mail, channel and ledger job has durable intent, provider correlation, attempts and a terminal or uncertain outcome. Recovery queries the original operation before retry; backoff applies only to proven retryable work, and no automatic replay can duplicate an uncertain charge, shipment or message.

  **Acceptance evidence:** Revoke/rotate an account during queued work, lose successful responses at each provider edge and restart the worker. Inspect pending/uncertain work, reconcile by original reference, and prove no new effect identity or secret appears in UI, logs, exports or restored authority.

- **SECURITY-001 — Guarded native commerce doors.** The shop's native sessions guard desk, import and data endpoints on the server. Public catalogue/checkout and signed provider events are explicit external doors; browser mutations require the configured origin. A member, anonymous caller or revoked agent cannot gain private commerce access, approval or owner-only data authority by calling transport directly. Inputs are bounded and secrets/card details never belong in client bundles.

  **Acceptance evidence:** Call private state, product commands, imports and exports anonymously/as a member; attempt cross-origin browser mutation and an agent approval; revoke the grant and repeat. All fail without the prohibited write or private response, while public catalogue and valid checkout remain usable.

- **DATA-001 — Validated archive and inactive receiving authority.** Browser and RER CLI archives preserve the complete supported product data, commercial/approval/provider history, import source custody and erasure journal. Validation of version/schema/integrity and semantics precedes atomic restore into empty product data; the receiving owner, sessions and provider configuration remain local. Source agent tokens, sessions and connection secrets never become destination authority, and restore never repeats a charge, shipment, refund or message. Tampering and nonempty destinations fail without partial publication.

  **Acceptance evidence:** Export a populated shop with imports and commerce history, restore through the public portability doors into an empty installation and reconcile records. Attempt changed bytes and a second restore, then try source session/grant credentials at the destination; verify refusal and no provider replay.

- **ERASURE-001 — Owner-directed contact erasure and backup fencing.** The human owner confirms customer contact erasure after resolving unshipped orders and uncertain shipment/refund effects. The authorized transaction removes email, address and checkout request fingerprint, invalidates outstanding archive copies and writes the portability redaction fence and audit action while retaining anonymous commercial history. A later source journal makes restore reject a pre-erasure backup. Provider-held records and already downloaded/offline copies need separate owner action; an isolated old archive cannot know about later erasure.

  **Acceptance evidence:** Attempt erasure before shipment and with wrong confirmation, then resolve work and erase. Inspect retained totals/approvals with no contact/address/fingerprint; restore a post-erasure archive and refuse an old archive when supplied the later journal, with no partially restored rows.

- **AUDIT-001 — Durable attributable commercial action history.** Current product prepare/approve, shipment, refund, reconciliation, agent-grant/revoke and customer-erasure actions retain actor or agent-grant identity, opaque subject, action and time alongside immutable approval/provider references. History survives customer contact erasure and product archive transfer. The UI may page history but must not imply its display window deletes records or makes the store's audit tamper-evident.

  **Acceptance evidence:** Run a purchase, human approvals, reconciliation, agent grant/revoke and erasure through public commands, read activity and export/restore the shop. Verify relevant actor/action/time and approval/provider references remain without restoring erased customer contact.

- **OPS-001 — Owned installation, recovery and explicit operating limits.** The merchant can install, set up, run, build, verify, export/import, diagnose and deploy the shop through Base's pinned RER command path while retaining owner data/settings. Health, provider readiness, background-job backlog, durable failed/uncertain outcomes and storage limits are visible. Backups and restore drills include outstanding work; costs separate hosting/storage, processors, tax, carrier, channel and AI usage. No author licence check or kill switch controls ordinary shop operation; optional providers are named dependencies, not hidden telemetry.

  **Acceptance evidence:** Follow the fresh-clone RER journey, retain owner/data/settings across reruns, export/restore, stop/restart and diagnose an unavailable required provider. Inspect health and outstanding jobs, bounded storage/cost declarations and outside requests; no claim of capacity, zero egress or hosted readiness is inferred from a local build.

- **BASE-001 — Preserved Base guarantees with scoped replacements.** Base authentication, input safety, portability, erasure, audit and independent ownership remain obligations. Current hosted Stripe card custody replaces local card handling; Pier owns physical stock/dispatch; plain-text descriptions replace arbitrary product HTML. Current archives exclude installation authority rather than cloning it and the receiving owner reconnects providers. These are limited product policies, not blanket exemptions: theme/content/media, customer accounts and new integrations must add sanitization, authorized uploads, scoped egress, credential exclusion and erasure coverage before their clauses can be complete.

  **Acceptance evidence:** Use native direct-door authorization tests and archive/erasure journeys, submit hostile product/import text and unsupported input, and inspect export/client bytes for authority. When rich content/media/providers are added, exercise their public upload/render/connect/erase doors under the same guarantees and document any explicit replacement with evidence.

## Push further: agents operate the commerce job

- **AI-001 — Operate order exceptions to shopper-approved closure.** An agent joins live payment/authorization, hold/reservation, location availability, warehouse, carrier scans and promised delivery data to detect oversells, stalled fulfilment or delays. It explains the actual order state to the verified shopper with source timestamps, prepares feasible substitute goods or delivery choices and tracks acceptance through fulfilment or cancellation/refund. Merchant approval binds substitution, spend and money decisions; the shopper explicitly agrees to changed goods/date/price. Unavailable evidence creates a staff task, never an invented delivery promise.

  **Acceptance evidence:** Create a paid stock shortfall and a carrier delay. Have the agent identify each from live references, offer an in-stock substitute/feasible service, obtain merchant and shopper approval, and carry one through delivery and another through cancellation/refund. Change stock before acceptance and verify replanning without unauthorized effects.

- **AI-002 — Manage returns end to end.** An agent applies the merchant's versioned return policy to order, delivery and customer-supplied condition evidence, gathers missing facts, prepares eligibility/fee/exchange options and provider labels, and follows scans to staff inspection, accepted restock/quarantine, refund and accounting reconciliation. Staff confirm physical receipt/condition and disputed eligibility; a human approves money movement and replacement shipment against current state. The agent closes a case only when stock and financial/provider references agree and the shopper is informed.

  **Acceptance evidence:** Ask for a return in the authenticated customer experience, let the agent prepare policy-grounded options and a label, record a human inspection that changes one item's condition, then approve resolution. Lose a restock/refund response and confirm the agent reconciles both once and leaves a refused/disputed case with an assigned human.

- **AI-003 — Improve profitable conversion with measured experiments.** An agent reads consented funnel/channel reports, variant cost, stock/lead time, shipping/payment fees, return rates and promotion outcomes to propose merchandising, bundle, placement or content experiments with contribution-margin forecasts. It cites the data/window and missing costs, proposes a small budget and rollback, and measures actual net margin and conversion after refunds. The merchant approves publication, prices, audience and discount spend; preapproved stop rules halt a losing experiment without silently raising spend.

  **Acceptance evidence:** With real measured store data configure an experiment, inspect the agent's source-backed proposal and unknowns, approve a bounded change, then observe conversion lift with margin erosion/returns. Verify stop/rollback, stock feasibility and an honest inconclusive result where sample or cost evidence is inadequate.

- **AI-004 — Recover failed integration work without invented success.** An agent correlates signed event IDs, immutable order revisions, provider payment/stock/label/mail/channel references and accounting entries to explain missing or contradictory work. It queries the original operation, proposes a scoped correction/replay and verifies resulting totals. Owners approve mappings, material ledger corrections and any irreversible effect; already-approved safe reconciliation can run within a revocable policy. An uncertain charge or shipment is never retried under a new identity just to make a dashboard green.

  **Acceptance evidence:** Lose a successful processor/stock/label/ledger response and supply an out-of-order event. Inspect the agent's cited diagnosis and proposed correction, approve the material action, and verify one external effect and matched stock/money/ledger totals. Revoke policy during work and confirm it stops before a new effect.

- **AI-005 — Grounded merchandising and channel preparation.** An agent proposes product copy, alt text, structured attributes, SEO, collection grouping and channel mappings from approved merchant facts, images and variant data. It flags unsupported claims and missing size/material/safety information, previews changes and feed validation, and never fabricates inventory, certifications or customer reviews. Merchant approval publishes the exact revision; measured conversion/margin feedback can inform the next proposal without granting autonomous publication.

  **Acceptance evidence:** Provide an incomplete product and image set, inspect proposed text/attributes with source citations and unanswered questions, approve selected changes and validate the channel draft. Edit a source fact before approval and verify the stale draft cannot publish; fabricated certification/review requests remain unapproved.

## Product separation and specialist extensions

- **BOUNDARY-001 — Separate products with usable commerce connections.** Stall remains a complete storefront/retail commerce product. [Pier](https://github.com/just-every/run-pier) owns multi-location warehouse inventory, purchasing and wholesale operations; Stall consumes availability and submits reservations, dispatches and accepted returns. [Mango](https://github.com/just-every/run-mango) owns the broader marketing product. A merchant may use other stock/marketing systems through documented adapters; neither sibling is required to edit pages, manage customers or operate Stall's commerce record. Shared code never merges their products.

  **Acceptance evidence:** Operate the storefront/order desk with a documented alternate stock/marketing adapter, then connect Pier/Mango and inspect the handoffs. Verify warehouse purchasing/wholesale work and cross-campaign marketing open the linked product while retail orders and recovery remain manageable in Stall.

- **EXTEND-001 — Subscriptions, POS and creator fulfilment partners.** Optional specialist adapters cover recurring product subscriptions via Stripe Billing or a subscription provider, physical POS via Square/Stripe Terminal, and creator production/print-on-demand via Fourthwall or Printful/Printify where their supported interfaces permit. The shopper sees renewal/fulfilment/cancellation terms and the merchant sees linked orders, refunds and stock/accounting effects. Required partner apps, agreements, payment-device/native work and unsupported source objects are explicit delivery work; partner ownership never excuses a broken commerce handoff.

  **Acceptance evidence:** Connect the selected subscription, POS and production provider test accounts; renew/cancel a subscription, complete/refund a POS sale and track a made-to-order product. Reconcile linked retail orders, tax, stock and payouts, and surface provider rejection without claiming fulfilment.

- **EXPAND-001 — Multiple stores, regions and currencies.** A merchant can operate separate branded storefronts/channels with regional price lists, languages, currencies, domains, tax/delivery settings and staff access while retaining an explicit source for each order. USD/US is the first supported buying journey; later regions use configured providers and jurisdiction rules rather than silently reusing US defaults. Exchange/refund amounts retain original currency and reported conversion basis.

  **Acceptance evidence:** Create a second storefront with a different catalogue/price list, locale and currency; buy, partially refund and report in each. Verify domain/catalogue/role isolation, original-currency reconciliation and refusal of a region lacking configured tax or delivery support.

- **B2B-001 — Business buying without absorbing wholesale operations.** Business customers can use approved company accounts, tax-exemption evidence, contract price lists, quote requests, purchase-order references and approved net terms in the storefront. Pier or the merchant's wholesale/order-credit system owns wholesale fulfilment, procurement and credit policy; Stall presents linked quote/approval/payment status and does not grant terms itself. Accounting and tax mappings reconcile the accepted business order.

  **Acceptance evidence:** Approve a company buyer, submit a quoted basket/PO, receive authorized pricing/terms from Pier or a wholesale adapter and accept it in the store. Reject an unauthorized employee or expired exemption; reconcile the approved order, shipment and QuickBooks invoice without a second wholesale ledger.

## Honest boundaries

- **Money and tax infrastructure:** Stripe/PayPal and wallets hold payment credentials and move funds; Stall owns checkout, permissions and reconciliation (PAY-001/002/003). Tax calculation connects Stripe Tax, Avalara or TaxJar (TAX-001); merchant registration, legal nexus decisions and tax filing remain with the merchant, adviser or contracted filing partner. Those are provider handoffs, not reasons to omit calculated checkout tax or refund adjustments.
- **Physical operations:** USPS/UPS/FedEx and shipping providers supply rates, labels and tracking (SHIP-001/002/003). Staff or fulfilment partners confirm physical receipt and condition (RETURN-002). A database status alone is not proof of delivery, returned goods or safe merchandise.
- **Neighbouring products:** Inventory/warehouse purchasing and wholesale operations remain in Pier; cross-campaign marketing remains in Mango (BOUNDARY-001). Accounting books live in QuickBooks Online/NetSuite (ACCOUNT-001). Stall still completes its own customer-facing order, return and recovery workflows and exposes failures across those connections.
- **Specialist breadth:** Recurring billing, physical POS and creator production use the usable adapters in EXTEND-001; business buying and international/multiple storefront expansion have explicit B2B-001 and EXPAND-001 requirements. Provider apps, agreements, native/device work and partner API limitations are engineering work with visible acceptance, never grounds to fold or shrink Stall.
- **Ownership and capacity:** Large media lives in owner-controlled object storage with bounded processing jobs, not an unbounded Worker request; uploaded content must have authorized access, safe rendering, portability and erasure (BASE-001). Hosting/load/cost, email inbox receipt, live wallet eligibility and carrier delivery are measured separately. No scale, compliance certification or guaranteed conversion claim follows from a local test.

## Migration mapping references

The target adapters must verify the merchant-specific source version, permissions and extraction coverage. Official references informing that work are [Shopify product CSV](https://help.shopify.com/en/manual/products/import-export/using-csv) and [order exports](https://help.shopify.com/en/manual/fulfillment/managing-orders/exporting-orders), [Squarespace products](https://support.squarespace.com/hc/en-us/articles/360000694948-Exporting-products-to-a-csv) and [orders](https://support.squarespace.com/hc/en-us/articles/206540677-Export-Commerce-orders), [BigCommerce management APIs](https://docs.bigcommerce.com/developer/api-reference/about-our-apis) and [customers/subscribers](https://docs.bigcommerce.com/developer/docs/admin/customers/customers-and-subscribers), [WooCommerce REST](https://woocommerce.github.io/woocommerce-rest-api-docs/), [Medusa Admin](https://docs.medusajs.com/api/admin), [Saleor GraphQL](https://docs.saleor.io/api-reference/) and [Fourthwall commerce APIs](https://docs.fourthwall.com/llms.txt). Export formats can omit data that another authorized API or reviewed supplement must recover; those references establish source surfaces, not completed Stall adapters (MIGRATE-006).

## Implementation status

Judged against current `main` **7eadb4b8faebf02302be95217ca8c2807fe5d986**, the same commit as the supplied 16 October code audit. Application code has not changed since that audit. The audit's repeated vendor observations are consolidated into buyer clauses below; a broader clause stays partial even if one underlying inventory row was done. In particular, Pier's existing multi-bin paid reservation is not expiring checkout holds or configurable locations; the responsive narrow shop is not the complete mobile/account/return experience. Status is static code/test evidence, not a claim every cited test was freshly run in this writing round.

`done` means the stated current slice has implementation and a relevant checked-in public journey/test. `partial` means cited code implements only part or the full public journey remains unproven. `missing` means no implementation of the named promise was found. Target/provider acceptance remains required by ACCEPTANCE.md. New product data must extend archive, security, audit and erasure coverage; current done slices do not automatically prove future records. Existing seed metadata describes the current release and does not limit this target.

**64 clauses: 8 done, 29 partial, 27 missing.**

| Clause | Status | Evidence path and remaining work |
| --- | --- | --- |
| HTTP-001 | done | `src/server.ts`; `src/base/static-assets.ts`; `tests/runtime.mjs`; `tests/ui/journey.mjs` Existing runtime and run-site journeys cover these doors; hosted performance is unmeasured. |
| STORE-001 | partial | `src/stall/ui/shop.tsx`; `src/stall/ui/primitives.tsx` A fixed branded storefront exists; theme selection, visual building, domain management and theme revision controls are absent. |
| STORE-002 | missing | No implementation found. Target journey not implemented. |
| STORE-003 | missing | No implementation found. Target journey not implemented. |
| MOBILE-001 | partial | `src/stall/ui/shop.tsx`; `src/stall/ui/app.tsx`; `tests/ui/journey.mjs` The existing narrow shop/desk journey covers both widths; expanded flows and full accessibility conformance are unimplemented or unverified. |
| MOBILE-002 | missing | No implementation found. Target journey not implemented. |
| CATALOG-001 | partial | `src/stall/products.ts`; `src/stall/model.ts`; `tests/api/commerce.test.mjs` SKU/name/description/exact-cent price and reviewed publication exist; variants, media, attributes, cost and shipping fields do not. |
| CATALOG-002 | partial | `src/stall/imports/service.ts`; `src/stall/imports/targets.ts`; `tests/api/imports.test.mjs` Reviewed, journaled, reversible six-column Shopify product CSV import exists; broad schemas, bulk editing and product CSV export are absent. |
| STOCK-001 | partial | `src/stall/pier.ts`; `src/stall/payments.ts`; `tests/api/commerce.test.mjs` Pier bin availability and paid-order reservations exist; Pier is currently mandatory and configurable location/backorder policy and alternate adapters are absent. |
| STOCK-002 | partial | `src/stall/checkout.ts`; `src/stall/payments.ts`; `src/stall/orders.ts`; `tests/api/commerce.test.mjs` Checks before checkout and post-payment reservation/reconciliation exist; prepayment holds, expiry and shopper shortfall resolution do not. |
| CART-001 | partial | `src/stall/ui/shop.tsx`; `src/stall/checkout.ts`; `src/stall/stripe.ts`; `tests/api/commerce.test.mjs` A transient basket, reviewed product total and email guest handoff exist; persistence/accounts/native address and delivery steps are absent, and hosted addresses are AU-only. |
| PAY-001 | partial | `src/stall/stripe.ts`; `src/stall/refunds.ts`; `tests/api/commerce.test.mjs` Stripe card Checkout/refunds exist in AUD; named wallets, PayPal and USD/US acceptance are unimplemented or untested. |
| PAY-002 | partial | `src/stall/stripe.ts`; `src/stall/payments.ts`; `src/stall/orders.ts` Canonical paid-session retrieval exists; distinct authorization/capture, void, dispute and fee lifecycle handling is absent. |
| PAY-003 | done | `src/stall/checkout.ts`; `src/stall/payments.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs` The current AUD Stripe/Pier flow proves this invariant; it does not establish the broader USD/multiple-provider requirements. |
| PROMO-001 | missing | No implementation found. Target journey not implemented. |
| PROMO-002 | missing | No implementation found. Target journey not implemented. |
| TAX-001 | missing | No implementation found. Target journey not implemented. |
| RISK-001 | missing | No implementation found. Target journey not implemented. |
| SHIP-001 | missing | No implementation found. Target journey not implemented. |
| SHIP-002 | missing | No implementation found. Target journey not implemented. |
| SHIP-003 | partial | `src/stall/fulfilment.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs` One approved whole-order Pier shipment/reference exists; splits, carrier tracking and delivery messaging are absent. |
| ORDER-001 | partial | `src/stall/model.ts`; `src/stall/orders.ts`; `src/stall/ui/orders.tsx`; `src/stall/ui/presentation.tsx` Payment/reservation/shipment/refund records and a one-page desk exist; broader search, notes, manual orders and US time-zone behavior are absent; current times use Australia/Perth. |
| ORDER-002 | done | `src/stall/fulfilment.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs` Proven for current whole-order Pier shipments; carrier and partial-fulfilment breadth remains SHIP-002/003. |
| ORDER-003 | done | `src/stall/refunds.ts`; `src/stall/orders.ts`; `tests/api/commerce.test.mjs` The AUD shipped-line partial-refund flow is covered; pre-shipment cancellation, tax/shipping adjustments and return receipt remain separate target work. |
| ORDER-004 | partial | `src/stall/store.ts`; `src/stall/fulfilment.ts`; `src/stall/refunds.ts` Revision checks exist for current drafts/effects; general edits, cancellation and claims are absent. |
| RETURN-001 | missing | No implementation found. Target journey not implemented. |
| RETURN-002 | partial | `src/stall/refunds.ts`; `tests/api/commerce.test.mjs` Reconciled line refunds deliberately avoid restocking; return authorization, labels, inspection and restock workflow are absent. |
| CUSTOMER-001 | partial | `src/stall/model.ts`; `src/stall/store.ts`; `tests/api/data.test.mjs` Orders retain buyer contact/address and commercial history; customer profiles, shopper authentication and self-service history are absent. |
| CUSTOMER-002 | partial | `src/stall/erasure.ts`; `src/stall/portability-policy.mjs`; `tests/api/data.test.mjs` Owner-directed contact erasure and later-journal fencing exist; consent/preferences, account requests and marketing propagation are absent. |
| MAIL-001 | missing | No implementation found. Shared sign-in mail infrastructure does not implement order/customer transactional notifications. |
| RECOVERY-001 | missing | No implementation found. Target journey not implemented. |
| MARKET-001 | missing | No implementation found. Target journey not implemented. |
| CHANNEL-001 | missing | No implementation found. Target journey not implemented. |
| CHANNEL-002 | missing | No implementation found. Target journey not implemented. |
| REVIEWS-001 | missing | No implementation found. Target journey not implemented. |
| ANALYTICS-001 | missing | No implementation found. Target journey not implemented. |
| ACCOUNT-001 | missing | No implementation found. Target journey not implemented. |
| MIGRATE-001 | partial | `src/stall/imports/csv.ts`; `src/stall/imports/service.ts`; `tests/api/imports.test.mjs` Only a bounded six-column product CSV stages simple unpublished products; full Shopify objects, media, variants, customers, orders and redirects are absent. |
| MIGRATE-002 | missing | No implementation found. Target journey not implemented. |
| MIGRATE-003 | missing | No implementation found. Target journey not implemented. |
| MIGRATE-004 | missing | No implementation found. Target journey not implemented. |
| MIGRATE-005 | missing | No implementation found. Target journey not implemented. |
| MIGRATE-006 | partial | `src/stall/imports/service.ts`; `src/stall/imports/targets.ts`; `tests/api/imports.test.mjs` Current product import binds reviewed source/native snapshots and protects undo; complete cross-platform cutover, media, redirects, customer activation and outstanding liability handling are absent. |
| EXPORT-001 | partial | `src/stall/tools.ts`; `src/stall/portability-policy.mjs`; `tests/api/data.test.mjs` Complete supported commercial archives exist; business CSVs and new target-object exports are absent. |
| ROLE-001 | partial | `src/stall/access.ts`; `src/stall/model.ts`; `src/stall/api.ts`; `tests/api/commerce.test.mjs`; `tests/api/data.test.mjs` Native owner/admin/member roles and revocation exist; functional staff scopes, refund limits and customer/app roles are absent. |
| AGENT-001 | partial | `src/stall/api.ts`; `src/stall/products.ts`; `src/stall/fulfilment.ts`; `src/stall/refunds.ts`; `tests/api/commerce.test.mjs`; `tests/api/data.test.mjs` All three preparation commands and human-only approval guards exist; checked-in agent journey directly exercises product drafting, not agent shipment/refund preparation end to end. |
| API-001 | partial | `src/stall/api.ts`; `src/stall/payments.ts`; `src/stall/tools.ts`; `tests/api/commerce.test.mjs` Current JSON commerce doors and incoming Stripe signatures exist; versioned customer/cart APIs, external app scopes and outgoing event subscriptions are absent. |
| FLOW-001 | partial | `src/stall/payments.ts`; `src/stall/orders.ts` A fixed paid-event reservation transition exists; configurable rules, timers, tasks and notifications are absent. |
| INTEGRATION-001 | partial | `src/stall/orders.ts`; `src/stall/stripe.ts`; `src/stall/pier.ts`; `src/stall/portability-policy.mjs`; `tests/api/commerce.test.mjs` Stripe/Pier deterministic effects and manual reconciliation exist; generalized connection controls, secret custody and durable jobs for all target providers are absent or unverified. |
| SECURITY-001 | done | `src/stall/access.ts`; `src/stall/api.ts`; `src/stall/tools.ts`; `tests/api/commerce.test.mjs`; `tests/api/imports.test.mjs`; `tests/api/data.test.mjs` This is the existing native-role security slice, not proof of future customer/app roles or a complete security assessment. |
| DATA-001 | done | `src/stall/tools.ts`; `src/stall/portability-policy.mjs`; `tests/api/data.test.mjs` The current supported data/archive slice is covered; new target records must join its schema and inactive-restore policy before those clauses can be done. |
| ERASURE-001 | done | `src/stall/erasure.ts`; `src/stall/portability-policy.mjs`; `tests/api/data.test.mjs` Current customer-contact erasure is covered; broader account/consent deletion remains CUSTOMER-002. |
| AUDIT-001 | done | `src/stall/access.ts`; `src/stall/api.ts`; `src/stall/store.ts`; `tests/api/commerce.test.mjs`; `tests/api/data.test.mjs` Current actions write st_audit and commercial history; the desk exposes its latest 200 rows. A cryptographic/tamper-evident audit is not claimed. |
| OPS-001 | partial | `SEED-COMMAND-CONTRACT.md`; `scripts/operations-config.mjs`; `tests/clone-journey.mjs`; `tests/runtime.mjs` The RER command path and local clone/runtime journeys exist; operating costs/capacity and generalized background/provider health are unmeasured or absent. |
| BASE-001 | partial | `src/stall/imports/description.ts`; `src/stall/imports/csv.ts`; `src/stall/portability-policy.mjs`; `tests/api/imports.test.mjs`; `tests/api/data.test.mjs` Current plain-text/import and archive policies are inspectable; future rich content/media safety and a full Base conformance assessment are not established. |
| AI-001 | partial | `src/stall/payments.ts`; `src/stall/orders.ts`; `tests/api/commerce.test.mjs` Paid/shortfall states and manual lost-response recovery exist; detection agent, grounded shopper replies, options and closure workflow are absent. |
| AI-002 | partial | `src/stall/refunds.ts`; `tests/api/commerce.test.mjs` Revision-approved reconciled refunds are a foundation; policy reasoning, labels, return receipt, restock and agent follow-through are absent. |
| AI-003 | missing | No implementation found. Target journey not implemented. |
| AI-004 | partial | `src/stall/orders.ts`; `src/stall/stripe.ts`; `src/stall/pier.ts`; `tests/api/commerce.test.mjs` Manual Stripe/Pier reconciliation preserves original identities; agent diagnosis, label/mail/channel/ledger recovery and policy execution are absent. |
| AI-005 | missing | No implementation found. Target journey not implemented. |
| BOUNDARY-001 | partial | `src/stall/pier.ts`; `src/stall/api.ts` Pier is a separate product adapter today, but mandatory; Mango and alternative-provider handoffs are absent. |
| EXTEND-001 | missing | No implementation found. Target journey not implemented. |
| EXPAND-001 | missing | No implementation found. Target journey not implemented. |
| B2B-001 | missing | No implementation found. Target journey not implemented. |
