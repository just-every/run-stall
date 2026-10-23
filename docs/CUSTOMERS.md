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

## Consent and privacy HTTP slice

CUSTOMER-002 remains PARTIAL. There is no consent-capture or banner UI, delivered-message unsubscribe, geolocation, installed pixel or connected marketing adapter in this slice. The defaults below await ct approval.

Verified customers GET or POST `/api/stall/<source>/consent`, where source is `account`, `checkout`, `newsletter`, `contact` or `popup`. POST requires both `{emailMarketing:boolean,smsMarketing:boolean}`; no identity/source/timestamp may be supplied. The trusted route records source, current policy version and a stable append sequence. Email and SMS withdrawals are separate from necessary order notices. Explicit new native opt-in may lift that channel's local suppression; an import cannot. No capture sends mail or updates an outside provider.

Owner/admin POST `/api/stall/customers/consent/import` with 1–200 `{email,channel,status,proof?}` records. Status is `subscribed`, `unsubscribed` or `unknown`; affirmative records require `proof:{source,at,reference}` with a nonfuture timestamp. These are labelled owner-supplied proof, never provider verification. Unknown means unsubscribed. A prior withdrawal or erasure suppression prevents imported affirmative history from reactivating a channel.

Anonymous GET/POST `/api/stall/privacy` uses only an essential, opaque HttpOnly preference cookie. POST requires `{policyVersion,analytics,advertising,doNotSellOrShare,region?}`. All categories start denied until explicitly selected against the current version. `Sec-GPC: 1` forces advertising refusal and Do Not Sell or Share, persisting both. The result contains Google Consent Mode values but injects no Google script or other pixel and sends no conversion event. Region is visitor-selected and explicitly labelled unverified; automatic region determination remains unimplemented. Existing choices never authorize replay of old events. Archives keep historical visitor choices without restoring their cookie authority.

Owner/admin GET/POST `/api/stall/privacy/config` reviews and saves `{revision,mode,optInRegions}`. Modes are `notice_opt_out` (US default) and `opt_in`; a listed region uses opt-in. Changes advance the policy version, so prior choices revert to denied until reviewed again. Preference cookie values and identity authority are excluded from business exports.

GET `/api/stall/account/export` returns only the verified mailbox's own account and consent history, excluding all staff annotations and other mailbox records. POST `/api/stall/account/privacy-requests` with `{kind:'export'|'erasure'}` creates audited owner work with retained financial order IDs and explicit separate Stripe/Pier follow-up. This request sends no provider command and performs no automatic account or financial deletion. Customers GET their own requests; owner/admin GET `/api/stall/customers/privacy-requests` for review. The existing owner-confirmed erasure command scrubs consent/contact data, marks erasure requests complete and keeps channel suppression hashes. An old backup with the later erasure journal is refused instead of reactivating marketing or contact data.

Future STORE-003, MARKET-001, RECOVERY-001, MAIL-001 and CHANNEL-003 doors must use these current verified-channel, suppression and policy gates. There is currently no downstream suppression delivery claim.
