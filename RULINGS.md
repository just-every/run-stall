# Stall contract rulings

Rulings shape requirements; they certify no implementation or provider acceptance. Historical native human doors do not prescribe agent dispositions, which the company policy controls.

### RL-1 — Free-shipping promotion custody

Date: 2026-10-22 · Ruled by: ct · Governs: PROMO-001

Approved policy: CT approved the free-shipping-code default on 22 October: owner/admin management; reserved/used allocations permanently consume caps; restored rules require fresh activation.

### RL-2 — Risk-review scope and fulfillment-only cancellation

Date: 2026-10-23 · Ruled by: ct · Governs: RISK-001

ct approved these review and cancellation semantics with riders on 23 October 2026: owner and administrator review only, one deduplicated in-app alert per order and signal set, and cancellation limited to fulfillment, with payment and Pier reservations left recorded for separate authorized handling.

### RL-3 — Internal note erasure and order fallback

Date: 2026-10-22 · Ruled by: ct · Governs: ORDER-008

CT approved this erasure boundary as landed on 22 October: erasing a customer also deletes the notes and tags on their orders; the audit keeps only that notes existed; notes are excluded from customer-facing exports.

### RL-4 — Native functional roles and refund limits

Date: 2026-10-23 · Ruled by: ct · Governs: ROLE-001

ct approved these defaults with riders on 23 October 2026: single-role grants managed only by the owner, a zero refund ceiling and another-person approval unless the owner changes them, refunds needing separate approval, customer custody through the independently verified native email, scoped apps issued only by the owner, and revocation or downgrade taking effect on the next request.

### RL-5 — Tax preview consent and restore custody

Date: 2026-10-25 · Ruled by: ct · Governs: TAX-001

The owner-only consent and restore boundary is approved with riders (ct 25 October 2026). Only the current native owner may explicitly consent to and request the current tax-preview data transfer. Consent identifies the connected Stripe Tax account and preview-only purpose; destination and ship-from street, city, state, ZIP and country data; line references, amounts, quantities and product tax codes; discounted shipping; and opaque preview and intent references used for calculation custody. It distinguishes what Stall retains from data sent to and handled by the provider. It grants no payment, tax-transaction commitment, registration, filing or legal-certification authority.

### RL-6 — Shipping profile reassignment and stock split

Date: 2026-10-22 · Ruled by: ct · Governs: SHIP-004

Bulk assignment (the Products grid and a catalog CSV with the headers `SKU,Shipping Profile`) shows every change and applies only the reviewed fingerprint; the catalog CSV is the acceptance's catalog-or-inventory CSV leg, as ct approved on 22 October.

### RL-7 — Verified customer invitation and consent riders

Date: 2026-10-23 · Ruled by: ct · Governs: CUSTOMER-001

CT’s 23 October invitation and identity rider applies: invitations are single-use and expire, and a usable customer account exists only after independent email verification.

### RL-8 — Current-choice privacy and suppression

Date: 2026-10-23 · Ruled by: ct · Governs: CUSTOMER-002

CT’s 23 October consent/privacy rider applies: marketing categories remain denied until the shopper explicitly chooses against the current policy; consent records the wording’s policy version and capture time, imports preserve suppression, and privacy requests require owner review.

### RL-9 — One-order verified guest reorder custody

Date: 2026-10-23 · Ruled by: ct · Governs: CUSTOMER-003

CT approved the owner-invited independently verified mailbox boundary on 23 October.

### RL-101 — API-001: Documented headless API and signed events

Date: 2026-10-28 · Ruled by: ct · Governs: API-001

Question: Must every authorized lifecycle event require a fresh owner delivery decision?

Adopted/proposed default: Owner-only app grants, independent customer custody and explicit owner consent per delivery/replay.

Outcome: **replace**. Authorize an exact scoped subscription and destination under current app-management authority, then deliver its matching minimal signed events according to that subscription and company policy; preserve independent customer authentication, revocation and durable event identities, and reconcile unknown effects before any replay.

Why: Shopify scoped apps use persistent tokens, background jobs and webhooks; manual owner consent for every event is not the headless-platform norm. Destination enablement remains explicit; safe automation does not eliminate current scope checks or transport qualification.

- [Source 1](https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes): App access tokens carry explicit scopes; changed granted scopes can be observed through app/scopes_update webhooks.
- [Source 2](https://shopify.dev/docs/apps/build/authentication-authorization): Shopify supports background/scheduled jobs and webhooks using access tokens that persist across interactive sessions.

Main evidence: `CONTRACT.md:307` at `9b39a4c87c13cb9bc9f8acadfdaa9e34a31af4d2`.

Placement: API-001 owns subscription authorization once; individual delivery decisions follow company policy rather than a preset manual gate.

Engineering/proof retained: Pinned DNS/TLS peer transport remains unbuilt and blocks unsafe egress. Additional RETURN lifecycle events and complete headless commerce remain required.

### RL-102 — CART-001: Persistent cart and guest or account checkout

Date: 2026-10-28 · Ruled by: ct · Governs: CART-001

Question: May a private guest cart transfer only through explicit independently verified mailbox custody?

Adopted/proposed default: HttpOnly guest capability, explicit same-mailbox claim, old capability retired and restored cart copied/reviewed anew.

Outcome: **adopt with rider**. Approve private guest-capability custody, explicit independently authenticated same-mailbox handoff, revocation of the old guest capability and fresh copied-cart review after restore; price, stock, address, questions and totals must be current before a new payment intent.

Why: Shopify offers guest/account shopping and independently verified customer accounts. No common norm is established by the reviewed sources for Stall’s exact cookie-transfer or restore-copy algorithm; explicit verified transfer is the safest way to avoid cart takeover. This does not waive the persistent-cart or checkout UI target.

- [Source 1](https://help.shopify.com/en/manual/customers/customer-accounts/upgrade/compare-features): Customers verify their email with a one-time code before accessing their account, order history and saved addresses.

Main evidence: `CONTRACT.md:87` at `9b39a4c87c13cb9bc9f8acadfdaa9e34a31af4d2`.

Placement: CART-001 owns cart capability/handoff/restore as one door rule.

Engineering/proof retained: Native screens, Canada, gift/store-credit redemption, provider tax, packing slips and provider address review remain owed.

### RL-103 — CUSTOMER-001: Customer directory, accounts and order history

Date: 2026-10-28 · Ruled by: ct · Governs: CUSTOMER-001

Question: Should each public account request require owner approval after the merchant has enabled customer accounts?

Adopted/proposed default: Necessary-account consent, owner approval before each invitation, seven-day identity/thirty-day request retention and verified balance custody.

Outcome: **replace**. After merchant enablement, admit customer self-service through independent mailbox verification without individual owner approval; retain explicit account-purpose disclosure, single-use invitations, private unverified requests with seven-day identity/thirty-day metadata expiry, and reviewed exact-cents financial balance changes under independently verified mailbox custody.

Why: Shopify customer accounts are self-service with one-time mailbox verification. Per-person owner admission is not the retail norm; it remains a temporary unimplemented-signup boundary rather than permanent policy. No common norm is established by the reviewed sources for seven/thirty days or opaque financial journal retention, so keep the minimized local periods and record the financial retention basis.

- [Source 1](https://help.shopify.com/en/manual/customers/customer-accounts/upgrade/compare-features): Customers verify their email with a one-time code before accessing their account, order history and saved addresses.

Main evidence: `CONTRACT.md:205` at `9b39a4c87c13cb9bc9f8acadfdaa9e34a31af4d2`.

Placement: CUSTOMER-001 owns intake and balance custody once; PROMO-002 cites balance identity rather than re-copy it.

Engineering/proof retained: Supported Base signup remains engineering work, not authorization to invent a fallback signup service. Retained financial history grants no checkout redemption/cash-out or new sign-in authority.

### RL-104 — CUSTOMER-002: Consent, preferences and customer privacy

Date: 2026-10-28 · Ruled by: ct · Governs: CUSTOMER-002

Question: May verified-session preference capture and visitor-selected region preserve the existing deny-until-choice privacy rider?

Adopted/proposed default: Verified native customer writes; explicit separate channels; visitor-selected region and current-policy categories denied initially.

Outcome: **adopt with rider**. Keep independently verified customer preference writes and explicit channel choices; visitor-selected region may tailor disclosures but must never weaken deny-until-current-choice or Global Privacy Control suppression, and imports/restores cannot override later withdrawal.

Why: Shopify separates marketing channels and supports regional cookie controls. No common norm makes a visitor’s declared region authoritative legal geolocation: use it conservatively and label it selected. Existing 23 October consent/privacy riders remain binding.

- [Source 1](https://help.shopify.com/en/manual/privacy-and-security/privacy/customer-privacy-settings/privacy-settings): Merchants configure region-aware cookie consent and persistent privacy preferences, plus separate email/SMS marketing settings.

Main evidence: `CONTRACT.md:209` at `9b39a4c87c13cb9bc9f8acadfdaa9e34a31af4d2`.

Placement: CUSTOMER-002’s existing consent point receives the selected-region condition once; receiving channels cite it.

Engineering/proof retained: Anonymous signup/checkout capture must still prove mailbox ownership rather than disappear from scope. Banners, delivered unsubscribe, provider propagation, geolocation and deletion execution remain owed.

### RL-105 — FLOW-001: Event and scheduled workflows with visible follow-up

Date: 2026-10-28 · Ruled by: ct · Governs: FLOW-001

Question: May scoped workflow preparation create follow-up without asserting shipment, stock or money effects?

Adopted/proposed default: Owner/admin-managed rules, current verified inputs, explicit shipment preparation and fresh activation after restore.

Outcome: **adopt with rider**. Approve current-scope, versioned, deduplicated workflow preparation and truthful assigned follow-up; recheck rule/assignee/function/order authority at effect time, and let company policy govern execution through the separately authorized commerce doors rather than prescribing human-only agent preparation.

Why: Shopify Flow starts work from real return requests and exposes actions through connected order/customer objects. Its model supports configured automation; the reviewed sources establish no common norm requiring a human click for every draft. A task or preparation is still not stock movement or accounting posting.

- [Source 1](https://help.shopify.com/en/manual/shopify-flow/reference/triggers/return-requested): A customer self-service return request triggers workflows with return and order/customer context.
- [Source 2](https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes): App access tokens carry explicit scopes; changed granted scopes can be observed through app/scopes_update webhooks.

Main evidence: `CONTRACT.md:311` at `9b39a4c87c13cb9bc9f8acadfdaa9e34a31af4d2`.

Placement: FLOW-001 owns the rule/version/idempotency point; cite API-001 for outbound authority and RETURN-001/002 for stock resolution.

Engineering/proof retained: Accounting credentials, safe arbitrary egress, physical return stock resolution and approved integration/budget effects remain owed.

### RL-106 — RETURN-001: Customer self-service returns, cancellations and exchanges

Date: 2026-10-28 · Ruled by: ct · Governs: RETURN-001

Question: May a bearer order link alone authorize return photos, automatic final refusal and indefinite exchange stock reservation?

Adopted/proposed default: Private order link authorizes requests/photos; out-of-policy lines auto-refuse; replacement stock remains reserved if goods never return.

Outcome: **replace**. Require independent customer mailbox verification before creating return/exchange requests or reading private photos; explain policy eligibility failures and provide a person-reviewed exception/dispute path, and give exchange reservations a disclosed deadline with explicit cancellation/expiry release and durable stock reconciliation.

Why: Shopify self-service returns verify the customer account, support policy-based staff approval/decline and process exchanges after receipt/inspection. Bearer-only sensitive photos, no exception path and indefinite reservations are not established norms. Preserve one-order isolation, exact quantities and separation of request, goods, money and commercial decisions.

- [Source 1](https://help.shopify.com/en/manual/fulfillment/managing-orders/returns/self-serve-returns/setup): Self-service return requests require customer sign-in with a one-time emailed verification code.
- [Source 2](https://help.shopify.com/en/manual/fulfillment/managing-orders/returns/processing-returns): Returned goods are received and inspected before processing/refund or exchange fulfillment.
- [Source 3](https://help.shopify.com/manual/orders/self-serve-returns): Merchants approve or decline requests against their returns policy.

Main evidence: `CONTRACT.md:195` at `9b39a4c87c13cb9bc9f8acadfdaa9e34a31af4d2`.

Placement: RETURN-001 owns request/photo identity and exception/reservation conditions as its own points; RETURN-002 cites reservation identity for resolution.

Engineering/proof retained: Implement step-up verification, exceptional review and reservation release without changing status or waiving RETURN-002 stock/financial recovery. A private link may remain a bounded order-status link.

### RL-107 — TAX-001: US sales tax and exemptions

Date: 2026-10-28 · Ruled by: ct · Governs: TAX-004, TAX-003

Question: May whole-order pro rata jurisdiction allocation and configured nexus metrics be represented as provider tax truth?

Adopted/proposed default: Allocate reversal over remaining original jurisdictions; zero-tax goodwill; full refund on address mismatch; minimal marketplace reporting and configured-period nexus.

Outcome: **replace**. Link every item/shipping reversal to its original provider line and allocate only across that line’s original evidenced jurisdictions; label any local allocation derived and keep unsupported amounts unallocated for filing review. Preserve zero-tax non-line goodwill, reviewed full-refund address remedies, separate marketplace evidence and fresh local authority, but apply nexus inclusion/period/net-sales rules from explicit jurisdiction configuration rather than universally counting all marketplace sales or gross amounts.

Why: Shopify reports line-related refunded tax and separates custom non-line refunds; nexus uses state-dependent included sales and periods. Stripe reversal objects identify original line items. Whole-order redistribution and universal marketplace inclusion are not a common lawful tax norm; conservative unknowns are safer than invented jurisdiction truth.

- [Source 1](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/default-reports/finances-report?itcat=pos-features&itterm=pos-features-help-center): Line refunds reverse associated line tax; custom non-line refunds leave tax unchanged and appear separately.
- [Source 2](https://docs.stripe.com/api/tax/transactions/object): Reversal line items identify the original line item and refunded tax amount.
- [Source 3](https://help.shopify.com/en/manual/taxes/us/us-tax-liability): Nexus insights use applicable threshold periods and net sales; marketplace sales count only where the relevant rule includes them.

Main evidence: `CONTRACT.md:113` at `9b39a4c87c13cb9bc9f8acadfdaa9e34a31af4d2`.

Placement: TAX-004 owns the derived-attribution points and TAX-003 owns the configured-nexus points; ORDER-003 and accounting consumers cite those parts.

Engineering/proof retained: Keep test-only mode, actual provider/detail gaps and live acceptance explicit. Configured warnings are management indicators, not legal certification; owner legal sign-off/registration/filing remain outside this product ruling.
