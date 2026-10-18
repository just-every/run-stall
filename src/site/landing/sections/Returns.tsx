import { Drawing, Heading, Mug, Section, Tick } from '../parts'
import { dollars, juneReturn, mugs, SEP, shop, usd } from '../kiln'
import '../../styles/sections/returns.css'

/** 09 · Oct 27, returns: June starts a return from her account on the cork panel (the booth wall); R-0031 runs
 * label, receipt, inspection and refund as one record, drawn as a parcel tracker. */
export function Returns() {
  const r = juneReturn
  return <Section id="returns" className="returns">
    <Heading id="returns" eyebrow="Oct 27 · Returns" title={<>Returns without <span className="nowrap">the back&#8209;and&#8209;forth</span></>}>
      Customers start a return from their account. Label, receipt, restock and refund stay in one record.
    </Heading>
    <Drawing className="returns-art" label={`June K.'s account on ${shop.domain}: order #${r.order}, delivered ${r.delivered}, ${mugs.fog.name} ${dollars(mugs.fog.price)}; reason ${r.reason}; refund to ${r.card}; Start return. Return ${r.id}: ${r.steps.map(step => `${step.title} ${step.detail}`).join(', ')}; refund ${usd(r.refund)} through Stripe ${r.stripe}; Refunded.`}>
      <div className="cork">
        <div className="card account">
          <p className="account-url">{shop.domain}/account</p>
          <p className="card-title">Order #{r.order}{SEP}Delivered {r.delivered}</p>
          <p className="account-item"><Mug glaze="fog" className="account-mug" /><span>{mugs.fog.name}{SEP}{dollars(mugs.fog.price)}</span></p>
          <p className="field-label">Reason</p>
          <p className="choice"><i />{r.reason}</p>
          <p className="field-label">Refund to</p>
          <p className="choice"><i />{r.card}</p>
          <span className="start">Start return</span>
        </div>
      </div>
      <svg className="hand-off" viewBox="0 0 92 24"><path d="M2 12h80" /><path d="m76 5 8 7-8 7" /></svg>
      <div className="card rma">
        <p className="rma-head"><span className="card-title">Return {r.id}</span><span className="refunded">Refunded</span></p>
        <ol className="tracker">{r.steps.map(step => <li key={step.title}><span className="stop"><Tick /></span><b>{step.title}</b><span>{step.detail}</span></li>)}</ol>
        <dl className="rma-rows">
          <div><dt>Reason</dt><dd>{r.reason}</dd></div>
          <div><dt>Restock</dt><dd>Back on shelf{SEP}Fog +1</dd></div>
          <div><dt>Refund</dt><dd>{usd(r.refund)}{SEP}Stripe {r.stripe}</dd></div>
        </dl>
      </div>
    </Drawing>
  </Section>
}
