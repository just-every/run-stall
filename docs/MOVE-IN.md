# Move products into Stall

Stall accepts a complete native catalog format as well as the legacy Shopify
subset below. Use **Edit complete catalog fields** in the bulk editor to change
existing products and collections together, or use the native file format.


The first move-in kit imports listing metadata from a deliberately small Shopify
product CSV subset. It uses Base import-kit for a read-only dry-run, exact reviewed
fingerprint, retained source bytes, resumable journal and protected partial undo. It never
imports inventory, customers, cards, orders, images, options, tax calculations or
fulfillment settings, and never writes to Pier.

## Move in from the Shop desk

Start with two products while keeping your existing shop open. The importer takes
listing metadata only; it does not migrate your Shopify shop as a whole.

1. Keep your original Shopify export. Prepare a private copy containing only the
   six columns documented below, optionally followed by `Stall Details`, with one row per unique handle and SKU. Use USD
   prices and the same SKUs as Pier. Remove extra columns and variant or image
   continuation rows; a full Shopify export may not match this supported subset.
2. Sign in as an owner or administrator and open **Shop desk → Move in**. Under
   **1. Add your CSV**, choose the file or paste it into **CSV source**. Leave
   **Source namespace (optional)** blank for `shopify-products`, or use a stable
   label containing letters, digits, dot, underscore, colon or dash. Keep the same
   namespace when resuming this source.
3. Select **Run dry run**. Under **2. Review & apply**, read the counts and every
   diagnostic, then expand **Review planned product changes**. Check names,
   descriptions, SKUs, exact prices and all optional details against their before-images. A dry run does not change products.
4. Correct rejected value rows and run another dry run, or explicitly check
   **Exclude the … rejected CSV rows listed above** to apply only valid rows.
   Structural problems, ambiguous duplicate SKUs/handles and unsupported columns
   require correcting the file. A file with no valid rows cannot be applied.
   Review the warning that all products remain unpublished. The **Reviewed fingerprint** binds this source
   and the destination state you inspected; changed input needs a new review.
5. Select **Apply reviewed import**. If the job needs another batch, select
   **Resume apply** until complete. Existing staged product details may be
   replaced by the reviewed changes.
6. Open **Products**, select each staged listing (the **Staged** tab lists them), then **Edit product**, check its
   details and select **Available for publication**. Prepare a revision, then
   separately approve it. The [products guide](PRODUCTS.md) covers publication;
   matching SKUs must exist and be active in Pier.

If you leave before completion, return to **Move in → History**, select
**Refresh journal**, then **View** the job. **Resume apply from retained source**
uses its saved CSV and reviewed fingerprint. Inspect any reported conflict before
starting another import.

To undo, view the job and inspect **Job journal**, **Source custody** and **Undo
report**. Select **Review undo**, then **Undo import** in the confirmation dialog.
Use **Resume undo** if more work remains. New jobs reverse untouched products
while keeping products changed by native edits, publication or orders.
**Product undo outcomes** names each kept/reversed SKU and protecting order.
Older v1 jobs retain their original strict behavior: a conflict stops the whole
undo. Existing jobs remain readable and resumable after an upgrade. Undo keeps
the journal and retained source; it is not customer erasure.

## Prepare the supported CSV

Shopify documents product CSVs, their columns, decimal prices and legacy-column
compatibility in [Using CSV files to import and export products](https://help.shopify.com/en/manual/products/import-export/using-csv).
The legacy headers used here are also listed in Shopify's
[CSV import troubleshooting guide](https://help.shopify.com/en/manual/products/import-export/common-import-issues).
This kit accepts the six legacy headers below, optionally followed by `Stall Details`. It does not implement every
Shopify import feature or accept arbitrary full exports. Prepare a private copy
with only these supported columns; do not replace your original Shopify export.

```csv
Handle,Title,Body (HTML),Variant SKU,Variant Price,Published
stoneware-mug,Stoneware mug,"<p>A handmade mug, glazed in blue.</p>",MUG-BLUE,24.50,TRUE
```

A two-product example is in [fixtures/shopify-products.csv](../fixtures/shopify-products.csv).
Use UTF-8, comma separators and these exact case-sensitive headers in this order.
An optional UTF-8 BOM, LF or CRLF, quoted commas, escaped double quotes and quoted
multiline descriptions are supported. Empty lines are ignored. Limits are 256 KiB
and 200 product rows per import, including rejected value rows.

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
blank required cells are rejected. Value errors name their physical CSV line
(including blank lines and multiline fields) in preview; an explicitly excluded
row remains in custody and makes no product change. Structural ambiguity refuses
the entire source. Resolve variants in your source copy rather
than allowing this kit to guess a combination. Currency conversion is not
performed; check the installation currency before review.


### Optional Stall Details extension

Append a seventh header, `Stall Details`, to import the optional facts already
supported by the [product editor](PRODUCTS.md#optional-product-details). This is
Stall's extension, not a Shopify export column. Each cell is a complete JSON
object using `costCents`, `weightGrams`, `dimensionsMm` (`length`, `width`, `height`),
`taxCategory`, `hsCode`, `countryOfOrigin` and `customFields`. Custom fields have
`key`, `label`, `type` (`text`, `number` or `boolean`) and a matching `value`.
Unknown keys, invalid units/types and duplicate custom-field keys are rejected
at their physical CSV row before any change. Tax categories and format-checked
HS/origin facts do not claim tax or customs verification.

For example, the JSON object `{"costCents":735,"weightGrams":350}` is written as
this CSV cell (including the surrounding quotes):

```csv
"{""costCents"":735,""weightGrams"":350}"
```

The extended object **replaces all optional details**, including pending native
facts, after exact reviewed apply. A literal `{}` clears the details; a blank
cell is invalid. Review the full current/pending before-image and planned values.
A six-column CSV still refuses products with current or pending optional details
instead of silently dropping them. The staged bulk grid retains the same refusal.
Published and ordered products remain protected for both CSV forms.

New jobs use mapping v4. Older v1/v2/v3 jobs keep their retained mapping, source,
fingerprint and resume/undo semantics. Original source, row outcomes, business
CSV/JSON exports and installation archives preserve the supported facts.

## API reference: review, apply and publish

1. A signed-in owner or admin, or their current Stall agent credential, submits
   `{csv, namespace?}` to `POST /api/stall/imports/preview`. Namespace defaults to
   `shopify-products`; use a stable export-source label, not a customer identifier.
   Preview changes no data. Review every mapped product and warning.
2. A human owner or admin submits the same CSV and namespace with the preview's
   exact `fingerprint` to `POST /api/stall/imports/apply`. Agents cannot apply or
   undo. If preview contains rejected entries, include `excludedRows:[...]`
   listing exactly their physical CSV row numbers. Missing, extra or duplicate
   exclusions are refused. All-invalid plans are refused even with exclusions.
   Source bytes, mapping and complete existing product before-images bind
   that fingerprint. A stale review fails; preview and review again.
3. Apply processes bounded batches of up to ten source records, including excluded rows. While the returned job
   is `applying`, repeat the same apply request with the original fingerprint and exclusions.
   A replay resumes the same journal job instead of duplicating products.
4. All results are unpublished drafts, including rows whose Published value was
   TRUE. Confirm each SKU exists and is valid in Pier, then use Stall's separate
   human product approval flow. Import does not create stock or publish listings.

The destination row is `st_products(id=sku,value_json,revision)`. Its imported JSON
is `{sku,name,description,unitCents,active:false}`, with optional validated `details` when the extended column is present. Updating a reviewed
existing draft replaces its listing metadata; the journal retains the complete
original draft. Published products and any SKU referenced by an existing order
are refused. Concurrent edits, including same-revision edits, are fenced in the
native SQL transaction. Live operator role, version, session expiry/revocation or
agent grant expiry are checked within Base's reads and writes.

## Journal and undo

`GET /api/stall/imports` returns `{jobs:[...]}`. Each job includes `id`, `state`,
`checkpoint`, `total`, `fingerprint` and `error`. `GET /api/stall/imports/:id`
returns `{job,originals,undoReport,rejectedRows}` with the exact retained CSV bytes.
Each rejected row has its physical `row`, source identity and `reason`. Preview
returns `{plan,fingerprint,counts,diagnostics}`; plan entries expose mapped effects
and before-images. Keep source files free of personal data: this kit is only for
public product metadata and has no customer-erasure custody.

A human owner or admin can `POST /api/stall/imports/:id/undo` with an empty JSON
object. Repeat while `state` is `undoing`. Undo deletes a newly imported draft or
restores an existing draft only while it still matches this import's attributed
after-image. Current v2/v3/v4 jobs retain changed or dependent rows while reversing
untouched rows. The report names each SKU, its disposition/reason, observed and
expected revisions/content, and protecting order/publication references. Every
observation and dependency set is fenced in the undo transaction. A repeated undo
observes the same final dispositions. Source checkpoints include rejected rows;
undo reports count only product effects. The seed returns all reports within its
200-row source bound.

Legacy v1 jobs keep strict undo: a native edit, publication or order reference
stops the whole reversal. No upgrade silently relabels those jobs or changes
their retained mapping/fingerprint. The journal and original bytes remain
available after either form of undo.

Publication and undo are separate human decisions. An agent can prepare and
review a move-in, but cannot grant itself either decision.


## Complete native catalog files

From **Move in**, choose **Export native catalog CSV**. This downloads current
product and collection records with the headers `Kind,ID,Value`. Each `Value`
cell is a complete JSON object; standard CSV quoting doubles embedded quotes.
The file holds at most 200 records and 256 KiB. Original files and rejected
physical row numbers remain in the same import journal as Shopify jobs.

A `product` row's ID equals its `sku`. Its value includes `sku`, `name`,
`description` (plain text), `unitCents` (USD integer cents), `stockMode` (`pier`),
`publication` (`draft`, `published`, `scheduled` or `archived`), optional
`publishAt` for a scheduled product, and complete optional `details`.
Details use the native product editor's fields, including option definitions,
variant SKUs and prices, tax category, weight in grams, dimensions in
millimeters, HS code, country of origin and typed custom fields. Empty details
clear them. Only the existing Pier-tracked mode is available; the file never
changes stock quantities. Other stock modes and quantity changes remain the
stock clauses' work. Tax categories and customs values are merchant facts,
not provider tax calculation or customs verification.

A `collection` row's ID equals its `handle`. Its value is the native collection
record: `handle`, `title`, `description`, `kind` (`manual` or `rule`), `published`,
optional `sort`, and either `skus` or `match` and `rules`. Manual membership lists
product IDs, including products in the same file. Rule-based collections use
the existing category, tag, title, attribute and price rules. Product and
collection identities must be unique. Existing shipping-profile assignments
stay in the independent reviewed shipping-assignment grid and catalog CSV;
these edits preserve them.

Run a dry run and inspect the complete before-images and effects. Native
catalog publication is an explicit human approval in **Apply reviewed import**:
every live variant must currently exist and be active in Pier, and native
handle, SKU, price and media checks still apply. Draft, scheduled and archived
states remain private under their ordinary listing rules. The native format
can update an already published or ordered product; orders keep their purchased
snapshots. Unlike Shopify's six-column mapping, native descriptions stay literal
plain text and native records replace any pending revision too.

For the API, send the returned `reviewedAt` with the exact `fingerprint`, CSV,
namespace and rejected-row exclusions on the first apply. The reviewed time,
current actor, complete catalog before-images and source bind the review.
A stale review cannot write. Apply processes at most ten source records per
request. Resume with the original file and fingerprint, or use **Resume apply
from retained source** after leaving the form. Every resume checks current
local authority and current listing and stock validity; restored sessions and
credentials grant nothing. Completed replay returns the original job.

Native undo restores complete before-images for untouched records and names
records kept because of later edits, purchases or retained collection
references. A purchased variant protects its whole product. Undo never changes
an order, reservation or provider ledger. Complete files, business exports,
installation archives, original source custody and the journal preserve the
supported facts; original source bytes are distinct from the current catalog
download.
