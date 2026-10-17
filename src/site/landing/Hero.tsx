import { Actions, Dot } from '../shell/Actions'
import { Painting } from './parts'
import { mug, shop, usd } from './sample'

// The booth's back wall is the shop's product page. The painting keeps the
// screen, the photos and the browser chrome; its words were removed and are
// set here as live text, each item on the screen's perspective (an affine fitted
// to the painted screen's corners, in the plate's 976 x 904 pixel space).
function ScreenText() {
  return <svg className="hero-screen" viewBox="0 0 976 904" aria-hidden="true">
    <g transform="matrix(0.9510 -0.0820 0 0.9404 470.3 112.1)">
      <path className="screen-lock" d="M2 11.5h8v7H2zM3.6 11.5V9a2.4 2.4 0 0 1 4.8 0v2.5" />
      <text x="15" y="18" className="screen-url">{shop.domain}</text>
    </g>
    <text transform="matrix(1.1114 -0.0611 0 1.0098 634.8 172.6)" x="0" y="25" className="screen-title">{mug.name}</text>
    <text transform="matrix(1.0668 -0.0407 0 1.0098 634.8 213.0)" x="0" y="21" className="screen-price">{usd(mug.price).replace('.00', '')}</text>
    <text transform="matrix(1.0668 -0.0236 0 1.0098 634.8 251.4)" x="0" y="12" className="screen-left">{mug.left} left</text>
    <g transform="matrix(1.1062 -0.0118 0 1.0098 634.8 278.6)">
      <rect width="140" height="43" rx="6" className="screen-cart" />
      <text x="70" y="27" className="screen-cart-label">Add to cart</text>
    </g>
  </svg>
}

/** The hero: the booth on the right, the promise and the one action on the left. */
export function Hero() {
  return <section className="hero" aria-labelledby="hero-title">
    <div className="hero-art">
      <Painting name="hero" widths={[488, 732, 976]} sizes="(max-width: 760px) 100vw, min(915px, 64vw)" eager />
      <ScreenText />
    </div>
    <div className="site-wrap hero-row">
      <div className="hero-copy">
        <h1 id="hero-title">Your stall<br /> never closes<Dot /></h1>
        <p className="hero-sub">Stall puts your shop online: storefront and checkout, sales tax, labels and tracking, returns, and the carts people left behind.</p>
        <p className="hero-alt">100% free, open source alternative to <strong>Shopify</strong>, <strong>Squarespace Commerce</strong> and <strong>BigCommerce</strong></p>
        <Actions />
        <p className="hero-note">Free and open source, MIT licensed.</p>
      </div>
    </div>
  </section>
}
