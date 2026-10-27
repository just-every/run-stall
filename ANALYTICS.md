# First-party reports

Open Reports in the native merchant desk. Choose inclusive shop calendar dates,
channel, product, variant SKU or customer, then inspect sales, traffic, best
sellers and contributing orders. Download CSV exports the same applied filters,
order and line amounts, references, source breakdowns, period and exclusions.

Privacy preferences on the shop start with analytics off. An explicit choice
against the current privacy policy enables first-party capture. Advertising
choices remain separate. Capture keeps only recognized campaign parameters,
referring hostname, a safe landing pathname, coarse device category and an
optional visitor-selected region. A region is unverified and never inferred
from an address. Browser identifiers are random HttpOnly cookies; no mailbox,
IP address, unrecognized query payload or raw referring URL enters the capture tables.
Known crawler and headless user agents, Stripe test credentials and demo mode are excluded.
Provider-identified test payments are labelled separately, outside live sales,
rankings and new conversion; their recorded amounts remain inspectable and exportable.

Sessions expire after 30 minutes of inactivity. A new non-direct source starts a
new session; a direct visit retains the last non-direct source for up to 30 days.
The daily-work report names this model and window. Captured events and sessions
are retained for at most 30 days, with the existing minute worker sweeping them.
Commercial orders retain minimized historical source labels after browser
correlation expires. Withdrawal removes that visitor's capture and order
attribution. Customer erasure also removes linked capture. Reusable browser
correlation never travels in commercial exports; a complete archive restores
historical observation with visitor and consent capabilities disabled.

Conversion is eligible paid live online orders linked to consented sessions
started in the same selected period, divided by those observed sessions.
Unlinked sales remain in commercial totals with unknown traffic attribution.
Two paid orders from one session can produce conversion above 100 percent.
Funnel stages count distinct sessions that reached each stage.
No observed sessions means unknown traffic, rather than a claim of zero visits.
Manual, historical, test, canceled and replayed records cannot create new
conversion. Refunds are succeeded amounts applied to their original sale;
reports are placement-date cohorts rather than a cash posting journal.

Costs are recorded under Settings for an exact reviewed paid order. Enable cost
reporting explicitly and enter actual total item cost, shipping cost and fees,
net of recoveries. A blank field remains unknown; zero means a recorded zero.
Contribution margin is net item sales plus net shipping collected, less those
three expenses. Catalog prices or current catalog costs never substitute for
historical cost facts. Gift liability and unrecorded tax remain unknown. Disable
cost reporting to make costs and margins unknown. Archive restore requires fresh
local cost consent. No accounting posting is inferred from tax references.

## Historical sales

The owner downloads the JSON example from Settings, selects a file, previews its
exact source, rows and totals, then explicitly applies that saved preview.
`GET /api/stall/analytics/history` documents the current format.
The schema is `stall-analytics-history-v1`, with a source and rows containing an
immutable sourceId, UTC createdAt, channel, merchandise lines, shippingCents,
taxCents, discountCents, totalCents, refundsCents and optional original processor
and accounting references. All monetary values are USD integer cents. Lines
supply SKU, parent product SKU, name, positive quantity and unitCents.
Positive refunds additionally require explicit refundTaxCents,
refundShippingCents and each line's refundedCents. Refunded quantities can remain
unknown. Gross amounts minus discounts plus tax and shipping must equal total;
refund allocations must reconcile exactly. No refund allocation is invented.

The same source and sourceId pair replays without another sale. Changed facts
under an existing identity, duplicated original processor references and known
live-order identities are refused. Imported sales create no live order, stock
reservation, session or payment. Import provenance remains visible in reports
and business exports. An imported reference is owner-supplied evidence, not a
processor or accounting-provider confirmation.

The adopted retention and report-access policy is pending ct approval; the
ANALYTICS-001 contract status therefore remains PARTIAL.
