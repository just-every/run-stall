# Move products into Stall

The first move-in kit imports listing metadata from a deliberately small Shopify
product CSV subset. It uses Base import-kit for a read-only dry-run, exact reviewed
fingerprint, retained source bytes, resumable journal and strict undo. It never
imports inventory, customers, cards, orders, images, options, tax settings or
fulfilment settings, and never writes to Pier.

## Move in from the Shop desk

Start with two products while keeping your existing shop open. The importer takes
listing metadata only; it does not migrate your Shopify shop as a whole.

1. Keep your original Shopify export. Prepare a private copy containing only the
   six columns documented below, with one row per unique handle and SKU. Use AUD
   prices and the same SKUs as Pier. Remove extra columns and variant or image
   continuation rows; a full Shopify export may not match this supported subset.
2. Sign in as an owner or administrator and open **Shop desk → Move in**. Under
   **1. Add your CSV**, choose the file or paste it into **CSV source**. Leave
   **Source namespace (optional)** blank for `shopify-products`, or use a stable
   label containing letters, digits, dot, underscore, colon or dash. Keep the same
   namespace when resuming this source.
3. Select **Run dry run**. Under **2. Review & apply**, read the counts and every
   diagnostic, then expand **Review planned product changes**. Check names,
   descriptions, SKUs and exact prices. A dry run does not change products.
4. Resolve errors in the CSV and run another dry run. Review the warning that all
   products remain unpublished. The **Reviewed fingerprint** binds this source
   and the destination state you inspected; changed input needs a new review.
5. Select **Apply reviewed import**. If the job needs another batch, select
   **Resume apply** until complete. Existing staged product details may be
   replaced by the reviewed changes.
6. Open **Products**, select **Edit product** for each staged listing, check its
   details and select **Available for publication**. Prepare a revision, then
   separately approve it. The [products guide](PRODUCTS.md) covers publication;
   matching SKUs must exist and be active in Pier.

If you leave before completion, return to **Move in → History**, select
**Refresh journal**, then **View** the job. **Resume apply from retained source**
uses its saved CSV and reviewed fingerprint. Inspect any reported conflict before
starting another import.

To undo, view the job and inspect **Job journal**, **Source custody** and **Undo
report**. Select **Review undo**, then **Undo import** in the confirmation dialog.
Use **Resume undo** if more work remains. Undo can remove a newly imported product
or restore its previous draft only while it remains untouched by later edits,
publication or orders. Inspect the final report for preserved records. Undo keeps
the journal and retained source; it is not customer erasure.

## Prepare the supported CSV

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

## API reference: review, apply and publish

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
