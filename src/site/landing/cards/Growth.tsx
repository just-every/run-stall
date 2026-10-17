import { Photo, Tick } from '../parts'
import { moveIn, mug, recovered } from '../sample'

/** The reminder email for a cart left behind, and what came back this week. */
export function CartCard() {
  return <div className="cart-stack">
    <div className="card cart">
      <p className="cart-head">Still thinking about the {mug.name} mug?</p>
      <Photo name="cart" className="cart-photo" />
      <span className="cart-button">Back to your cart</span>
    </div>
    <span className="chip recovered"><b>+{recovered}</b> recovered this week</span>
  </div>
}

/** A finished move from Shopify. */
export function MoveCard() {
  return <div className="card move">
    <p className="progress"><span className="bar"><i /></span><span>100%</span></p>
    <ul className="move-rows">{moveIn.map(row => <li key={row.label}><span>{row.label}</span><b>{row.count.toLocaleString('en-US')}</b><Tick /></li>)}</ul>
  </div>
}
