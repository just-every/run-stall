import { Dot } from '../../shell/Actions'
import { Icon } from '../parts'

const DETAILS = [
  { icon: 'gift', title: 'Gift cards', body: 'Sell them, and they work at checkout.' },
  { icon: 'user', title: 'Customer accounts', body: 'Order history and one-click reorders.' },
  { icon: 'mail', title: 'Order emails', body: 'Confirmation, shipped, delivered, refunded.' },
  { icon: 'cart', title: 'Sell everywhere', body: 'Google Shopping, Instagram and TikTok Shop.' },
  { icon: 'doc', title: 'QuickBooks sync', body: 'Sales and fees post to your books.' },
  { icon: 'bars', title: 'Analytics', body: 'Sales, conversion and best sellers.' },
] as const

/** Desk page 8: the six smaller things, as tinted-icon cards in a three by two grid. */
export function Details() {
  return <section id="details" className="details site-wrap" aria-labelledby="details-title">
    <p className="eyebrow">Also included</p>
    <h2 id="details-title">The quiet details<Dot /></h2>
    <ul className="detail-grid">{DETAILS.map(detail => <li key={detail.title} className="card detail"><span className="detail-icon"><Icon name={detail.icon} /></span><h3>{detail.title}</h3><p>{detail.body}</p></li>)}</ul>
  </section>
}
