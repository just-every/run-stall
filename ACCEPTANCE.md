# First release

- A customer chooses two in-stock products at `/shop` and pays through the shop owner's Stripe Checkout; a verified paid event reserves their stock in Pier exactly once.
- An owner prepares and approves shipping, then a partial refund for one line; payment, reservation, shipment, refund and approval history reconcile without duplicating external effects.
- An agent prepares product, shipping and refund drafts; a signed-in owner or admin approves the exact revision. The owner can revoke agent access.
- An owner previews a Shopify product CSV, applies the reviewed move-in, reads its journal and undoes untouched imports; stock remains in Pier.
- An owner exports and restores shop data, and erases a customer's contact details while keeping anonymous commercial history and fencing older backups.

Not needed: brand or homepage design, a docs/run-site deployment, a purchased domain, real provider calls for verification, a tax engine, shipping rates, marketplaces, POS or an app ecosystem. Real checkout uses the owner's Stripe and Pier accounts; card details never enter Stall.
