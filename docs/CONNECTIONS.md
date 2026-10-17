# Pier and Stripe connections

Connect both from Stall's own page: sign in as the owner and open **Settings → Provider connections** (`/app#connections`). Nothing to edit in files and no restart.

- **Pier**: in Pier open **Channels**, add the Stall connection, choose the customer Stall's orders belong to and choose **Create Stall's key to Pier**. In Stall's **Connect Pier** form paste Pier's address (from Pier's browser tab, up to the first single slash) and the key, which starts with `pier_stall_`. Stall checks the key with Pier before saving and learns the shop customer from it. Creating a new key in Pier stops the old one; paste the new one here.
- **Stripe**: in Stripe copy the secret key from **Developers → API keys** (test mode first) and add a webhook endpoint (below) for its signing secret. Paste both into **Connect Stripe**. Stall checks the key with Stripe before saving.

Stall keeps these values encrypted in its own database (with a key derived from its session secret), reads them on every request, and never puts them in a backup or transfer: a restored or moved Stall connects again on this page. **Disconnect** removes a value saved here.

The same values can still be set as server settings, which take priority over the page (Settings then says so): `PIER_ORIGIN`, `PIER_SESSION` (`pier_channel=<key>`), `PIER_CUSTOMER_ID`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in `.dev.vars` locally, or with `rer deploy --set-secret NAME` for a deployment. `deploy.json` declares them optional, so a deploy without them succeeds and the page shows Not connected.

Have sellable stock in Pier warehouse bins for each listed SKU. A listing price belongs to Stall; the item's SKU, unit, stock, reservation and dispatch belong to Pier. Publication verifies the SKU and checkout rechecks current availability. Another buyer may consume stock before payment completes: a paid shortfall stays visible until you resolve and reconcile it. Stripe payment does not guarantee stock. Do not create a second replacement order to retry a pending stock effect.

Register `https://YOUR-WORKER-ORIGIN/api/stall/webhook` in your own Stripe account. Deliver Checkout completion and asynchronous payment-success events. Stall uses hosted Checkout in USD, collects US shipping addresses and never accepts card details. The webhook checks the raw-body HMAC, timestamp and canonical Checkout session, payment status, order identity, amount and currency before recording money or reserving stock. Browser return URLs are informational.

Use Stripe test mode for a first real transaction. A Stall on your own computer cannot receive Stripe's webhook: after a test payment, open the order and choose **Reconcile**, which reads the Checkout session from Stripe and reserves the stock in Pier. Local Stripe CLI webhook forwarding is a separate provider action; the brief's verification uses network-edge fakes, so no Stripe account is needed for CI. Real payment processing, delivery and refunds depend on your account and provider availability. Never expose a local development server to public traffic.

Keep the original Pier origin and Stripe account for each order. Reconfiguration does not move existing reservations, payment intents or shipments. Reconcile pending effects with their existing IDs. A refund never silently restocks a dispatched product: record the physical return/restock in Pier separately.

Stripe references: [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create), [webhook signatures](https://docs.stripe.com/webhooks/signature), [idempotent requests](https://docs.stripe.com/api/idempotent_requests), [refunds](https://docs.stripe.com/api/refunds/create).
