# Staff permissions

The owner invites an account from Settings → Staff permissions (native email sign-in), then gives it one shop role. Native owner and administrator sign-ins keep their existing shop authority. Product grants do not change identity-provider control or native account administration.

| Shop role | Current workflows |
| --- | --- |
| Catalog | Product drafts and publication, media, collections, bulk product import and undo |
| Fulfillment | Order search/history, internal notes/tags, assignment, shipping drafts/approval, packing slips |
| Customer support | Order search/history, internal notes/tags |
| Marketing | Menus, search synonyms/pins and search report |
| Finance | Orders, already-paid manual sales, refund drafts/approval within the configured limit |
| Administrator | All of the above plus shop/shipping settings and operations |

Connection custody, business exports/restore, erasure, note redaction and grant management keep their existing owner restrictions. No staff response contains a provider key. Finance receives no internal notes/tags or manual payment reference. Catalog and marketing receive no orders. Every route checks its own operation, including direct JSON calls and import jobs. A grant revision fences writes already in progress; changing or removing a grant invalidates earlier approvals at their next effect. Native sign-in revocation is checked independently.

The owner configures a USD refund ceiling and whether another person must approve. New functional grants default to zero refund authority and separation enabled. Native administrators retain their existing behavior until the owner configures their refund controls. The owner can always approve; limits never turn a draft into a provider payment automatically.

A signed-in account with no staff grant can use `GET /api/stall/customer/orders` to see minimal purchase summaries for its verified native email only. Query parameters cannot select another customer. Notes, payment references, checkout credentials and private history never enter that response. This is the conservative customer identity default pending ct approval; CUSTOMER-001 still owes the broader account experience.

Staff authority is installation-local and does not travel in a restore archive. Personal agent credentials remain draft-only under AGENT-001; external storefront app credentials belong to API-001 and have separate scopes and revocation.
