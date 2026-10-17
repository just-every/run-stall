import { CheckDot, Icon, Photo } from '../parts'
import { order } from '../sample'

/** The order agent's thread for one order: the problem, the offer, the customer's answer, the fix. */
export function AgentCard() {
  return <div className="card agent">
    <ol className="thread">
      <li className="alert"><span className="node"><Icon name="alert" /></span><span className="bubble">Order #{order.number} · Cobalt mug out of stock</span></li>
      <li><span className="node"><Icon name="note" /></span><span className="bubble">Offered Maya: Speckle mug or a refund</span></li>
      <li className="reply"><span className="node avatar">M</span><span className="bubble">Speckle please!</span></li>
      <li className="done"><span className="node"><CheckDot /></span><span className="bubble">Swapped, label reprinted ✓</span></li>
    </ol>
  </div>
}

/** A customer's exchange, step by step. */
export function ReturnCard() {
  return <div className="card return">
    <Photo name="linen" className="swatch-photo" />
    <div>
      <p className="return-head">Exchange · Linen apron · <span className="nowrap">M → L</span></p>
      <ol className="steps">{['Label sent', 'Received', 'Restocked', 'New size shipped'].map(step => <li key={step}><CheckDot /><span>{step} ✓</span></li>)}</ol>
    </div>
  </div>
}
