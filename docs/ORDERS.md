# Orders, shipping and refunds

Open **Shop desk → Orders** as an owner or administrator. Each card shows the customer's details, purchased lines, exact AUD total and current state. Approvals apply to the saved revision you reviewed. If the order changes during review, refresh and review it again.

## Follow payment and stock

Customers select products at `/shop`, enter their email, select **Review order**, then **Pay … with Stripe**. Stripe hosts payment and collects delivery details. Card details never enter Stall. Returning to `/order` does not mark an order paid.

| State | What to do |
| --- | --- |
| **checkout pending** or **awaiting payment** | Payment is not confirmed. Use **Reconcile / retry pending work** to check the existing Stripe operation. |
| **paid** | Payment has been verified. Reconcile to complete or check the Pier reservation. |
| **shortfall** | Payment arrived, but stock could not be fully reserved. Receive or reallocate stock in Pier, then reconcile this order. |
| **reserved** | The paid order's stock is reserved in Pier. Prepare shipping. |
| **shipped** | Pier has confirmed dispatch. Review shipping or prepare a partial refund. |

Stall checks the verified payment's session, amount and currency before recording money and reserving stock. A paid shortfall can happen if stock changes while the customer pays. Keep working on the same order when resolving it.

## Ship a reserved order

1. Check the purchased lines and **Delivery address**.
2. Under **Prepare shipping**, enter a **Shipping reference**, such as your tracking reference, then select **Prepare shipping for approval**.
3. Review the saved **Shipping · draft** reference and order lines. Select **Approve shipping · revision …**.
4. Check for **shipped** and **Shipping has been confirmed by Pier.** If confirmation is pending, use **Reconcile / retry pending work**.

Approval dispatches the reserved lines through Pier. Stall does not book a courier, calculate shipping rates or print labels; arrange the physical delivery yourself.

## Refund one line

Refunds require a paid order with confirmed shipping. The desk prepares a partial refund for one line and quantity; the amount must be less than the order total.

1. Open **Prepare a one-line partial refund** on the shipped order.
2. Choose **Order line**, enter **Refund quantity** and a **Reason**, and inspect **Refund · …**. Stall checks the remaining unrefunded quantity and paid amount.
3. Select **Prepare partial refund**, then review the saved line, quantity, reason and amount.
4. Select **Approve … refund · revision …**. This records your approval and asks Stripe for that refund.
5. Check the refund state. **succeeded** confirms completion. Use reconciliation to retrieve a pending operation's latest result; resolve a pending refund before preparing another. For **failed** or **canceled**, inspect the existing operation in Stripe before deciding whether to prepare another refund.

A refund changes money only. Handle a physical return and any restock separately in Pier. **Activity** and **Payment, stock reservation & provider details** retain actors and provider references.

## Recover pending provider work

Use **Reconcile / retry pending work** on the existing order when a payment, reservation, shipment or refund needs attention. A recorded approval can remain pending while a provider is unavailable.

If Stripe completed an operation but its result was lost, inspect that operation in your Stripe account. Expand **Recover an existing provider operation**, verify the amount and order, and enter its existing Checkout session ID or select the saved refund and enter its Stripe refund ID. Select **Reconcile existing provider IDs**.

Keep the same order and provider operation. Creating a replacement to recover a timeout can create another payment or stock effect. Keep the original Stripe account and Pier origin for existing orders. For API recovery and retry limits, see [Commands and recovery](COMMANDS.md) and [Connections](CONNECTIONS.md).

Agents may prepare shipping and refund drafts. A signed-in person approves shipping and refunds and performs reconciliation.
