# Customer HTTP doors

These are production HTTP doors for an API slice. Stall does not yet ship a customer directory or account screen. This slice remains CUSTOMER-001 PARTIAL, including the invitation and identity defaults pending ct approval.

Every door uses the installation's native session cookie. A supplied email, account ID, imported password, matching name or integration/agent bearer token cannot become customer authority. Customers are invited by the owner using native account administration, verify their email through the one-use invitation and recover access using the existing `/signin` email-link flow. Public self-registration is unavailable.

## Merchant directory

A human owner/admin or customer-support staff member can GET `/api/stall/customers`. Only owner/admin may POST `/api/stall/customers/import/preview` with `{rows:[{email,name,tags}]}` and apply the identical input to `/api/stall/customers/import/apply` with the returned `fingerprint`. Imports accept 1–200 rows. Normalized exact emails deduplicate; repeated rows are skipped with their duplicate counts. Similar names never merge automatically and importing never creates a login.

POST `/api/stall/customers` supports:

- `profile.save`: `id`, current `revision`, `name`, `tags` (at most 50).
- `note.add`: `id`, current `revision`, `text` (at most 2,000 characters; 200 retained notes). Notes are merchant-only plain text with actor/time.
- `merge`: source `id`/`revision`, `targetId`/`targetRevision`, owner/admin only. Tags, notes and directory email associations combine; stale revisions refuse the entire transaction. This changes no native identity, order contact or customer address custody.
- `segment.save`: optional `id`/`revision` and `segment:{name,tag,minimumSpentCents,minimumOrders,state}`. Conditions combine with AND. State/province is a two-letter code observed on a paid order or saved address. Every directory read recalculates membership.

Directory order count is the number of orders with recorded payment, excluding erased contacts. Lifetime value is their paid USD total in integer cents minus succeeded refunds. Pending/draft refunds do not reduce it. A staff-recorded payment remains labelled as such in its order; the aggregate does not certify processor verification.

## Independent customer account

GET `/api/stall/account` returns the verified mailbox's orders newest first, saved addresses and return/cancellation requests. GET `/api/stall/account/orders/<id>` refuses another mailbox's order with 404, including after a directory merge. Private staff notes/tags, request fingerprints, provider credentials and payment authority are excluded. Gift balance capability is explicitly unavailable.

POST `/api/stall/account/addresses` with `{address:{name,line1,line2,city,state,postal_code,country}}` creates an address. Countries currently supported by this address book are US and CA; saving a Canadian address does not claim Canadian checkout/delivery readiness. For updates supply `id`, current `revision` and `address`; DELETE with `id`/`revision` removes it. Maximum 20 addresses per verified mailbox. Foreign IDs, stale revisions, caller-asserted identity and foreign mutation origins are refused.

Owner business JSON exports include `customerDirectory` profiles, email associations, addresses and segment definitions. Archives carry these commercial records without authentication sessions. Restoring cannot reuse a source session. Owner customer erasure removes the mailbox's addresses and association and clears shared directory names, tags and notes; remaining commercial/financial erasure rules are unchanged. Internal directory notes are excluded from customer-facing account responses.
