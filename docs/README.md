# Stall guides

Stall is a shop of your own for a US maker or small shop whose stock lives in Pier. Customers pay through your Stripe account; you manage products, orders, shipping and refunds at the Shop desk.

| Start here | What it covers |
| --- | --- |
| [Getting started](GETTING-STARTED.md) | Run locally, finish setup, connect providers and take your first test order. |
| [Products](PRODUCTS.md) | Prepare a product, publish the reviewed revision and change a listing. |
| [Collections, menus and search](SHOPFRONT.md) | Group products, build menus, tune search and read the search report. |
| [Orders, shipping and refunds](ORDERS.md) | Follow payment and stock, approve shipping, refund a line and recover pending work. |
| [Move in from Shopify](MOVE-IN.md) | Prepare the supported CSV, review and apply an import, resume or undo it. |
| [Backup and restore](BACKUP-RESTORE.md) | Download an archive, restore into an empty installation and handle customer erasure. |

The Shop desk is at `/app`; customers shop at `/shop`. Owners and administrators manage shop records. In **Settings**, the archive (**Your installation, your data**), customer erasure and agent credentials are available to the owner.

For connection and technical details:

- [Pier and Stripe connections](CONNECTIONS.md) — private configuration, webhook setup and provider responsibilities.
- [Agent commands, approvals and recovery](COMMANDS.md) — API payloads, permissions and provider recovery.
- [Run locally](../RUN-LOCALLY.md) — the complete RER command and installation reference.
- [First-release scope](../ACCEPTANCE.md) — the supported shop journey and its boundaries.
- [Source reuse](SOURCES.md) — the foundations Stall uses.

The public run site is at https://run-stall.com. To see it locally, follow the [README's local `/run` entry](../README.md#from-clone-to-app). A domain purchase is not needed to run your own installation.
