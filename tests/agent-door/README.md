# Native Stall conformance preparation

These test modules run through Base's same-origin hosted request function and
the native owner session. Only the external Pier network boundary is replaced.
There is no SQL, demo mode, native-record injection, real provider credential,
server, or network listener in this fixture package.

Add these fields to the existing surface verification declaration, retaining
its other owner bindings:

```json
{
  "fixtures": { "module": "tests/agent-door/fixtures.mjs" },
  "journey": "tests/agent-door/journey.mjs",
  "network": {
    "module": "tests/agent-door/provider-edge.mjs",
    "origins": ["https://pier.agent-fixture.invalid"]
  },
  "owner": {
    "bindings": {
      "PIER_ORIGIN": { "module": "tests/agent-door/pier-origin-binding.mjs" },
      "PIER_SESSION": { "module": "tests/agent-door/pier-session-binding.mjs" },
      "PIER_CUSTOMER_ID": { "module": "tests/agent-door/pier-customer-binding.mjs" }
    }
  }
}
```

Each conformance phase creates its own unapproved catalog product, approved
inactive merchandising product, published order product, paid reserved order,
and separately shipped paid order. The owner approves the shipment through
the native command door. Shipping is quoted through the native public quote
route; no default shipping price is assumed. First shipment observation is
settled before no-effect witnesses run. The Pier fixture retains previous
phase reservations and dispatches so native history stays reconcilable.

Fixture references are `catalog /sku`, `merch /sku`, `shipment /id`, and
`refund /id`. Read the product, source bundle, and each order with their scoped
tools immediately before their respective mutations. Use those read results
for current revisions, exact source wording/citations, and purchased refund
SKUs. The hook receives cloned inputs and cannot rewrite stale arguments.

`afterStep` compares each result with committed native state, checks exact
order redaction, and proves preparation retains the person approval boundary.
The extra journey issues an existing native personal agent grant, reads the
same native product through the scoped tool, refuses native person approval,
then revokes the grant and proves scoped access ends. Those local-client
calls are untracked by the signed-agent harness ledger and retain their own
separate native local-agent audit identity.

No heavy jobs run as part of authoring these modules. Run the seed's final
agent conformance through its normal verification command after the production
adapter and surface are integrated.
