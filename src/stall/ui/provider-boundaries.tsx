/** Fixed mappings of the current commerce adapters, shown before connection.
 * This is a field preview, never a provider/account verification result. */
export function ProviderBoundaries() {
 return <details id="provider-mappings"><summary>Preview provider data mappings</summary>
  <div className="st-stack">
   <div><h3>Stall → Stripe</h3><p>Checkout sends the buyer’s email, product names, quantities, USD unit prices, flat shipping charge, this shop’s return addresses and its order ID. Stripe collects payment details on its own checkout.</p><p>A refund sends the original payment intent, approved USD cents and Stall’s order/refund IDs. Card details and the merchant’s refund note are not added to the request.</p></div>
   <div><h3>Stripe → Stall</h3><p>Stall reads the checkout/session and payment intent IDs, amount, currency, payment state and delivery name/address. A refund returns its ID, original references, amount, currency and state. Signed events and canonical reads must match the saved order before commercial state changes.</p></div>
   <div><h3>Stall → Pier</h3><p>The fixed SKU mapping selects Pier item IDs. Reservations send the configured shop customer ID, Stall channel, USD prices and quantities. The payment handoff sends the Stripe intent, merchandise amount, USD, payment time and Stall order ID; the flat shipping charge stays separate.</p><p>Dispatch sends the original Pier order and line IDs, quantities and the human-approved shipment reference. Current Pier commands do not add buyer email or delivery-address fields.</p></div>
   <div><h3>Pier → Stall</h3><p>Stall reads item/location availability, order/reservation references and quantities, and actual dispatch/tracking records. Existing orders remain bound to their original Pier address and shop customer.</p></div>
   <p className="st-small">These are the fixed current field mappings. Checking a connection reads Stripe balance or Pier state; it does not verify every account permission, service or production delivery. Saved provider keys are encrypted in this installation under its session secret and excluded from business downloads and installation archives. Server settings take precedence over keys saved here.</p>
  </div>
 </details>
}
