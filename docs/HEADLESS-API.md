# Stall headless API v1

The installation serves `/api/stall/v1`. This API uses a scoped integration principal; an integration credential grants no owner session, staff records, exports, provider credentials, fulfillment commands, refunds or arbitrary backend commands. Native private Stall and Stripe webhook doors retain their existing authentication.

API-001 remains PARTIAL. Owner-only app issuance and explicit audited endpoint consent are conservative defaults awaiting ct approval. The promotion event producer remains required future work; registering that filter does not create simulated production events. RETURN-001 inherits complete return lifecycle events when its states ship. Public DNS checks described below do not pin the connection's resolved address: DNS rebinding protection at the actual egress connection remains an open requirement. This document does not reduce those obligations.

## Credentials and customer identity

An owner opens the native installation and creates an app with its native session:

```http
POST /api/stall/v1/admin/apps
Origin: https://stall.example.com
Content-Type: application/json

{"label":"Custom storefront","origin":"https://shop.example.com","scopes":["catalog:read","cart:write","checkout:write","customer:read","orders:read"],"expiresInDays":30}
```

The response returns `id`, `token`, `expiresAt`, `origin`, and `scopes`. Save the token securely on the storefront's server: this is its only reveal. Stall stores only its SHA-256 digest. The expiry range is 1–90 days. A new credential replaces a revoked one; no administrative cookie is shared with the integration. Limit issuance to the scopes needed. The exact origin has no path or trailing slash. Production origins require HTTPS; local development permits only literal loopback HTTP origins.

Every external request supplies `Authorization: Bearer <token>` and the exact configured `Origin`. Missing or different origins fail, including on GETs. The credential's owner must remain active, retain owner role and retain the same authority version on every request and at guarded state changes. Revocation takes effect on the next request. App tokens cannot authenticate native owner administration.

Customer, cart, checkout and order routes ALSO require an independently authenticated native operator cookie. A customer signs in through Stall's existing verified native sign-in; an admitted member without staff permissions can use only its own customer doors. The integration token alone cannot buy as a customer or read any customer/order data. Neither `customerEmail`, an operator ID, a query email nor an order ID supplied by the integration authorizes a read. Stall derives the customer and checkout email exclusively from the current native session, binds carts to customer plus app, and binds each checkout order to that same identity before commerce creates it. It never matches historical orders by an unverified email claim.

For browser requests, use same-site HTTPS origins such as `shop.example.com` and `stall.example.com`, complete sign-in at Stall, then use `credentials: 'include'`. Native cookies remain HttpOnly and SameSite=Lax. A cross-site storefront needs a deployment/authentication arrangement that can convey an independent native customer session; an app token does not bypass browser cookie restrictions. Keep the app token on a server; a frontend backend can forward the authenticated customer's native request, but must never substitute the app owner's cookie.

Allowed CORS origins are exact, with credentials allowed and no wildcard. Preflight checks live app/issuer authority. The actual request additionally checks its bearer credential, route scope and customer identity. This is not an invitation or public account creation API; the owner admits customer members through native account management.

## Doors

All JSON responses are non-cacheable. Errors have `{ "error": { "code": "...", "message": "..." } }`. A missing or revoked integration/customer authentication returns 401; missing scope/origin/owner rights return 403; foreign carts/orders return 404; stale revisions, changed checkout fingerprints and concurrent authority changes return 409. Rate limits return 429 and reset at the next minute.

| Method and path after `/api/stall/v1` | Scope | Input and result |
| --- | --- | --- |
| `GET /catalog` | `catalog:read` | Published catalog, current stock observation and checkout readiness. No customer cookie required. |
| `GET /customer` | `customer:read` | Current customer's opaque `id` and its verified native `email`. |
| `POST /carts` | `cart:write` | `{lines:[{sku,quantity,personalization?}]}`; returns `id,revision,lines,createdAt,locked`. Requires `Idempotency-Key`. |
| `GET /carts/:id` | `cart:write` | Current customer's cart in this app. |
| `PUT /carts/:id` | `cart:write` | `{revision,lines}`; compare-and-swap update. A stale revision fails. A prepared checkout locks the cart. |
| `POST /carts/:id/quote` | `cart:write` | `{postalCode?}`; current basket shipping options and quote fingerprints. |
| `POST /checkout/confirm` | `checkout:write` | `{orderId}`; confirms only this customer/app's checkout through the existing verified payment reconciliation. Repeating does not create another effect. |
| `POST /checkout` | `checkout:write` | `{cartId,expectedTotalCents?,shipping?}`; returns `orderId,url,status`. Requires `Idempotency-Key`. |
| `GET /orders?after=...` | `orders:read` | Own app orders, up to 50; `{orders,next}`. Pass the returned opaque `next` as `after`. |
| `GET /orders/:id` | `orders:read` | Own app order status, dates, exact-cent totals, retail line fields, successful refund totals and shipped tracking. |

Order readers use an explicit field allowlist. They never return staff notes/tags, assignment history, internal references, payment intent/session IDs, provider credentials, request digests or checkout keys. Erased orders are unavailable. An integration cannot read another app's orders even for the same customer.

Cart creation and checkout require a fresh random UUID v4 in `Idempotency-Key`. Retain the same key and exact input when a response is lost. Reusing a key for a different customer, operation or input fails. One checkout locks one cart; another key cannot create a second checkout for it. Start a new cart for changed lines. Current published prices, stock, personalization and shipping validation are shared with native checkout. Shipping uses Stall's existing selection object (`service`, postal code and quote as required by the current shipping configuration); obtain the applicable quote from `POST /carts/:id/quote`.

Checkout delegates to the existing `checkout(env,p)` and its durable payment/stock effect ledgers. An app never supplies a provider URL, a payment amount to settle, or a stock command. Signed Stripe callbacks and normal reconciliation retain their existing verified signatures and duplicate/reordered-event controls. Repeating a headless checkout recovers the same commercial operation; it does not authorize a new Stripe or Pier effect. A checkout response may be pending or require reconciliation if a provider response was lost. Retain the same key rather than inventing a new operation.

An external server can use the following sequence after its customer independently signs in. `customerCookie` must be that customer's native request cookie, never an integration owner's administrative session:

```js
const base = 'https://stall.example.com/api/stall/v1';
async function call(path, { method = 'GET', body, key } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${integrationToken}`,
      Origin: 'https://shop.example.com',
      Cookie: customerCookie,
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error.code);
  return result;
}
const person = await call('/customer');
const cartKey = crypto.randomUUID(); // persist before sending
const cart = await call('/carts', {
  method: 'POST', key: cartKey,
  body: { lines: [{ sku: 'MUG-BLUE', quantity: 1 }] },
});
const checkoutKey = crypto.randomUUID(); // persist before sending
const payment = await call('/checkout', {
  method: 'POST', key: checkoutKey,
  body: { cartId: cart.id, expectedTotalCents: 2450 },
});
// Redirect the customer to payment.url. After verified payment confirmation:
const ownOrder = await call(`/orders/${encodeURIComponent(payment.orderId)}`);
```

There are limits of 120 authenticated requests per app per minute, 20 checkout requests per app/customer per minute, 120 owner administration requests per minute, 30 owner delivery attempts per minute, and 300 inbound requests per trusted platform IP per minute. Counters are durable and atomic. Input JSON is bounded to 100,000 bytes. Cart selection retains native limits (1–50 distinct lines, quantities 1–1,000). Credentials are capped at 50 unrevoked apps and 10 unrevoked subscriptions per app.

## Owner administration and event consent

These doors require the owner's current native cookie. Every mutation additionally requires the installation's exact native Origin; bearer credentials are refused. All app issuance/revocation, subscription consent/revocation, and send/replay releases are audited by opaque subject ID. Read lists never return token digests or encrypted signing material.

| Method and path | Behavior |
| --- | --- |
| `GET /admin/apps` | Lists labels, origin, scope JSON, issuer, expiry and revocation state. |
| `POST /admin/apps` | Issues a credential as above. |
| `POST /admin/apps/:id/revoke` | Immediately revokes the integration. |
| `GET /admin/subscriptions` | Lists endpoint, kind-filter JSON and consent/revocation state. |
| `POST /admin/subscriptions` | Consents to an endpoint and kind filter; one-time signing-secret reveal. |
| `POST /admin/subscriptions/:id/revoke` | Stops future sends and replays for this subscription. |
| `GET /admin/deliveries` | Durable attempt history; optional `subscriptionId`, `eventId`, `status`, `kind`, `before` cursor. Returns up to 100 with `next`. |
| `POST /admin/deliveries/:id/send` | Explicitly releases an unattempted pending delivery. |
| `POST /admin/deliveries/:id/replay` | Explicitly creates another attempt for the same frozen event and event ID. |

Example subscription input:

```json
{
  "appId": "<issued app ID>",
  "endpoint": "https://events.merchant.com/stall",
  "kinds": ["order", "customer"],
  "consent": "Send minimal Stall event identifiers to this endpoint"
}
```

The consent string must match exactly. The response contains `id`, `signingSecret`, `endpoint`, `kinds`, and `consentAt`. Save the secret at the receiver when it is revealed; it is never listed again. Stall encrypts signing material with AES-GCM under an installation-derived key and excludes it from archives. Rotating the installation session secret makes old signing material unusable; revoke and recreate those subscriptions.

Supported filters are `order`, `customer`, `stock`, `promotion`, `return`. Real order insertion/revision changes and native headless customer creation durably produce events in the same database transaction. IDs are stable for each event; replay preserves the ID and frozen body. Stock events describe changed current Pier availability observed by a versioned catalog read or the minute scheduler while a live stock subscription exists. Repeated unchanged snapshots emit nothing. Return events currently represent independently authenticated native return requests, without asserting returned stock or a refund; RETURN-001 inherits its later lifecycle events. Promotion events await PROMO-001 native records and remain an open API-001 obligation. Subscriptions receive future matching events only; there is no implicit historical backfill. Delivery order is not guaranteed.

The entire transmitted JSON has exactly `id`, `kind`, `resourceId`, `occurredAt`. Resource IDs are opaque references. No notes, tags, contacts, names, titles, addresses, line contents, monetary amounts or staff identities are transmitted. Receiving an opaque event reference does not grant an API read. The integration must use a separately authorized customer door to obtain that customer's order.

No outbound request occurs merely because a subscription or commerce event exists. An owner explicitly sends a pending delivery or explicitly replays an attempt. Its original endpoint consent and app/issuer authority are checked again immediately before release. Revocation never revives an old pending event. Each attempt transitions from `pending` to `sending` before the external call and ends `delivered`, `rejected`, or `uncertain`. A worker stopped during the call can leave `sending`; treat that as an uncertain external effect. There is no automatic retry. An explicit replay creates a separate durable attempt with `replayOf`, preserving the same event ID and body; receiver deduplication is mandatory even after a failed response.

Endpoints require a public DNS-named HTTPS URL on port 443, without user-info or fragments. IP literals and special-use/private/local hostnames are refused. Before every send/replay, Stall queries public DNS over HTTPS for A and AAAA and refuses every private, loopback, link-local, translation, transition or special-use address it recognizes, as well as nonpublic CNAMEs and unresolved/error responses. Requests have a 10-second timeout and redirects are never followed. DNS lookups have a 5-second timeout. DNS resolution checks are not a connection-level egress fence: a change between verification and fetch can rebind the destination. A DNS-pinned public-address transport remains required before claiming complete SSRF protection.

## Verify signatures and deduplicate

Every delivery uses `Stall-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>` with `Stall-Event-Id` and `Stall-Delivery-Id` correlation headers. Sign the UTF-8 bytes of `<timestamp>.<exact raw request body>` with the signing secret's UTF-8 text, not hex-decoded bytes. A replay has the same event ID/body, a new delivery ID and a current signature timestamp.

A Node receiver verifies before parsing or processing:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
function verify(rawBody, header, secret) {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header ?? '');
  if (!match || Math.abs(Date.now() / 1000 - Number(match[1])) > 300)
    throw new Error('Expired or invalid signature');
  const expected = createHmac('sha256', secret)
    .update(match[1] + '.').update(rawBody).digest();
  if (!timingSafeEqual(expected, Buffer.from(match[2], 'hex')))
    throw new Error('Tampered delivery');
  const event = JSON.parse(rawBody.toString('utf8'));
  if (!event.id || !event.resourceId || !event.kind) throw new Error('Invalid event');
  return event;
}
```

Read the original body bytes; parsing and reserializing changes signed content. Verify timestamps within five minutes and compare MACs in constant time. Reject any body/header event-ID mismatch. Persist the verified `event.id` in a unique processed-events table in the same transaction as the receiver's work; return success for an already-processed ID. Do not use delivery IDs or arrival order for business deduplication. Tampering, duplicate deliveries and reordered callbacks must not create duplicate commerce. External events are notices: they never grant authority to invoke arbitrary backend effects.

App credentials, encrypted signing material and endpoint consent are installation-local and excluded from portable archives. Customer/cart/order and event/delivery history travel with the commerce records. The archive replaces native customer links with inert restored IDs, replaces checkout request keys/fingerprints with inert per-record markers, and transfers no app grant or endpoint. Restores require fresh grants, consent and independently authenticated customer custody. Owner JSON includes non-secret customer/cart and event/delivery history. Restored customer contact remains attributable for erasure without restoring a native login link. Customer erasure must remove headless identity/cart/request/order bindings along with native commerce contact removal; opaque minimal event notices contain no contacts to redact.
