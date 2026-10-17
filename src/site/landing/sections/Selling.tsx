import { CheckoutCard, StoreCard } from '../cards/Selling'
import { Feature, Pair } from '../parts'

/** Desk page 2: the storefront, then checkout. */
export function Selling() {
  return <Pair>
    <Feature id="storefront" eyebrow="Storefront" title="A shop that looks like yours" art={<StoreCard />} label="Fog & Clay's storefront on fogandclay.com: mugs at $38, bowls at $42 and vases at $56, each in Fog, Cobalt and Speckle glazes.">
      Pick a theme, add your photos and collections, and make it yours. Search, filters and your own domain included.
    </Feature>
    <Feature id="checkout" eyebrow="Checkout" title="Checkout in a tap" flip art={<CheckoutCard />} label="A checkout for two Fog glaze mugs: $76.00, USPS Ground Advantage $6.85, Texas sales tax $6.84, total $89.69, with the stock held for 10 minutes.">
      Apple Pay, Google Pay and cards. Discount codes, gift cards, and stock held while they pay.
    </Feature>
  </Pair>
}
