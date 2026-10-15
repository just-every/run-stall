# Move products into Stall

The first move-in kit imports listing metadata from a deliberately small Shopify
product CSV subset. It uses Base import-kit for a read-only dry-run, exact reviewed
fingerprint, retained source bytes, resumable journal and strict undo. It never
imports inventory, customers, cards, orders, images, options, tax settings or
fulfilment settings, and never writes to Pier.

Shopify documents product CSVs, their columns, decimal prices and legacy-column
compatibility in [Using CSV files to import and export products](https://help.shopify.com/en/manual/products/import-export/using-csv).
The legacy headers used here are also listed in Shopify's
[CSV import troubleshooting guide](https://help.shopify.com/en/manual/products/import-export/common-import-issues).
This kit accepts the six legacy headers below only. It does not implement every
Shopify import feature or accept arbitrary full exports. Prepare a private copy
with only these columns; do not replace your original Shopify export.

```csv
Handle,Title,Body (HTML),Variant SKU,Variant Price,Published
stoneware-mug,Stoneware mug,"<p>A handmade mug, glazed in blue.</p>",MUG-BLUE,24.50,TRUE
```

A two-product example is in [fixtures/shopify-products.csv](../fixtures/shopify-products.csv).
Use UTF-8, comma separators and these exact case-sensitive headers in this order.
An optional UTF-8 BOM, LF or CRLF, quoted commas, escaped double quotes and quoted
multiline descriptions are supported. Empty lines are ignored. Limits are 256 KiB
and 200 products per import.

| Column | Mapping and restrictions |
| --- | --- |
| Handle | Required unique Shopify handle, at most 160 characters; letters, digits and dashes. Retained as source evidence; not used as the destination ID. |
| Title | Required trimmed product name, at most 160 characters. |
| Body (HTML) | Description, up to 4,000 characters. Formatting is stripped to plain text; source HTML remains in the retained CSV. Scripts/styles are removed; common entities are decoded. HTML is never executed. May be empty. |
| Variant SKU | Required unique stable SKU, at most 100 characters; letters, digits, dot, underscore, colon and dash. Becomes both the Stall product ID and Pier SKU reference. |
| Variant Price | Positive decimal in the installation's currency, at most two decimal places, no symbols, exponent or thousands separators. Converted exactly to integer cents, up to 1,000,000.00 (the native product limit). Zero-price products are outside this kit. |
| Published | Required TRUE or FALSE, case-insensitive. Both become `active:false`. |

One row, one distinct handle and one distinct SKU are supported. Repeated SKUs,
multiple variants for a handle, image continuation rows, unknown columns and
blank required cells are rejected. Resolve variants in your source copy rather
than allowing this kit to guess a combination. Currency conversion is not
performed; check the installation currency before review.

## Review, apply and publish

1. A signed-in owner or admin, or their current Stall agent credential, submits
   `{csv, namespace?}` to `POST /api/stall/imports/preview`. Namespace defaults to
   `shopify-products`; use a stable export-source label, not a customer identifier.
   Preview changes no data. Review every mapped product and warning.
2. A human owner or admin submits the same CSV and namespace with the preview's
   exact `fingerprint` to `POST /api/stall/imports/apply`. Agents cannot apply or
   undo. Source bytes, mapping and complete existing product before-images bind
   that fingerprint. A stale review fails; preview and review again.
3. Apply processes bounded batches of up to ten products. While the returned job
   is `applying`, repeat the same apply request with the original fingerprint.
   A replay resumes the same journal job instead of duplicating products.
4. All results are unpublished drafts, including rows whose Published value was
   TRUE. Confirm each SKU exists and is valid in Pier, then use Stall's separate
   human product approval flow. Import does not create stock or publish listings.

The destination row is `st_products(id=sku,value_json,revision)`. Its imported JSON
is exactly `{sku,name,description,unitCents,active:false}`. Updating a reviewed
existing draft replaces its listing metadata; the journal retains the complete
original draft. Published products and any SKU referenced by an existing order
are refused. Concurrent edits, including same-revision edits, are fenced in the
native SQL transaction. Live operator role, version, session expiry/revocation or
agent grant expiry are checked within Base's reads and writes.

## Journal and undo

`GET /api/stall/imports` returns `{jobs:[...]}`. Each job includes `id`, `state`,
`checkpoint`, `total`, `fingerprint` and `error`. `GET /api/stall/imports/:id`
returns `{job,originals,undoReport}` with the exact retained CSV bytes. Preview
returns `{plan,fingerprint,counts,diagnostics}`; plan entries expose mapped effects
and before-images. Keep source files free of personal data: this kit is only for
public product metadata and has no customer-erasure custody.

A human owner or admin can `POST /api/stall/imports/:id/undo` with an empty JSON
object. Repeat while `state` is `undoing`. Undo deletes a newly imported draft or
restores an existing draft only while it still matches this import's attributed
after-image. Any native edit, product publication or order reference stops undo;
those records and catalogue references remain intact. Resolve that situation
through the native workflow instead of deleting business history. The import
journal and original bytes remain available after successful undo.

Publication and undo are separate human decisions. An agent can prepare and
review a move-in, but cannot grant itself either decision.
