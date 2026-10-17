# Stall

![Stall](public/brand/mark.svg)

Your stall never closes. Stall is a free, open source online shop for US makers and small shops whose stock lives in [Pier](https://github.com/just-every/run-pier). Today it publishes products, takes payment in US dollars through your own Stripe Checkout, reserves stock in Pier, ships and makes partial refunds, with a recorded approval at each step. The [product contract](CONTRACT.md) is the Shopify replacement it is being built towards; [first-release scope](ACCEPTANCE.md) is what runs now. MIT licensed.

[Read the owner guides](docs/README.md): [getting started](docs/GETTING-STARTED.md), [products](docs/PRODUCTS.md), [orders, shipping and refunds](docs/ORDERS.md), [Shopify move-in](docs/MOVE-IN.md), and [backup and restore](docs/BACKUP-RESTORE.md).

**The run site is at https://run-stall.com**, with the run page at https://run-stall.com/run. To see it locally, run `rer dev` and open `/run` on the run-site address RER prints as `RER_SITE`; its port can differ from the app's `RER_READY` port. A domain purchase does not block running or deploying your own shop.

## From clone to app

Two lines, the same as [run-stall.com/run](https://run-stall.com/run), on macOS, Linux or Windows with WSL2, with git installed. First install rer, the tool that runs Stall. It brings its own Node if you have no Node 22 or later:

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
```

Then start Stall. rer clones it, installs everything, makes you the owner and prints a link that opens Stall signed in:

```sh
rer dev just-every/run-stall
```

Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-stall` does both in one line. If the installer prints an `export PATH=…` line, run it before the second line. To start Stall again later, run `cd run-stall && rer dev`.

RER installs the pinned dependencies and Node 22.20.0, builds and migrates local D1, prepares the local owner, and starts the app. Allow several minutes on the first run. Open the private `RER_OPEN` link in the terminal, then select **Finish setup**. Keep that link private. Open `/app` on the `RER_READY` origin for the shop desk, and `/shop` for the customer storefront. Repeat `rer dev` after an interruption; it resumes. Stop with `rer dev --stop` or Ctrl-C. Use `rer dev --port 8899` if another checkout occupies your saved app port.

To claim the install with your own mailbox, run `npx -y @runeditrun/rer setup just-every/run-stall --owner-email you@example.com` in place of the start line, then `cd run-stall && rer dev`. Development mail is suppressed. Use the private `RER_OPEN` owner entry locally; ordinary invitations require a hosted installation with configured mail. The owner may invite administrators or members through Base's `/auth/invite` API (see [commands](docs/COMMANDS.md)); only owners/admins manage shop records, and members cannot use the desk APIs.

A fresh installation contains no invented stock, products, orders or payment provider. The desk shows which connections are missing. Your local app works without a domain or paid provider account; a purchase needs the real connections below. Tests exercise the whole purchase flow with fakes only at external network edges.

## First shop journey

1. [Connect Pier and Stripe](docs/CONNECTIONS.md). In Pier, have two stocked, sellable SKUs and one customer representing the online shop. Pier remains the stock authority; Stall never copies inventory balances.
2. In **Move in**, paste or upload your [Shopify product CSV](docs/MOVE-IN.md). Use the [documented-shape synthetic fixture](fixtures/shopify-products.csv) to understand the columns; its SKUs must exist in your Pier installation before publication. Preview, inspect the rows and fingerprint, then explicitly apply. Imported listings stay unpublished. Open the import journal to inspect or undo untouched work.
3. In **Products**, [prepare the name, description and price](docs/PRODUCTS.md) in dollars and cents, then review and approve the exact revision. For an imported product, select **Edit product**, enable **Available for publication** and prepare a revision first. A price change creates another draft; an existing published listing keeps its approved price until the new draft is approved. Publication validates the Pier SKU.
4. Open `/shop` as a customer, choose quantities of two in-stock products, enter an email and select **Review order**. Check the USD total, then select **Pay … with Stripe** to open Stripe's hosted payment page. A return URL alone never marks an order paid: Stall asks Stripe (or, for an online shop, a signed webhook tells it) and checks the exact session, amount and currency.
5. Back in **Orders**, reconcile the paid order. It records a Pier reservation, or a visible shortfall if stock changed while the customer paid. Resolve a shortfall in Pier and reconcile again. Prepare shipping with a tracking/reference, inspect it, then approve. Shipping dispatches Pier's reserved lines once.
6. After shipping is confirmed, prepare a partial refund for one line, inspect the amount and reason, then approve that revision. Reconcile pending provider results. A refund changes money, not stock; a physical return and restock stay in Pier. The history records approvers and provider references. [Orders, shipping and refunds](docs/ORDERS.md) · [Commands and recovery](docs/COMMANDS.md).

## Agent preparation and data

The owner grants a short-lived preparation credential in **Settings → Agent access**, copies it once into their agent's secret store and can revoke it there. [The agent API](docs/COMMANDS.md) prepares product, shipment and refund drafts. It cannot approve, export, erase, restore, grant access or spend. Approvals require a current native human session and the exact reviewed revision.

In **Settings → Your installation, your data**, export a private archive or restore one into an empty installation. The [backup and restore guide](docs/BACKUP-RESTORE.md) covers the desk controls, archive contents and customer erasure. CLI backups also work; stop the app first:

```sh
rer dev --stop
rer export --output exports/stall.rer
```

Restore into a fresh clone of the same revision, before entering shop data:

```sh
rer install
rer import --input /private/path/stall.rer --yes
rer setup
rer dev
```

Products, orders, recorded approvals, stock/payment references and import custody travel. The destination keeps its own owner identity. Authentication records, sessions, sign-in links, agent credentials, private configuration and local mail do not travel. Re-enter the original provider configuration and sign in again. Never restore a financial archive into a second live shop against the same providers: use one active installation.

**Erase customer details** removes the mailbox, shipping address and checkout fingerprint from matching orders and preserves anonymous commercial history. Orders must be shipped and pending refunds resolved first. Stripe, Pier and previously downloaded archives are separate custody. Protect or retire old backups yourself. When restoring an older backup, pass a trusted post-erasure archive as the journal: `rer import --input OLD.rer --journal LATER.rer --yes`. A destination or later journal that knows the erasure refuses the older archive; an offline old copy cannot discover later erasures. Damaged archives and nonempty destinations are refused. `rer reset --yes` destroys local state and settings, so export first if needed.

## Deploy your shop

Use your own **RunEditRun Cloudflare account** for this seed's deployment. A workers.dev origin is sufficient; purchasing run-stall.com is not required. The stable project, Worker and D1 declarations are in `deploy.json` and `wrangler.jsonc`. Supply a Workers/D1-scoped `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `OWNER_EMAIL`, a random `SESSION_SECRET`, a random `SETUP_TOKEN`, and `MAIL_API_KEY` from a secret manager. Set `MAIL_FROM` in `deploy.json` to your verified Resend sender. The Pier and Stripe variables in [Connections](docs/CONNECTIONS.md) are optional: without them the shop deploys and its Connections section shows Setup required; add them later with `rer deploy --set-secret NAME`. Keep values out of commands, Git and logs. Commit the intended configuration; deploy refuses dirty tracked files.

```sh
rer deploy --dry-run
rer deploy
```

Dry run validates and builds with zero provider requests. Real deploy provisions its Worker/D1, applies migrations, uploads the declared secrets, checks deployment health and claims the configured owner. Open the returned origin. Use email sign-in or `rer signin` from the checkout for the recorded hosted owner, then finish setup. Register that origin's `/api/stall/webhook` in Stripe and test in Stripe test mode before accepting live orders. Real provider delivery and account configuration are separate from the local/CI proof. `rer deploy --site` publishes the run site at run-stall.com from GitHub Actions; you do not need it to run your own shop.

## Development and verification

Package mode pins `@runeditrun/rer` **0.2.34**. This seed starts from the committed Base foundation `ada9f574d8a7247edc3a1180b593ad182b1fbb37`. [Source reuse](docs/SOURCES.md), [operations contract](SEED-COMMAND-CONTRACT.md), [agent guide](AGENTS.md).

```sh
rer check --profile first-party
pnpm test:api
rer verify
```

Verify shards auth/data/money, move-in, source/type checking, and the emitted Worker plus hosted assets/hydration in parallel on GitHub. Build and deploy never run tests. Browser/installer journeys run on release tags and nightly. The lane runs the separate stranger check after this round.
