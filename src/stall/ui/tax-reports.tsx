import { useRef, useState } from 'react'
import type { TaxAmounts, TaxLiabilityReport, TaxNexusReport, TaxTransaction } from '../tax/reports'
import { errorMessage, money, request } from './api'
import { Notice, Section } from './primitives'
import { When } from './presentation'

const amountLabels:Record<keyof TaxAmounts,string>={grossSalesCents:'Gross item sales',taxableSalesCents:'Taxable item sales',nonTaxableSalesCents:'Non-taxable item sales',exemptSalesCents:'Exempt item sales',shippingSalesCents:'Sale shipping',taxCollectedCents:'Tax collected',refundGrossCents:'Refunded item gross',refundTaxCents:'Refund tax',adjustmentTaxCents:'Tax adjustments',grossCents:'Net item gross',taxableCents:'Net taxable items',nonTaxableCents:'Net non-taxable items',exemptCents:'Net exempt items',shippingCents:'Net shipping',taxCents:'Net tax',amountCents:'Net total including tax',unallocatedTaxCents:'Tax without named jurisdiction evidence'}
function Amounts({amounts}:{amounts:TaxAmounts}) {
 return <dl className="st-definition">{(Object.keys(amountLabels) as (keyof TaxAmounts)[]).map(key=><div key={key}><dt>{amountLabels[key]}</dt><dd>{money(amounts[key])}</dd></div>)}</dl>
}
function Transactions({rows}:{rows:TaxTransaction[]}) {
 return <div className="st-table-wrap"><table><caption>Contributing transactions</caption><thead><tr><th scope="col">Order</th><th scope="col">Posting</th><th scope="col">Occurred</th><th scope="col">Item gross</th><th scope="col">Tax</th><th scope="col">Total</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}>
  <td><a href={`/app#orders/${encodeURIComponent(row.orderId)}`}>Open order {row.orderId}</a></td><td><details><summary>{row.kind} · {row.id}</summary><dl className="st-definition"><div><dt>Calculation</dt><dd>{row.calculationId}</dd></div>{row.originalTransactionId&&<div><dt>Original transaction</dt><dd>{row.originalTransactionId}</dd></div>}<div><dt>Taxable items</dt><dd>{money(row.taxableCents)}</dd></div><div><dt>Non-taxable items</dt><dd>{money(row.nonTaxableCents)}</dd></div><div><dt>Exempt items</dt><dd>{money(row.exemptCents)}</dd></div><div><dt>Shipping</dt><dd>{money(row.shippingCents)}</dd></div><div><dt>Tax without named jurisdiction evidence</dt><dd>{money(row.unallocatedTaxCents)}</dd></div></dl></details></td><td><When at={row.occurredAt} /></td><td>{money(row.grossCents)}</td><td>{money(row.taxCents)}</td><td>{money(row.amountCents)}</td>
 </tr>)}{!rows.length&&<tr><td colSpan={6}>No contributing transactions.</td></tr>}</tbody></table></div>
}
export function TaxReports() {
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[report,setReport]=useState<TaxLiabilityReport>(),[nexus,setNexus]=useState<TaxNexusReport>(),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [selection,setSelection]=useState<{state:string;channel:string}>(),[jurisdiction,setJurisdiction]=useState(''),[exportLevel,setExportLevel]=useState('state'),[exporting,setExporting]=useState(false),loading=useRef(false)
 async function load() {
  if(loading.current)return
  loading.current=true;setBusy(true);setError('')
  const query=new URLSearchParams({from,to}).toString()
  try {
   const results=await Promise.allSettled([request<TaxLiabilityReport>(`/api/stall/tax/liability?${query}`),request<TaxNexusReport>(`/api/stall/tax/nexus?${query}`)])
   if(results[0].status==='fulfilled'){setReport(results[0].value);setSelection(undefined);setJurisdiction('')}
   if(results[1].status==='fulfilled')setNexus(results[1].value)
   const failures=results.filter((result):result is PromiseRejectedResult=>result.status==='rejected')
   if(failures.length)setError(failures.map(result=>errorMessage(result.reason)).join(' '))
  } finally {loading.current=false;setBusy(false)}
 }
 async function download() {
  if(!report||exporting)return
  setExporting(true);setError('')
  try {
   const query=new URLSearchParams({from:report.period.from,to:report.period.to,level:exportLevel}),response=await fetch(`/api/stall/tax/liability.csv?${query}`,{credentials:'same-origin',cache:'no-store'})
   if(!response.ok) {
    const problem:unknown=await response.json().catch(()=>null)
    const failure=problem&&typeof problem==='object'&&'error' in problem?problem.error:null
    const message=typeof failure==='string'?failure:failure&&typeof failure==='object'&&'message' in failure&&typeof failure.message==='string'?failure.message:'The tax export could not be downloaded.'
    throw new Error(message)
   }
   const url=URL.createObjectURL(await response.blob()),link=document.createElement('a')
   link.href=url;link.download=`stall-tax-${exportLevel}-${report.period.from}-${report.period.to}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  } catch(failure) {setError(errorMessage(failure))}
  finally {setExporting(false)}
 }
 const selectedState=report?.states.find(row=>row.state===selection?.state&&row.channel===selection.channel)
 const jurisdictions=report?.jurisdictions.filter(row=>row.state===selection?.state&&row.channel===selection.channel)??[]
 const selectedJurisdiction=jurisdictions.find(row=>row.key===jurisdiction)
 const transactions=report?.transactions.filter(row=>selectedJurisdiction?selectedJurisdiction.transactionIds.includes(row.id):row.state===selection?.state&&row.channel===selection.channel)??[]
 return <Section title="Sales tax reports" id="tax-reports"><div className="st-stack" style={{fontSize:'max(13px, 1rem)'}}>
  <form className="st-row" onSubmit={event=>{event.preventDefault();void load()}}>
   <label>From<input type="date" required value={from} onChange={event=>setFrom(event.target.value)} /></label><label>To, exclusive<input type="date" required value={to} onChange={event=>setTo(event.target.value)} /></label><button className="st-secondary" disabled={busy}>{busy?'Loading reports…':'Show reports'}</button>
  </form>
  {error&&<Notice error>{error}</Notice>}
  {!report&&!nexus&&<p>Choose an explicit filing period to review provider-observed tax postings and configured nexus thresholds.</p>}
  {report&&<>
   <h3>Tax liability</h3><p>{report.period.from} up to {report.period.to}, exclusive · {report.period.timeZone}</p>
   <div className="st-row"><label>Export level<select value={exportLevel} onChange={event=>setExportLevel(event.target.value)}><option value="state">States</option><option value="jurisdiction">Jurisdictions</option><option value="transaction">Transactions</option></select></label><button className="st-secondary" disabled={exporting} onClick={()=>void download()}>{exporting?'Preparing export…':'Download CSV'}</button></div>
   <details><summary>Report totals and accounting policy</summary><p>{report.policy}</p><Amounts amounts={report.totals} /></details>
   <div className="st-table-wrap"><table><caption>States, split by sales channel</caption><thead><tr><th scope="col">State</th><th scope="col">Channel</th><th scope="col">Gross item sales</th><th scope="col">Tax collected</th><th scope="col">Refund tax</th><th scope="col">Adjustments</th><th scope="col">Net tax</th></tr></thead><tbody>{report.states.map(row=><tr key={`${row.state}-${row.channel}`}><td><button className="st-link" aria-pressed={selection?.state===row.state&&selection.channel===row.channel} onClick={()=>{setSelection({state:row.state,channel:row.channel});setJurisdiction('')}}>{row.state}</button></td><td>{row.channel}</td><td>{money(row.grossSalesCents)}</td><td>{money(row.taxCollectedCents)}</td><td>{money(row.refundTaxCents)}</td><td>{money(row.adjustmentTaxCents)}</td><td>{money(row.taxCents)}</td></tr>)}{!report.states.length&&<tr><td colSpan={7}>No tax postings in this period.</td></tr>}</tbody></table></div>
   {selectedState&&<>
    <h4>{selectedState.state} · {selectedState.channel}</h4><details><summary>State amounts</summary><Amounts amounts={selectedState} /></details>
    {selectedState.unallocatedTaxCents!==0&&<Notice>{money(selectedState.unallocatedTaxCents)} has no named provider jurisdiction evidence. It remains in state and transaction totals.</Notice>}
    <div className="st-table-wrap"><table><caption>Provider jurisdictions</caption><thead><tr><th scope="col">Jurisdiction</th><th scope="col">Level</th><th scope="col">Rate</th><th scope="col">Net taxable base</th><th scope="col">Net tax</th></tr></thead><tbody>{jurisdictions.map(row=><tr key={row.key}><td><button className="st-link" aria-pressed={jurisdiction===row.key} onClick={()=>setJurisdiction(row.key)}>{row.name}</button></td><td>{row.level}</td><td>{row.ratePercent}%</td><td>{money(row.taxableCents)}</td><td>{money(row.taxCents)}</td></tr>)}{!jurisdictions.length&&<tr><td colSpan={5}>No named provider jurisdictions recorded.</td></tr>}</tbody></table></div>
    {selectedJurisdiction&&<div className="st-row"><p>{selectedJurisdiction.level} · {selectedJurisdiction.name} · {selectedJurisdiction.ratePercent}%</p><button className="st-secondary" onClick={()=>setJurisdiction('')}>Show all state transactions</button></div>}
    <Transactions rows={transactions} />
   </>}
  </>}
  {nexus&&<>
   <h3>Configured nexus thresholds</h3><p>{nexus.period.from} up to {nexus.period.to}, exclusive · {nexus.period.timeZone}</p><details><summary>Threshold measurement policy</summary><p>{nexus.policy}</p></details>
   <div className="st-table-wrap"><table><caption>Configured state thresholds</caption><thead><tr><th scope="col">State</th><th scope="col">Net item gross</th><th scope="col">Sale orders</th><th scope="col">Sales threshold</th><th scope="col">Transaction threshold</th><th scope="col">Warning at</th><th scope="col">Status</th></tr></thead><tbody>{nexus.states.map(row=><tr key={row.state}><td>{row.state}<details><summary>Gross and refunds</summary><p>Gross sales {money(row.grossSalesCents)} · refunds {money(row.refundGrossCents)}</p></details></td><td>{money(row.netGrossCents)}</td><td>{row.transactionCount}</td><td>{row.salesPercent===null?'Disabled':`${money(row.salesCents)} · ${row.salesPercent.toFixed(1)}%`}</td><td>{row.transactionsPercent===null?'Disabled':`${row.transactions} · ${row.transactionsPercent.toFixed(1)}%`}</td><td>{row.warningPercent}%</td><td>{row.status==='crossed'?'Threshold crossed':row.status==='warning'?'Approaching threshold':'Below warning'}</td></tr>)}{!nexus.states.length&&<tr><td colSpan={7}>Configure state thresholds in Tax settings to track nexus.</td></tr>}</tbody></table></div>
  </>}
 </div></Section>
}
