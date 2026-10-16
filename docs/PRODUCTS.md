# Prepare and publish products

Open **Shop desk → Products** as an owner or administrator. Product details and prices live in Stall; the matching SKU and stock live in Pier. Connect Pier before publishing an available product.

## Add a product

1. In **Prepare a product**, enter the exact Pier **SKU**, **Product name**, **Unit price · AUD** and **Description**. Enter the price in dollars and cents, for example `24.50`, with at most two decimal places.
2. Leave **Available for publication** selected if this product should appear in the shop.
3. Select **Prepare revision**. This saves a draft; it does not publish the product.
4. In **Revision … for approval**, review the name, description, price and Active/Inactive setting. Select **Approve & publish revision …** to approve those exact details.
5. Open `/shop` and check the listing. Availability comes from Pier; a published item with no available stock is sold out.

An available product must have a matching active SKU in Pier. If publication fails, resolve the connection or SKU in Pier, refresh the desk and review the current draft before approving again. Publication does not add inventory.

## Change a listing

Select **Edit product**, change its details and select **Prepare revision**. The SKU stays fixed. A previously published listing keeps its approved details and price until you approve the replacement draft.

To withdraw a listing, prepare a revision with **Available for publication** cleared, then approve it. The product becomes **Inactive**. Preparing that change alone leaves the published listing in place.

If someone changes the record while you are reviewing it, Stall refuses the old revision. Select **Refresh shop**, inspect the latest details and make a fresh decision. Recorded orders retain the product details and prices used for their checkout.

## Publish imported products

[Shopify move-in](MOVE-IN.md) creates staged, unpublished products, even when the source says `Published=TRUE`. For each imported product, select **Edit product**, review the imported details, select **Available for publication** and **Prepare revision**, then approve the exact revision. Verify the SKU in Pier before doing so.

An agent credential can prepare a draft. A signed-in owner or administrator must approve publication. **Activity** records product preparation and publication.
