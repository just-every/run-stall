# Prepare and publish products

Open **Shop desk → Products** as an owner or administrator. Product details and prices live in Stall; the matching SKU and stock live in Pier. Connect Pier before publishing an available product.

## Add a product

1. Select **Prepare a product** and enter the exact Pier **SKU**, **Product name**, **Unit price · USD** and **Description**. Enter the price in dollars and cents, for example `24.50`, with at most two decimal places.
2. Leave **Available for publication** selected if this product should appear in the shop.
3. Select **Prepare revision**. This saves a draft; it does not publish the product.
4. In **Revision … for approval**, review the name, description, price, optional details and Active/Inactive setting. Select **Approve & publish revision …** to approve those exact details.
5. Open `/shop` and check the listing. Availability comes from Pier; a published item with no available stock is sold out.

An available product must have a matching active SKU in Pier. If publication fails, resolve the connection or SKU in Pier, refresh the desk and review the current draft before approving again. Publication does not add inventory.

## Optional product details

Open **Optional product details** in the editor to record cost in USD, weight in
whole grams and all three dimensions in whole millimeters. Leave unknown facts
blank. Tax category, HS code and country of origin are merchant facts: HS codes
accept 6, 8 or 10 digits and origin accepts two letters, normalized to uppercase.
These format checks do not verify a country, tariff or tax treatment and do not
calculate shipping or tax.

Add up to 20 custom fields with a unique lowercase key, a readable label and a
text, number or yes/no value. For example, add a size chart as text or capacity
as a number. Approved custom fields appear on the shop listing as plain text;
cost and internal shipping/tax facts stay in the merchant desk. Review every
fact in the prepared revision before publishing. Leaving an optional field blank
clears it when that revision is approved. A failed prepare keeps the form input.

Product CSV/JSON business exports and installation archives include current and
prepared details, variants, media files, personalization settings and each order line's variant and answers. The six-column Shopify import and staged bulk grid cannot carry
these richer fields: they refuse a SKU with current or prepared metadata instead
of dropping it. Edit that SKU through Products, or use the reviewed
[Stall Details CSV extension](MOVE-IN.md#optional-stall-details-extension) to replace
the complete optional details object. The extension stages unpublished products;
publication remains a separate approval.

New purchases keep the description, name and price from checkout even after a
later listing change. Older orders without a saved description do not infer one
from today's product.

## Variants, images, categories and personalization

In the editor, **Shop listing** holds the product's page address (handle), compare-at price, categories, tags, attributes and customs description. A handle uses lowercase letters, digits and single hyphens, such as `linen-tee`; the product page is `/shop/<handle>`, and if you leave it blank Stall derives it from the SKU. A compare-at price must be higher than the price. Categories, tags and attributes (for example Material: Organic cotton) appear on the product page and drive the shop's filters; products join **collections** through the Collections & search screen (see the [shopfront guide](SHOPFRONT.md)).

**Images and videos** are uploaded from the editor: PNG, JPEG, GIF or WebP images and MP4 or WebM videos of up to 700 KB each. Stall reads each file's own bytes, so a file whose content does not match its type is refused. Every file needs alt text; the first image leads the gallery. A file is public only while a published listing shows it, and staff can preview any file.

**Options and variants.** Add up to three options (for example Size and Color) and generate their combinations. Each variant has its own SKU, which must exist in Pier before you publish, and may override the product price and compare-at price and carry its own cost, weight, dimensions, HS code, country of origin, customs description and image. Availability is each variant's own Pier availability; stock modes other than Pier are the stock clauses' work. Archiving a variant removes it from the shop but keeps every past order line.

**Personalization.** Add up to five fields: text with a character limit (for example engraving, 20 characters), a choice list, or a file upload limited to the types you select (PNG, JPG, PDF) and a size of at most 700 KB. Any field can be required and can add a price (for example +$5.00 per item). Shoppers' answers are checked against these fields before **Add to basket** and again at checkout; the add-on price is added to the line, shown in the basket, order, packing slip and confirmation email, and exported. An uploaded file is stored privately: only a signed-in owner or administrator can download it from the order, and erasing the customer's contact (Settings) deletes the file while keeping the order line and its price.

**Scheduling and archiving.** A product is a draft until you approve it, then published; set **Publish at** to approve a listing that goes live by itself at that time (the shop checks the time on every request), or **Archive this product** to withdraw it while keeping its order history. Orders keep the name, description, variant, personalization and price at checkout.

An order's **Open packing slip** link prints what to pick and pack, including each variant, personalization and a link to the private file. When payment is verified Stall sends the buyer one plain-text order confirmation through your configured mail provider; the order records whether it was sent. Durable delivery and bounce tracking arrive with the transactional mail work.

## Change a listing

Select the product in the table, then **Edit product**; change its details and select **Prepare revision**. The SKU stays fixed. A previously published listing keeps its approved details and price until you approve the replacement draft.

To withdraw a listing, prepare a revision with **Available for publication** cleared, then approve it. The product becomes **Inactive**. Preparing that change alone leaves the published listing in place.

If someone changes the record while you are reviewing it, Stall refuses the old revision. Select **Refresh shop**, inspect the latest details and make a fresh decision. Recorded orders retain the product details and prices used for their checkout.

## Publish imported products

[Shopify move-in](MOVE-IN.md) creates staged, unpublished products, even when the source says `Published=TRUE`. For each imported product, select it in the table, then **Edit product**, review the imported details, select **Available for publication** and **Prepare revision**, then approve the exact revision. Verify the SKU in Pier before doing so.

An agent credential can prepare a draft. A signed-in owner or administrator must approve publication. **Activity** records product preparation and publication.

## Bulk edit staged products

Select **Bulk edit staged products**, choose unpublished SKUs and edit their
names, plain-text descriptions and exact USD prices. Select **Review bulk edit**
and compare the server's reviewed before/after values before applying. Description
whitespace at the start/end is trimmed; literal markup remains plain text.

Each edit accepts up to 200 products within 256 KiB of generated CSV. Existing
prepared revisions are replaced by the reviewed staged values. Published products, products with current/prepared optional details
and products referenced by orders are refused; publication remains a separate
prepare/approve decision. Changed source or native records require a fresh review
and preserve your entered grid values.

Resume a bounded apply in the editor or from its retained source in **Move in →
History**. That journal also exposes original rows and undo. New jobs reverse
untouched rows while keeping and naming later edits, publication and order
dependencies; older strict jobs retain their original behavior. See the
[move-in guide](MOVE-IN.md) for CSV exclusions, custody and undo details.
