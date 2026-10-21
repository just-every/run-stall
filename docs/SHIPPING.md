# Shipping profiles

Open **Shop desk → Shipping** as an owner or administrator. A **shipping profile** says how a group of products ships: where it ships from, which ZIP codes it serves, which services it offers at what rate, and whether it can be picked up or delivered locally. Every product starts in the **General** profile. Put oversized, fragile, free-shipping or local-only goods in their own profile. A shop has the General profile and up to 99 custom ones.

## Profiles

Select **New profile** (or **Edit** beside a profile).

- **Zones** limit the ZIP codes the profile's shipped services serve, one zone per line as `East coast: 0, 1, 2, 3`. A prefix is one to five leading digits. No zones means every US ZIP code.
- Each **service** has a code (such as `ups-ground`), a name shoppers see and a rate: **Free**, **Flat**, **By weight** or **By price**. Bands are `limit=charge` lines in rising order (grams for weight, dollars for price); the first band at or above the basket's total applies, and a basket past the last band is not offered that service. A **handling fee** is added once per profile in the basket and a **surcharge** once per item. Weight bands use each product's or variant's **Weight · g**; a profile priced by weight cannot rate an item with no weight.
- A profile with **no shipped service** is pickup-only or local-delivery-only.
- **Allow local pickup** and **Allow local delivery** say whether the profile's items may be received those ways.

The earlier single flat charge is the General profile's one "Domestic shipping" service. **Settings → Shipping charge** keeps editing it while the General profile stays that simple; once you give General more services or zones, Settings points you here.

Carrier-calculated live rates, state-based zones, per-location pickup and delivery areas, handling cut-offs and delivery promises belong to the shipping-zones and rates work (SHIP-001, SHIP-002). Stall does not buy labels.

## Pickup and local delivery

On **Pickup and delivery**, set the pickup place (name, address, hours, instructions) and the local-delivery area (ZIP prefixes, fee, minimum order). A shopper is offered pickup or local delivery when every profile in the basket allows it. Local delivery is offered only for a ZIP code inside the area and above the minimum; the basket says how much more is needed.

## What a shopper sees

The shop asks for a ZIP code when it needs one and lists the offered services with exact prices. For a basket that spans profiles:

- a shipped service is offered only when every profile in the basket allows it, and costs the sum of each profile's rate for its own items;
- an item whose profile has no shipped service removes shipped services for the whole basket and the shop names that item;
- an item whose profile does not serve the ZIP code is named, and checkout refuses a shipped service before payment while the rest of the basket stays.

Each quote carries the profile revisions it used. Editing a profile or reassigning a product changes the revision, so an open quote is refused at checkout and the shopper reviews the new price. A paid order keeps the profile revisions, service, ZIP code and charge it was sold under (the order panel shows them), whatever you change later.

Stripe collects the delivery address after the shopper chooses; the ZIP code that priced the quote is the one the shopper entered in the shop. Pickup orders collect no shipping address.

## Assigning products

Choose a product in **Products** and use **Shipping profile** to move it (and its variants, each of which may override the product). To move many at once use **Shipping → Products**: tick products in the grid and choose a profile, or paste a catalog CSV:

```csv
SKU,Shipping Profile
DESK-A,oversized
STICKERS,stickers
```

Both show every change for review first; **Apply reviewed assignment** applies exactly what you reviewed (a changed profile or assignment asks for a fresh review). The Shopify move-in CSV is unchanged: shipping profiles are assigned after products arrive.

## Backup, export and access

Profiles, places and assignments are included in the archive and in the **records** business export; each order's export shows its shipping service, ZIP code and profile revisions. Only a signed-in owner or administrator changes shipping; agents cannot.
