# Pier and Stripe connections

All values are private configuration. Never paste a session cookie or key into a URL or Git. Locally place only the needed variables in an owner-readable `.dev.vars` file (ignored by Git); preserve the settings RER setup generated. Stop and restart `rer dev` after changing configuration. For deployment, `deploy.json` declares them as optional secrets: a deploy without them succeeds and the Connections section shows Setup required. Supply them from your secret manager, or add each later with `rer deploy --set-secret NAME`.

| Variable | Source |
| --- | --- |
| `PIER_ORIGIN` | Exact origin of your Pier installation, HTTPS when hosted. Local loopback HTTP is accepted only in local mode. No path, query or trailing slash. |
| `PIER_SESSION` | Cookie header for a current, authorized Pier owner/admin native session. Obtain it from your own authenticated Pier browser session. It is a credential; rotate it when it expires or its operator changes. |
| `PIER_CUSTOMER_ID` | Existing Pier customer representing the online shop. Stall sends orders for this customer. |
| `STRIPE_SECRET_KEY` | Your Stripe account's secret API key, test mode first. |
| `STRIPE_WEBHOOK_SECRET` | Stripe signing secret for the endpoint below. |

Have sellable stock in Pier warehouse bins for each listed SKU. A listing price belongs to Stall; the item's SKU, unit, stock, reservation and dispatch belong to Pier. Publication verifies the SKU and checkout rechecks current availability. Another buyer may consume stock before payment completes: a paid shortfall stays visible until you resolve and reconcile it. Stripe payment does not guarantee stock. Do not create a second replacement order to retry a pending stock effect.

Register `https://YOUR-WORKER-ORIGIN/api/stall/webhook` in your own Stripe account. Deliver Checkout completion and asynchronous payment-success events. Stall uses hosted Checkout in USD, collects US shipping addresses and never accepts card details. The webhook checks the raw-body HMAC, timestamp and canonical Checkout session, payment status, order identity, amount and currency before recording money or reserving stock. Browser return URLs are informational.

Use Stripe test mode for a first real transaction. Local Stripe CLI webhook forwarding is a separate provider action; the brief's verification uses network-edge fakes, so no Stripe account is needed for CI. Real payment processing, delivery and refunds depend on your account and provider availability. Never expose a local development server to public traffic.

Keep the original Pier origin and Stripe account for each order. Reconfiguration does not move existing reservations, payment intents or shipments. Reconcile pending effects with their existing IDs. A refund never silently restocks a dispatched product: record the physical return/restock in Pier separately.

Stripe references: [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create), [webhook signatures](https://docs.stripe.com/webhooks/signature), [idempotent requests](https://docs.stripe.com/api/idempotent_requests), [refunds](https://docs.stripe.com/api/refunds/create).
