# Collections, menus and search

Open **Shop desk → Collections & search** as an owner or administrator. Only published products that Pier can sell ever appear to shoppers: a draft, scheduled, archived or unstocked-in-Pier product stays private, and every count, filter and suggestion is computed from that same list.

## Collections

A **hand-picked** collection lists products in the order you choose. A **rule-based** collection matches any or all of up to ten rules: a category, a tag, an attribute, a title word, or a price limit. Each collection has a title, a handle and a description; shoppers open it at `/shop?collection=<handle>` as a landing page. A collection can set its own sort; an unpublished collection is not browsable. A hand-picked collection keeps a product's place even when it is withdrawn and simply does not show it.

## Menus

The **main** menu leads the shop header and the **footer** menu closes each shop page. Items go to a collection, a product, a page in the shop or an `https` address, with one level of sub-items (twelve per level). A collection or product that is not published is left out of the menu for shoppers rather than shown broken.

## What shoppers can do

On `/shop` shoppers search names, SKUs (including each variant's SKU), categories, tags, attributes and variant options, with predictive suggestions as they type. They filter by collection, category, tag, attribute, variant option (a size and a color are matched on the same variant), price and in-stock, and sort by relevance, name, price or newest. Counts next to each filter reflect the other filters in use. The address holds the whole view, so a result page can be shared or reloaded, and a page with no matches explains itself and offers collections and categories to browse instead.

## Tune search

- **Synonyms.** One group per line: `tee, t-shirt`. A search for any term also finds products for the others. Terms are matched as words after lowercasing and removing punctuation.
- **Pinned and boosted products.** For a search, a pinned product leads the results (it must still match the shopper's filters); a boosted product ranks above other matches. Use product SKUs.
- **Search report.** Lists the most frequent searches and the searches that found nothing. Stall keeps only the words searched and counts, never who searched, so it cannot be used to identify a shopper. The list holds up to 5,000 different queries; beyond that the least repeated, oldest queries are dropped.

Agent credentials cannot change collections, menus or search: a signed-in owner or administrator makes each change, and **Activity** records it.
