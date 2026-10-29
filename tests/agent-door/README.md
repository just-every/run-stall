# Native Stall conformance preparation

The descriptor declares eleven native tools. Every tool/class has a `measure:1`
journey witness. The journey also covers optional product details, media,
archive/unarchive, publication scheduling/clearing, omitted active, default and
explicit lines refunds, shipping, goodwill, and address-change refunds. The
read-only witness remains `stall.audit1.read`; spend and escalations remain none.

Fixtures use Base's same-origin request function and native owner session.
Products, media uploads, tax configuration/consent, manual paid orders,
shipments, checkout, tax quotes, and payment observation use real native routes.
No SQL, demo mode, native-record injection, real provider credential, server or
network listener is used. The fixture package replaces only these network edges:

- `https://pier.agent-fixture.invalid`: inventory, reservation and dispatch ledger.
- `https://api.stripe.com`: test-account readiness, tax calculation/line evidence,
  checkout creation and original paid-session evidence.

The descriptor binds disposable Pier and Stripe credentials from test modules.
Stripe credentials are generated in the verifier process on each CLI run; the
matching value reaches only the isolated Stripe receiver through fixture control.
No provider-shaped credential literal is committed or logged.
Both edges validate authentication, exact payloads and idempotent identity;
unrecognized requests are refused. Worker-side edge modules use Web APIs only.
Stripe's checkout starts through the public native shipping, tax and checkout
routes. Native payment confirmation reads Stripe's original session, commits the
payment and different shipping address, and holds the order before stock
reservation or tax posting. This produces the actual eligible address-remedy
order rather than synthesizing one. The Stripe edge intentionally refuses tax
transaction and refund writes because this journey prepares internal drafts.

Each phase creates a catalog draft, approved inactive merchandising product,
published order product, reserved staff-paid order and separately shipped paid
order, plus its taxed address-mismatch order and person-uploaded PNG. Shipping
and goodwill preparations use the paid shipped native order; each remains an
unapproved draft. Tax settings are changed only through native owner operations
with the current configuration revision and exact native consent disclosure.

`afterStep` compares results with committed native records, native preview and
media bytes. After Base injection probes it reads current scoped records again
while retaining the original mutation result for identity and draft checks.
The refresh hook checks redacted products/orders/proposals/audit, actual native
shipment observation and eligible-order counts. Native personal-token issuance,
scoped access, person-only approval refusal and revocation remain covered by the
additional journey.

The parent runs final conformance after integrating the native adapter. Syntax
checks alone do not establish runtime conformance or real-provider acceptance.

Runtime adoption uses Base `2135c394939f4a737adabdc8003b0e667b31ac5a` and the
released `@runeditrun/rer` 0.2.91 CLI. The copied auth runtime and schema sources
share that runtime pin; numbered applied migrations retain their original pins
and bytes. The eleven tools and the CORE capability declaration are unchanged.

Run the normal verifier with this seed's hosted runtime shard for focused door
acceptance:

```sh
SEED_VERIFY_SHARD=runtime npx -y @runeditrun/rer@0.2.91 verify
```

The normal failure exit is retained. This runs the production build, runtime
HTTP checks, hydration and the complete declared door journey, including
changed-email admission, consent revocation, current-policy mutation replay,
review and audit checks. It is not evidence for undeclared resources, events,
prompts or subscriptions, or for a native queued continuation this seed does
not expose. Inactive and allow-list-excluded Business sponsor fixture states
are not declared; native personal-grant expiry/revocation remains covered by
the existing commerce journey. Wider Base clause statuses remain partial.
