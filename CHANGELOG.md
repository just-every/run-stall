# Changes

## 0.1.0 — 2026-11-27

The first release. Stall is an online shop for US makers and small shops whose stock lives in Pier, and it runs in your own Cloudflare account.

- **Runs on rer 0.2.143.** The pinned platform moves from 0.2.79.
- **Mail optional.** `MAIL_PROVIDER=none` deploys with no sender or mail key: the owner signs in with `rer signin`, paid orders still go through, and the order shows its confirmation email was not sent (`mail_off`) without a provider being contacted. Email sign-in and invitations need a configured provider.
- **Demo follows releases.** The run-demo workflow redeploys the demo at each published release's tag (Base fc087acf), instead of on pushes to main.
- **Deployment spec current.** The managed deployment spec now lists migrations 0052–0054, and OWNER_EMAIL is no longer a public variable.

### Not in this release

CONTRACT.md tracks the Shopify-replacement contract: 32 clauses done, 56 partial and 33 missing at this release.

### Earlier work

- Shipping profiles: group products into profiles with their own zones, services, rates, pickup and local delivery. A mixed basket is quoted per service from each profile's rate for its own items, refused before payment when a line's profile does not serve the ZIP code, and bound to the profile revisions it was quoted under; assign products by grid, product editor or catalog CSV. The flat shipping charge is now the General profile.

- Let hosted Stall reach a Pier Worker on the same Cloudflare zone using public fetch routing.

- Hosted mail takes the provider and verified sender from private deployment settings.

- Use the published rer 0.2.51 package. Current package scripts and command guides replace removed queue/copy paths.

- Orders learn actual Pier dispatches on refresh and reconciliation, including partial shipments, references, dispatch times, carrier tracking and delivery state when supplied. Shipping and Settings explain where to dispatch; preparing shipping again names the existing dispatch, and connection failures retain Pier's exact reason. Order timestamps now show their time zone. Paid reservation recovery keeps its original command content and separately supplies Stripe payment evidence to Pier for its books.
- A shop on your own computer connects Stripe with its secret key alone. Stripe cannot send webhooks to a local address, so Stall confirms each payment by asking Stripe: when the customer comes back from checkout (the order page now says whether payment is confirmed), every minute for orders still awaiting payment (a scheduled check `rer dev` runs too), and on Reconcile. The form says webhooks are for an online shop and gives the steps; an online shop still needs its signing secret, and a local shop refuses one rather than accepting an invented secret. Settings shows Payment confirmations ready once the Stripe key is saved.
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
