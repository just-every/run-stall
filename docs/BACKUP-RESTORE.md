# Backup, restore and customer details

Stall archives contain business records and customer information. Store them privately. Products, orders, recorded approvals, provider references and import custody travel with an archive. Authentication records, sessions, sign-in links, agent credentials and private configuration do not. A destination keeps its own owner and authentication records.

## Download a backup from the desk

1. Sign in as the owner and open **Shop desk → Your data**.
2. Select **Prepare export download**. If shown, select **Continue preparing export** until the transfer is complete.
3. Select **Download archive** and keep the downloaded `stall.rer` in private storage. Use dated filenames when keeping multiple backups.

Take another backup after changes you need to preserve. An archive does not back up the separate data held by Stripe or Pier.

## Restore through the desk

Use an installation with no product or order data. Restore refuses a nonempty destination and verifies the archive before completing the transfer.

1. Sign in as the destination's owner and open **Your data → Restore an archive into this empty installation**.
2. Select **Choose archive** and open your complete archive.
3. Expand **Review archive manifest**. Check its source and contents, then tick **I have reviewed this archive and confirm restoring it into this empty installation.**
4. Select **Restore reviewed archive**. Wait for the restored notice and review the records.
5. Configure provider secrets separately and sign in as needed. Check **Connections** before taking orders.

For existing orders, retain the original Pier origin and Stripe account. Use one active shop against those providers; a second live copy can act on the same payments or stock. A restore does not transfer provider accounts or their credentials.

## Local command-line backup and restore

From your checkout, stop the app before a local CLI transfer:

```sh
rer dev --stop
rer export --output exports/stall.rer
```

If preview is running, stop it with `rer preview --stop` too. Keep the archive in private storage. See [Run locally](../RUN-LOCALLY.md) for supported export paths.

To restore into a fresh checkout of the same revision, before entering shop data:

```sh
rer install
rer import --input /private/path/stall.rer --yes
rer setup
rer dev
```

Use setup's prompt to establish the destination owner and configuration. Re-enter provider credentials separately; they are excluded from the archive. Open the private `RER_OPEN` link and complete owner setup when required. These CLI transfers operate on local installation data; the maintained CLI does not support remote transfer.

`rer reset --yes` destroys the local installation and settings. Restore needs an empty destination, but using a fresh checkout avoids resetting your working shop. Read the exact reset inventory and save any needed archive before choosing a reset.

## Erase a customer's details

As owner, open **Your data → Erase customer details**, enter **Customer email** and select **Review customer erasure**. Review the mailbox, type `ERASE` and select **Permanently erase customer details**.

This removes the customer's retained email, delivery address and checkout request identifiers from matching Stall orders. Anonymous commercial, stock, shipping and approval history remains. Orders must be shipped and pending provider work resolved first. Erasure cannot be undone.

Stripe, Pier, sign-in identity and previously downloaded archives are separate custody. Handle those records separately, and protect or retire old backups. Take a new archive after erasure so you retain the current erasure journal.

When restoring an older backup with the CLI, provide a trusted later archive that includes the erasure journal:

```sh
rer import --input /private/path/older.rer --journal /private/path/after-erasure.rer --yes
```

A destination or later journal that knows about the erasure refuses an older conflicting archive. An offline old copy cannot discover later erasures by itself. The desk restore form has no separate journal selector; use the CLI when you need to supply a later journal.
