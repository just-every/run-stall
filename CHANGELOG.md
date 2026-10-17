# Changes

## Unreleased

- A shop on your own computer connects Stripe with its secret key alone. Stripe cannot send webhooks to a local address, so Stall confirms each payment by asking Stripe: when the customer comes back from checkout (the order page now says whether payment is confirmed), every minute for orders still awaiting payment (a scheduled check `rer dev` runs too), and on Reconcile. The form says webhooks are for an online shop and gives the steps; an online shop still needs its signing secret, and a local shop refuses one rather than accepting an invented secret.
- Paid orders reach Pier priced: each line carries its unit price and USD, so Pier's sales order has a total and its invoice posts to the books.
- Pinned rer 0.2.48. API tests run against Pier main 28000f3.

- Connect Pier and Stripe from Stall's own page: Settings → Provider connections now has Connect Pier (Pier's address and the key Pier shows) and Connect Stripe (secret key and webhook signing secret). Stall checks each with Pier or Stripe, keeps them encrypted in its database, reads them on every request and leaves them out of backups and transfers. Server settings of the same names still take priority. No .dev.vars edit or restart is needed.

## 2026-10-16

- Published the run site at https://run-stall.com from GitHub Actions and pointed the README and guides at it.
- Built the picked kraft-tag and periwinkle design across the run site, sign-in, setup and shop.
- Added Markdown-based on-site guides and a disabled run-site deployment workflow.
- Added current-section tabs and expandable order summaries; made status, people and business-time displays readable.
- Let invited people enter local development through the same one-click sign-in as the owner, preserving invitation authority and cancellation checks.
- Updated the pinned rer package to 0.2.27.
