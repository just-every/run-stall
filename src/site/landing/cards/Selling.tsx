import { Icon, Photo, Tick } from '../parts'
import { glazes, order, products, shop, usd } from '../sample'

const Swatches = () => <>
  <span className="swatches">{glazes.map(glaze => <i key={glaze} className={`swatch ${glaze.toLowerCase()}`} />)}</span>
  <span className="swatch-names">{glazes.join(' · ')}</span>
</>

/** The storefront: Fog & Clay's mugs, in a browser on its own domain. */
export function StoreCard() {
  return <div className="card browser">
    <div className="browser-bar">
      <span className="lights"><i /><i /><i /></span>
      <span className="address"><Icon name="lock" className="address-lock" />{shop.domain}<Tick className="address-tick" /></span>
    </div>
    <div className="store">
      <div className="store-head">
        <span className="store-name">{shop.name}</span>
        <span className="store-tabs"><span className="on">Mugs</span><span>Bowls</span><span>Vases</span></span>
      </div>
      <div className="store-grid">
        {products.map(product => <div className="store-item" key={product.photo}>
          <Photo name={product.photo} />
          <span className="store-price">{usd(product.price).replace('.00', '')}</span>
          <Swatches />
        </div>)}
      </div>
    </div>
  </div>
}

/** Checkout: two Fog glaze mugs to Texas, shipping and sales tax added, the stock held while they pay. */
export function CheckoutCard() {
  return <div className="card checkout">
    <div className="checkout-line"><Photo name="thumb" className="thumb" /><span>{order.line}</span><b>{order.items}</b></div>
    <div className="checkout-rows">
      <p><span>Shipping · {order.carrier}</span><span>{order.shipping}</span></p>
      <p><span>{order.taxLabel}</span><span>{order.tax}</span></p>
    </div>
    <p className="checkout-total"><span>Total</span><b>{order.total}</b></p>
    <div className="checkout-actions"><span className="pay">Pay {order.total}</span><span className="hold">{order.hold}</span></div>
  </div>
}
