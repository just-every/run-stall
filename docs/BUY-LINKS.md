# Buy Buttons and checkout links

Use the native owner or administrator session to generate links through the
same-origin HTTP door. Generated scripts contain a public embed identifier and
Stall's origin, without a credential. The script requests only published product
names, variant SKUs, USD prices and stock availability. It reads no browser
storage, installs no pixel and sends no customer details to the external site.

From a signed-in Stall page, this request creates a shareable checkout link:

```js
const response = await fetch('/api/stall/buy-links', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    label: 'Two linen sizes',
    lines: [{ sku: 'TEE-S', quantity: 2 }, { sku: 'TEE-M', quantity: 1 }],
    promotionCode: 'MAKER-SHIPPING'
  })
})
const link = await response.json()
```

Share `link.url`. Opening it previews current published prices and the selected
quantities. Continuing explicitly creates a separate native cart; it does not
replace an existing basket or start payment. The customer supplies their email
and delivery address, answers the current checkout questions and reviews the
exact total before entering Stripe. A discount is a code to evaluate at review,
not a promise of eligibility. Enabled address-level tax requires the existing
explicit shopper disclosure and a fresh quote for that address and selection.
Unpublished variants, insufficient stock, expired promotions and changed prices
retain the native checkout refusals. No analytics or marketing consent is
inferred from opening a link.

To generate an embed, use the same request with one of these objects:

```json
{
  "kind": "buy_button",
  "label": "Small linen tee",
  "lines": [{ "sku": "TEE-S", "quantity": 2 }],
  "allowedOrigins": ["https://blog.example.test"]
}
```

```json
{
  "kind": "product_card",
  "label": "Linen tee sizes",
  "productSku": "TEE",
  "allowedOrigins": ["https://blog.example.test"]
}
```

```json
{
  "kind": "collection",
  "label": "Maker gifts",
  "collection": "gifts",
  "allowedOrigins": ["https://blog.example.test"]
}
```

Copy the returned `embed` script element into the external page. Each embed has
its own list of one to 20 exact HTTPS origins: scheme, host and any nondefault
port. Subdomains, wildcard hosts, paths and lookalike suffixes receive no data
unless separately allowed. A disallowed site sees an unavailable message and
no purchase control. The external host must permit the script and its request
to Stall in its own content policy.

Product cards show the published variants of one product; collection widgets
use the shop's current published collection rules across all current members. The quantity control identifies each variant by its displayed
name. Refresh availability reloads current prices and stock. A sold-out variant
has no enabled purchase control. Unpublishing removes it from the next fetch;
even an old rendered control cannot pass native cart creation for an unavailable
variant. Products with required personalization still require the native
personalization flow; an embed cannot bypass that requirement.

Every widget opens a native cart in Stall. The normal checkout retains its
shipping selection, required fields, tax consent, reviewed total and payment
verification. Widget orders record `buy_button`; standalone checkout links
record `checkout_link`. The Orders Channel filter and the documented order
search door accept those values; commercial exports retain them. These are
order attribution values for ANALYTICS-001 to consume, not new pixel events.

`GET /api/stall/buy-links` lists the latest 100 configurations for the native
owner or administrator, with the full count and an explicit truncation flag. To revoke one, submit its current `revision` to
`POST /api/stall/buy-links/ID/revoke`. Revocation prevents new previews, carts
and unpaid cart reviews. An already-started checkout retains its original
payment identity for recovery; revocation does not cancel a payment that may
already exist. Refund and payment cancellation remain their existing doors.
Generate a new configuration to change an allowed-origin list.

Configurations and channel-attributed orders are included in the commercial
JSON export and portable archive. Restored links and widgets are historical
records and cannot sell; the receiving owner generates fresh ones locally.
Guest cart capabilities, native sessions and provider credentials never travel.
There is no new provider account or outgoing provider job: the existing Stripe
and Pier checkout, payment and reservation work keeps its original durable
identity and recovery rules under INTEGRATION-001.
