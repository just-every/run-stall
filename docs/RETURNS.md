# Returns, exchanges and cancellations

Customers ask for a cancellation, a return or a size or variant exchange from their order page. The owner publishes the policy, a person decides each request, and the customer reads the explanation and progress. Nothing here refunds, cancels, restocks or ships by itself.

## The policy

Settings → Return policy holds one policy: the return window in days after dispatch, the required condition, a return fee shown to shoppers, who pays return shipping, final-sale SKUs and whether exchanges are offered. Only a native owner or administrator changes it, against its current revision. `GET /api/stall/return-policy` shows it to anyone. Until it is published, shoppers cannot request returns or exchanges. Cancellation before fulfillment starts needs no policy. The fee is information: it is applied only when staff record the refund through the order.

## What a customer can request

A signed-in account (the verified native email) or a private order link opens one paid order. `GET /api/stall/returns/eligibility?orderId=` returns the policy, whether cancellation is still possible and, for each purchased line, how many units can still be requested, the rule that refuses it (final sale, the window that ended on a date, not yet shipped, already requested or refunded) and, when exchanges are offered, the in-stock variants of the same product. A private link passes its token in the `X-Stall-Order-Token` header.

`POST /api/stall/returns/requests` takes `{orderId,kind,lines,note}`. Kinds are `cancellation` (whole order, only before fulfillment starts), `return` and `exchange` (each line has a SKU, quantity, reason and, for an exchange, the replacement SKU). The server checks every line again. A repeated request for the same order, kind and lines returns the same case. Another customer's order or link answers not found. Requests carry text only: there is no attachment door, so there are no attachments to protect. The first return or cancellation of an order also writes the existing intake record, so a configured workflow rule still creates its task.

## The decision

`/app#requests` lists every case, newest decision needed first, whether or not a workflow rule exists. Only a native owner or administrator decides, never an agent credential, a score or a rule. Each decision needs an explanation the customer reads. Accepting a cancellation, a return or a refusal records the decision and moves no goods, money or order state. Accepting an exchange sets the replacement aside under one deterministic Pier reservation, checked against current stock; if stock is gone the acceptance is refused and the case can be refused with an explanation. A replacement is not shipped, priced or charged by this step, and a price difference is settled by staff separately.

## Progress and custody

The customer's account and private order page show each case with its timeline: requested, then the explained decision, then whether a replacement is set aside. Staff identity never appears. Cases and decisions are exported with the business, travel with archives and are removed when the customer is erased. Goods received, restocking, refunds and any fee are separate (RETURN-002 and the refund workflow).
