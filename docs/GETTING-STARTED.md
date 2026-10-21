# Getting started with Stall

Start beside your existing shop with two products and a Stripe test payment. A fresh Stall installation has no sample products, stock or orders. You can open the desk before connecting providers; purchases need both Pier and Stripe.

## Open your local installation

Two lines, the same as [run-stall.com/run](https://run-stall.com/run), on macOS, Linux or Windows with WSL2, with git installed. First install rer, the tool that runs Stall. It brings its own Node if you have no Node 22 or later:

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
```

Then start Stall. rer clones it, installs everything, makes you the owner and prints a link that opens Stall signed in:

```sh
rer dev just-every/run-stall
```

Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-stall` does both in one line. If the installer prints an `export PATH=…` line, run it before the second line. To start Stall again later, run `cd run-stall && rer dev`.

RER prepares the checkout, dependencies, database and local owner. The first run can take several minutes. If interrupted, run `rer dev` again to resume.

Open the private **RER_OPEN** link printed in the terminal. At **Finish setup**, review the owner's name and email, tick **I confirm this owner account is ready to use.**, then select **Finish setup**. Treat the entry link as a credential. Development email is suppressed, so use that link for local owner access.

Use the **RER_READY** origin for `/app` (your Shop desk) and `/shop` (the customer shop). For the local run site, open `/run` on the **RER_SITE** origin; its port can differ from the app port. The public run site is at https://run-stall.com, and you do not need a domain to try Stall.

Stop the app with `rer dev --stop` or Ctrl-C. The [full local reference](../RUN-LOCALLY.md) covers owner configuration and other commands.

## Connect stock and payment

1. In Pier, have two active, stocked, sellable SKUs and an existing customer representing this online shop. Keep each SKU identical in Pier and Stall.
2. Follow [Pier and Stripe connections](CONNECTIONS.md) to connect Pier and your Stripe test key from **Settings → Provider connections**. A shop on this computer needs no webhook; an online shop adds its signed webhook. Keep credentials private.
3. At **Settings → Provider connections**, check **Pier stock**, **Stripe checkout** and **Payment confirmations**. The **Configured** indicators show that configuration is present; confirm the connections by completing a test order.

Pier owns stock, reservations and dispatch. Stall owns listing names, descriptions and USD prices. Stall checks Pier at publication and checkout, and reserves stock after verified payment. Stock can change during payment, leaving a visible shortfall to resolve in Pier.

## Prepare two products

Use **Products** to [prepare and publish each product](PRODUCTS.md), or use **Move in** to [import a Shopify product CSV](MOVE-IN.md). Imported products remain unpublished. Review their details and separately prepare and approve publication before opening the customer shop.

## Take a test order

1. Open `/shop`, choose whole quantities of your published products and enter **Email for your order**.
2. Select **Review order**, check quantities and **Total · USD**, then select **Pay … with Stripe**.
3. Complete payment using your Stripe test setup. Returning to Stall does not confirm payment: Stall verifies the Stripe session, amount and currency before recording it.
4. At **Shop desk → Orders**, select **Reconcile** when it shows (it appears only while payment, stock or a provider result is still pending). Continue when the order is **reserved**. Resolve a **shortfall** in Pier, then reconcile the same order.
5. Prepare a shipping reference, review the saved draft and approve shipping. Check for **shipped**, then try a one-line partial refund. The [orders guide](ORDERS.md) explains each step and pending results.

Before relying on the installation, [save a private backup](BACKUP-RESTORE.md). For hosting, see [Deploy your shop](../README.md#deploy-your-shop); a workers.dev origin is sufficient.

## Business time

Stall initially displays shop activity and approvals in US Central time
(America/Chicago), including the time zone beside each time. In Settings → Shop
time zone, an owner or administrator can save the IANA zone for the business.
Original timestamps and exports remain UTC; display offsets follow the event's
daylight-saving rules.

## Invited people in local development

After the owner invites someone, the local sign-in page lists their name beside
the owner's entry. Choose **Continue as** for that person. This accepts the
current invitation and opens their real account with its assigned role. The
same private development entry is required; canceled invitations stay closed.
No outbox link or email delivery is needed in development or demo mode.
