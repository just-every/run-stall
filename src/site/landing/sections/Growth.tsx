import { CartCard, MoveCard } from '../cards/Growth'
import { Feature, Pair } from '../parts'

/** Desk page 6: abandoned carts, then moving in from Shopify. */
export function Growth() {
  return <Pair>
    <Feature id="abandoned-carts" eyebrow="Abandoned carts" title="Carts come back" art={<CartCard />} label="A reminder email, Still thinking about the Fog glaze mug?, with a Back to your cart button, and $142.00 recovered this week.">
      A friendly reminder brings people back to what they left behind.
    </Feature>
    <Feature id="move-in" eyebrow="Move in" title="Move from Shopify in an afternoon" flip art={<MoveCard />} label="A finished move from Shopify: 214 products, 1,980 customers, 6,412 orders and 340 redirects.">
      Products, customers, orders and redirects come with you.
    </Feature>
  </Pair>
}
