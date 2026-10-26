# Grounded merchandising proposals

Open a product in Products, approve its merchant facts, then open Merchandising
proposals. Grant a personal agent credential in Settings. The credential can
prepare proposals; a signed-in owner or administrator reviews and publishes.

The agent reads `GET /api/stall/merchandising?sku=SKU` with its Bearer credential.
The source bundle contains approved catalog text, image descriptions, variant
choices and manual collections. It excludes customers, private costs and
credentials. Image citations describe the merchant's uploaded image; they do
not establish unseen details or certifications.

Submit `merch.prepare` to `POST /api/stall/commands`. Its payload has `sku`, the
bundle's `revision`, and `changes`. Each change has `field`, `value` and
`citations` containing source IDs. The optional `target` identifies an image,
attribute label or collection handle. Supported fields are `name`,
`description`, `alt`, `attribute`, `seoTitle`, `seoDescription`, `collection`
and `channel`.

Text uses the cited values exactly, joined with ` · ` in citation order.
Attribute values retain the cited fact's label. A collection change names its
existing manual collection in both `target` and `value`, citing
`collection:HANDLE`. A channel change uses `google_product` and cites `sku`;
Stall derives the variant IDs, price, image and page mapping from approved
product data. The validator reads timestamped availability from the existing stock authority.
No quantity or availability is invented. It reports missing current inventory
evidence, provider refusal and any missing required image or description. No external channel is connected or submitted.

Missing size, material and safety facts remain unanswered questions. Optional
`requests` may name `inventory`, `certification` and `reviews`; these are
recorded as refused requests. An unsupported field, absent citation or new
claim is rejected. Correct the merchant facts and approve them before asking
the agent for a new proposal.

In the product panel, select changes and preview them. Changing the selection
requires a new preview. Approve publishes only that selected revision; sources
and collections are checked again inside the same transaction. A changed source
requires a new agent proposal. Approval is human-only and audited, and revoking
the credential stops subsequent reads and preparation.

Proposals and their source citations are included in owner-only business exports
and installation archives. Restored proposals are history: their previous
approval cannot authorize a new publication, and agent credentials never travel.
Customer facts and customer feedback text are not proposal sources. Future
measured feedback can inform preparation only; it does not grant publication
authority. Connected channel publication remains the relevant channel clause's
obligation.
