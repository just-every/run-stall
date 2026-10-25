# Stripe Tax preview foundation

TAX-001 is partial. These owner HTTP doors support tax development and review;
they do not calculate shopper checkout tax or authorize a taxed sale.
Use the existing Stripe connection on Settings → Provider connections. Only its
test account is supported by this preview slice. The credential needs Tax
settings and registration read access, plus calculation create and read access.
Stall never creates a registration or performs a filing here.

Read `GET /api/stall/tax/boundary` before a preview. It names the data sent,
retained records and the exact consent text. `GET /api/stall/tax/readiness`
reads current Stripe settings and active US registrations. Missing head office,
default product code or destination-state registration refuses a new preview.
The merchant must resolve configuration in the connected Stripe test account.

Send `POST /api/stall/tax/preview` with the native owner session, this shop's
Origin header, and a JSON object containing:

- `id`: a fresh random UUID, retained with the original input for recovery.
- `consent`: the exact consent text returned by the boundary door.
- `destination` and `shipFrom`: full US address objects with `line1`, optional
  `line2`, `city`, two-letter `state`, `postal_code` and `country: "US"`.
- `lines`: one to 50 entries, each with a unique opaque `reference`, positive
  integer `unitCents`, whole `quantity` and explicit Stripe `taxCode`.
- `shippingCents`: the nonnegative shipping amount after any shipping discount.

All amounts are exclusive USD integer cents. A line's provider amount is its
unit cents times quantity. These are owner-entered preview inputs, not catalog
or customer exemption evidence. No shopper may supply an exemption override.
Stripe determines rates from the full address. Stall returns reconciled totals,
the original calculation reference, provider expiry, and Stripe's actual
aggregate tax breakdown. It does not invent county, city or district labels
that the provider calculation does not supply.

`GET /api/stall/tax/previews` shows the latest 100 durable records with the full
count and a truncation flag. It excludes intent fingerprints and street
addresses. The journal survives archive transfer; provider credentials and
native sessions retain the existing nonportable custody boundary.

If a calculation response is lost, keep its original UUID and full inputs.
Find its original calculation ID in the connected Stripe account, then submit
the same preview with `calculationId`. Recovery only retrieves that calculation
and its complete line list, comparing addresses, amounts, product codes and
original line metadata. It never sends a replacement calculation POST.
A restored preview is observation-only, including an unsent prepared row.
Unknown references, changed inputs, missing pages and unreconciled totals refuse
recovery. Provider failure never becomes a locally assumed zero rate.

Remaining work includes Settings tax controls, saved merchant configuration,
exemption evidence, catalog and native checkout binding, order tax transactions,
refund reversals, shop-zone filing periods, all liability report levels and
CSVs, marketplace separation, nexus warnings and the live test-mode receipt.
ORDER-005, PROMO-001 and CART-001 must use the eventual server calculation door
with their own current prices, discount allocation and reviewed address; this
preview endpoint grants none of those capabilities.
