import { LabelCard, TaxCard } from '../cards/Shipping'
import { Feature, Pair } from '../parts'

/** Desk page 3: shipping labels, then sales tax. */
export function Shipping() {
  return <Pair>
    <Feature id="shipping" eyebrow="Shipping" title="Labels in seconds" art={<LabelCard />} label="A USPS Ground Advantage label with its tracking number, the live rates beside UPS Ground and USPS Priority, and the tracking email sent.">
      Live USPS and UPS rates at checkout, labels printed from the order, and tracking emails sent for you.
    </Feature>
    <Feature id="sales-tax" eyebrow="Sales tax" title="Sales tax, handled" flip art={<TaxCard />} label="October's collected sales tax: Texas $214.60, Colorado $88.31 and Maine $109.27, $412.18 in all, ready to file.">
      The right rate for every US address, collected at checkout and ready to file.
    </Feature>
  </Pair>
}
