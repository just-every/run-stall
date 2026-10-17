import { AgentCard, ReturnCard } from '../cards/Service'
import { Feature, Pair } from '../parts'

/** Desk page 5: the order agent, then returns. */
export function Service() {
  return <Pair>
    <Feature id="order-agent" eyebrow="The order agent" title="It handles the hiccups" art={<AgentCard />} label="Order 1052: the Cobalt mug is out of stock, Maya is offered a Speckle mug or a refund, she picks Speckle, and the order is swapped with a reprinted label.">
      When stock runs out or a parcel stalls, Stall offers your customer a real choice and finishes the job.
    </Feature>
    <Feature id="returns" eyebrow="Returns" title="Returns without the back‑and‑forth" flip art={<ReturnCard />} label="A linen apron exchanged from M to L: label sent, received, restocked and the new size shipped.">
      Customers start a return or exchange themselves. The label, restock and refund follow.
    </Feature>
  </Pair>
}
