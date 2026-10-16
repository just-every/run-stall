# Getting started with Stall

Start beside your existing shop with two products and a Stripe test payment. A fresh Stall installation has no sample products, stock or orders. You can open the desk before connecting providers; purchases need both Pier and Stripe.

## Open your local installation

Install Git and Node 22 or newer, then run:

```sh
npx -y @runeditrun/rer cli install
export PATH="$HOME/.local/bin:$PATH"
git clone https://github.com/just-every/run-stall.git
cd run-stall
rer dev
```

RER prepares the checkout, dependencies, database and local owner. The first run can take several minutes. If interrupted, run `rer dev` again to resume.

Open the private **RER_OPEN** link printed in the terminal. At **Finish setup**, review the owner's name and email, tick **I confirm this owner account is ready to use.**, then select **Finish setup**. Treat the entry link as a credential. Development email is suppressed, so use that link for local owner access.

Use the **RER_READY** origin for `/app` (your Shop desk) and `/shop` (the customer shop). For the local run site, open `/run` on the **RER_SITE** origin; its port can differ from the app port. `run-stall.com` is not registered yet. You do not need to buy a domain to try Stall.

Stop the app with `rer dev --stop` or Ctrl-C. The [full local reference](../RUN-LOCALLY.md) covers owner configuration and other commands.

## Connect stock and payment

1. In Pier, have two active, stocked, sellable SKUs and an existing customer representing this online shop. Keep each SKU identical in Pier and Stall.
2. Follow [Pier and Stripe connections](CONNECTIONS.md) to configure Pier, your Stripe test key and the signed webhook. Keep credentials private. Restart the app after changing local configuration.
3. At **Shop desk → Connections**, check **Pier stock**, **Stripe checkout** and **Stripe webhooks**. The **Configured** indicators show that configuration is present; confirm the connections by completing a test order.

Pier owns stock, reservations and dispatch. Stall owns listing names, descriptions and AUD prices. Stall checks Pier at publication and checkout, and reserves stock after verified payment. Stock can change during payment, leaving a visible shortfall to resolve in Pier.

## Prepare two products

Use **Products** to [prepare and publish each product](PRODUCTS.md), or use **Move in** to [import a Shopify product CSV](MOVE-IN.md). Imported products remain unpublished. Review their details and separately prepare and approve publication before opening the customer shop.

## Take a test order

1. Open `/shop`, choose whole quantities of your published products and enter **Email for your order**.
2. Select **Review order**, check quantities and **Total · AUD**, then select **Pay … with Stripe**.
3. Complete payment using your Stripe test setup. Returning to Stall does not confirm payment: Stall verifies the Stripe session, amount and currency before recording it.
4. At **Shop desk → Orders**, select **Reconcile / retry pending work** when needed. Continue when the order is **reserved**. Resolve a **shortfall** in Pier, then reconcile the same order.
5. Prepare a shipping reference, review the saved draft and approve shipping. Check for **shipped**, then try a one-line partial refund. The [orders guide](ORDERS.md) explains each step and pending results.

Before relying on the installation, [save a private backup](BACKUP-RESTORE.md). For hosting, see [Deploy your shop](../README.md#deploy-your-shop); a workers.dev origin is sufficient.

## Business time

Stall displays shop activity and approvals in Australia/Perth time, including
the time zone beside each time. Set `businessTimeZone` in
`src/stall/ui/presentation.tsx` to the IANA time zone for your business.
