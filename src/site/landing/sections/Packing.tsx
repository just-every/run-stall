import { Drawing, Heading, Mark, Section, Tick } from '../parts'
import { labelRun, labels, SEP, usd } from '../kiln'
import '../../styles/sections/packing.css'

/** 07 · Saturday 8:00 AM, packing day: the label run on the birch panel (the booth floor). */
export function Packing() {
  return <Section id="packing" className="packing">
    <Heading id="packing" eyebrow="Saturday 8:00 AM · Packing day" title="Every label in one run">
      Live USPS and UPS rates, addresses checked, labels printed and tracking emails sent.
    </Heading>
    <Drawing className="birch" label={`Labels for ${labelRun.day}, ${labelRun.count} orders: ${labels.map(row => `#${row.order} ${row.to}, ${row.items}, ${row.weight}, ${row.service} ${usd(row.cents)}${row.fix ? `, address fixed from ${row.fix.was} to ${row.fix.now.replaceAll('\u00a0', ' ')}` : ''}, printed`).join('; ')}. ${labelRun.count} labels, ${usd(labelRun.cents)}. Tracking emails sent ${labelRun.count} of ${labelRun.count}.`}>
      <div className="card labels">
        <div className="labels-head"><p className="card-title">Labels{SEP}{labelRun.day}{SEP}{labelRun.count} orders</p><span className="print-all">Print all</span></div>
        <div className="label-table">
          <p className="label-cols"><span>Order</span><span>Ship to</span><span>Items</span><span>Weight</span><span>Service</span><span>Rate</span><span>Status</span></p>
          {labels.map(row => <div key={row.order} className={`label-row${row.fix ? ' fixed' : ''}`}>
            <b className="l-order">#{row.order}</b>
            <span className="l-to"><span className="l-name">{row.to}</span>{row.fix ? <span className="l-fix"><s>{row.fix.was}</s>{'\u00a0→ '}<span className="ok">{row.fix.now}</span></span> : null}</span>
            <span className="l-items">{row.items}<span className="l-weight-inline">{SEP}{row.weight}</span></span>
            <span className="l-weight">{row.weight}</span>
            <span className="l-service">{row.service}<span className="l-rate-inline">{SEP}{usd(row.cents)}</span></span>
            <span className="l-rate">{usd(row.cents)}</span>
            <span className="printed"><Tick />Printed</span>
          </div>)}
        </div>
        <div className="labels-foot"><b>{labelRun.count} labels{SEP}{usd(labelRun.cents)}</b><span className="sent"><Mark kind="ok" />Tracking emails sent {labelRun.count}/{labelRun.count}</span></div>
      </div>
    </Drawing>
  </Section>
}
