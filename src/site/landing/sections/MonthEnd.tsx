import { Drawing, Heading, Mark, Section } from '../parts'
import { ledger, nexus, payout, salesTax, SEP, usd } from '../kiln'
import '../../styles/sections/month-end.css'

/** 10 · Oct 31, month end: the sales tax return and the QuickBooks posting, offset on the tangerine counter. */
export function MonthEnd() {
  return <Section id="month-end" className="month-end">
    <Heading id="month-end" eyebrow="Oct 31 · Month end" title="October, closed" className="centred">
      Sales tax ready to file, and every sale posted to QuickBooks.
    </Heading>
    <Drawing className="counter-art" label={`Sales tax for October: ${salesTax.state}, ${salesTax.basis}, ${salesTax.orders} orders, ${usd(salesTax.cents)}, ready to file by ${salesTax.due}. Nexus over the last 12 months: ${nexus.join(', ')}, all under threshold. QuickBooks Online, October: ${ledger.map(row => `${row.label} ${usd(row.cents)}`).join(', ')}, all posted; a payout line of ${usd(payout.cents)} unmatched, then ${payout.matched.replaceAll('\u00a0', ' ')}. ${payout.posted}.`}>
      <span className="counter" />
      <div className="card tax">
        <p className="tax-head"><span className="card-title">Sales tax{SEP}October</span><span className="due">Ready to file by {salesTax.due}</span></p>
        <p className="tax-row"><span className="state">{salesTax.state}<small>{salesTax.basis}</small></span><span>{salesTax.orders} orders</span><b>{usd(salesTax.cents)}</b></p>
        <p className="nexus"><b>Nexus{SEP}last 12 months</b>{nexus.map(state => <span key={state}>{state}</span>)}<span>all under threshold</span></p>
      </div>
      <div className="card books">
        <p className="card-title">QuickBooks Online{SEP}October</p>
        <ul className="ledger">{ledger.map(row => <li key={row.label}><span>{row.label}</span><b>{usd(row.cents)}</b><span className="pill posted">Posted</span></li>)}</ul>
        <ul className="ledger match">
          <li className="unmatched"><span>Payout line</span><b>{usd(payout.cents)}</b><span className="pill">Unmatched</span></li>
          <li className="matched"><span><Mark kind="ok" />{payout.matched}</span><span className="pill">Matched</span></li>
        </ul>
        <p className="card-foot">{payout.posted}</p>
      </div>
    </Drawing>
  </Section>
}
