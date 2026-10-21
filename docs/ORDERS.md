# Orders, shipping and refunds

Open **Shop desk → Orders** as an owner or administrator. **Needs action** lists the orders waiting on a person (a stock shortfall, a shipping or refund draft to approve, a payment to reconcile); **All** lists every order. Select an order: its panel shows the customer's details, purchased lines, exact USD total, payment and current state, with the next step and its approval. Approvals apply to the saved revision you reviewed. If the order changes during review, refresh and review it again.

Order, payment, approval and shipment times show their time-zone abbreviation. The Orders page names the shop's saved business time zone (initially America/Chicago), so a Pier warehouse using another zone can show a different local time for the same moment.

## Follow payment and stock

Customers select products at `/shop`, enter their email, select **Review order**, then **Pay … with Stripe**. Stripe hosts payment and collects delivery details. Card details never enter Stall. Returning to `/order` does not mark an order paid.

| State | What to do |
| --- | --- |
| **checkout pending** or **awaiting payment** | Payment is not confirmed. Use **Reconcile** to check the existing Stripe operation. |
| **paid** | Payment has been verified. Reconcile to complete or check the Pier reservation. |
| **shortfall** | Payment arrived, but stock could not be fully reserved. Receive or reallocate stock in Pier, then reconcile this order. |
| **reserved** | The paid order's stock is reserved in Pier. Pick, pack and dispatch in Pier, or arrange delivery and prepare shipping in Stall. |
| **shipped** | Pier has confirmed dispatch. Review shipping or prepare a partial refund. |

Stall checks the verified payment's session, amount and currency before recording money and reserving stock. A paid shortfall can happen if stock changes while the customer pays. Keep working on the same order when resolving it.

## Ship a reserved order

Pier owns the stock and records dispatch. If you use Pier's warehouse workflow, pick, pack and dispatch the order there. In Stall select **Refresh shop**: the order moves to **Shipped** once all purchased units have dispatched, with Pier's shipment references, dispatch times, carrier tracking links and delivery status when Pier supplies them. The open desk also checks every minute. A partial dispatch stays unfulfilled and says **Partly shipped**; finish the remaining lines in Pier. Stall never sends another dispatch just to refresh this information.

Choose one place to dispatch each order. For delivery you arrange yourself, Stall offers this alternative:

1. Check the purchased lines and **Delivery address**.
2. Under **Prepare shipping**, enter a **Shipping reference**, such as your tracking reference, then select **Prepare shipping for approval**.
3. Review the saved **Shipping · draft** reference and order lines. Select **Approve shipping · revision …**.
4. Check for **shipped** and **Shipping has been confirmed by Pier.** If confirmation is pending, use **Reconcile**.

To change a prepared shipping reference or refund before approval, select **Edit** beside the approve button and prepare it again; the new draft replaces the old one. **Needs action** lists drafts the shop agent prepared first, each with its **Agent note**.

Approval dispatches the reserved lines through Pier. Stall prices shipping at checkout from your [shipping profiles](SHIPPING.md) and keeps the service, ZIP code and charge on the order; it does not book a courier, fetch live carrier rates or print labels, so arrange the physical delivery yourself.

Before preparing or approving, Stall checks Pier for an existing dispatch. An order already shipped there names its shipment instead of offering another shipment. A revoked or unrecognized connection key shows Pier's exact reason. After a Pier restore, create a new Stall key in **Pier → Channels**, then paste it into **Stall → Settings → Connect Pier**. If the restored Pier lacks an order or a dispatch Stall already recorded, restore its original business history before shipping again. When a refresh cannot check Pier, Orders shows the reason and clearly marks its shipment information as the last recorded state.

## Refund one line

Refunds require a paid order with confirmed shipping. The desk prepares a partial refund for one line and quantity; the amount must be less than the order total.

1. Open **More actions → Prepare a one-line partial refund** on the shipped order.
2. Choose **Order line**, enter **Refund quantity** and a **Reason**, and inspect **Refund · …**. Stall checks the remaining unrefunded quantity and paid amount.
3. Select **Prepare partial refund**, then review the saved line, quantity, reason and amount.
4. Select **Approve … refund · revision …**. This records your approval and asks Stripe for that refund.
5. Check the refund state. **succeeded** confirms completion. Use reconciliation to retrieve a pending operation's latest result; resolve a pending refund before preparing another. For **failed** or **canceled**, inspect the existing operation in Stripe before deciding whether to prepare another refund.

A refund changes money only. Handle a physical return and any restock separately in Pier. **Activity** and **Payment, stock reservation & provider details** retain actors and provider references.

## Recover pending provider work

Use **Reconcile** on the existing order when a payment, reservation, shipment or refund needs attention. A recorded approval can remain pending while a provider is unavailable.

If Stripe completed an operation but its result was lost, inspect that operation in your Stripe account. Expand **More actions → Recover an existing provider operation**, verify the amount and order, and enter its existing Checkout session ID or select the saved refund and enter its Stripe refund ID. Select **Reconcile existing provider IDs**.

Keep the same order and provider operation. Creating a replacement to recover a timeout can create another payment or stock effect. Keep the original Stripe account and Pier origin for existing orders. For API recovery and retry limits, see [Commands and recovery](COMMANDS.md) and [Connections](CONNECTIONS.md).

Agents may prepare shipping and refund drafts. A signed-in person approves shipping and refunds and performs reconciliation.

An owner or administrator can select the business time zone in Settings → Shop time zone. Timestamps remain UTC in storage and exports; the desk uses the selected IANA zone and the offset at the event, including daylight saving time.

On an order, choose active staff under Responsible staff and save the assignment. Unassign there to remove the current responsibility. Assignment history keeps who changed it and when; a stale order must be refreshed before saving. Assignment gives no additional access. Archives and business exports retain this history, while a restored installation keeps its own people and permissions.

Above the status tabs, **Order filters** narrow the list by the date the order was placed (From and To, both days included), by item SKU, and to **Overdue partly shipped** orders. They combine with the status tab and the search box. Dates are calendar days in the shop's saved time zone, so an order placed late in the evening there counts on that evening's date even when its UTC date is the next day. An order is overdue when Pier shipped only part of it and Pier's latest recorded dispatch is more than 7 × 24 hours old (an unstamped dispatch counts from payment); the label never changes the order. Signed-in owners and administrators can read the same filters at `GET /api/stall/orders?from=&to=&sku=&customer=&status=&channel=&overdue=partial`, which accepts any subset.

Select **Full order history** in an order's panel to see every audited action on it (checkout, payment, stock, shipping, refund and assignment) with who and when, oldest first, plus the Stripe and Pier references the order keeps (`GET /api/stall/orders/history?orderId=`). It is a record of what Stall observed, not proof of delivery.

## Record a sale already paid outside Stall

An owner or administrator selects **Record paid sale**, chooses published items and quantities at their current USD prices, and enters the customer's email, name and US delivery address. Choose cash, check, bank transfer or other, the received date in the shop zone, and an optional reference. Review the exact total including configured shipping, then select **Record paid sale**. A changed price or shipping charge requires a fresh review. Keep the form and its original retry identity if a response is lost; reconcile the existing order rather than creating a replacement sale.

**Payment recorded by staff, not confirmed by a payment provider.** The recorded amount must equal the order total, and its received date cannot be in the future. Stall sends no confirmation or receipt and records `no_tax_recorded`. It reserves stock in Pier with the same recovery and shortfall handling as a storefront order. Pier receives the merchandise order and reservation, without Stripe payment evidence or your payment reference. The current Pier connector's Stripe feed excludes these staff records; the reservation and dispatch remain in Pier Orders.

Shipment approval is unchanged. On a shipped manual order, prepare and approve item, shipping or goodwill refunds under the same purchased-quantity and remaining-value limits. **Refund recorded by staff; Stall moved no money.** No processor is contacted. Orders awaiting payment, custom lines, discounts and payable invoices remain unimplemented.

## Internal notes and tags

Only signed-in owners and administrators can read or write **Internal notes and tags**. Notes are append-only, with author and time; add a correction as another note. The owner can redact a note with a reason. Each note holds up to 2,000 characters; each order has up to 50 tags of up to 40 characters. These actions appear in **Full order history** and owner business exports and archives. Members, agents, shoppers and providers never receive these annotations. Customer erasure replaces note text with an attributable placeholder and removes tags and the manual payment reference, including from subsequent restored archives. It does not find text on another customer's order.

The **Channel** filter combines Online store or Manual with the other filters. Customer search matches retained email or recipient name without a separate index, across every order. Search and history endpoints require a signed-in owner or administrator; agent credentials use the existing commerce state/draft doors with internal annotations removed. Saving a new time zone relabels existing orders and date filters from the next request, without rewriting UTC times. Calendar-day filters include the whole 23- or 25-hour day across daylight saving transitions.
