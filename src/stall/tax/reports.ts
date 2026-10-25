import type { Bindings } from '../../auth.server'
import { fail } from '../model'
import { businessTimeZone } from '../preferences'
import { date, localInstant } from '../workflows/time'
import { readTaxConfiguration } from './configuration'

export type TaxJurisdiction={level:'state'|'county'|'city'|'district';name:string;country:'US';state:string;ratePercent:string;amountCents:number;taxableCents:number}
type PostingRow={id:string;order_id:string;kind:'sale'|'refund'|'adjustment';occurred_at:string;destination_state:string;channel:'online'|'marketplace';gross_cents:number;taxable_cents:number;nontaxable_cents:number;exempt_cents:number;shipping_cents:number;tax_cents:number;amount_cents:number;calculation_id:string;original_transaction_id:string|null;jurisdictions_json:string}
export type TaxTransaction={id:string;orderId:string;kind:PostingRow['kind'];occurredAt:string;state:string;channel:PostingRow['channel'];grossCents:number;taxableCents:number;nonTaxableCents:number;exemptCents:number;shippingCents:number;taxCents:number;amountCents:number;calculationId:string;originalTransactionId:string|null;jurisdictions:TaxJurisdiction[];unallocatedTaxCents:number}
const emptyAmounts=()=>({grossSalesCents:0,taxableSalesCents:0,nonTaxableSalesCents:0,exemptSalesCents:0,shippingSalesCents:0,taxCollectedCents:0,refundGrossCents:0,refundTaxCents:0,adjustmentTaxCents:0,grossCents:0,taxableCents:0,nonTaxableCents:0,exemptCents:0,shippingCents:0,taxCents:0,amountCents:0,unallocatedTaxCents:0})
export type TaxAmounts=ReturnType<typeof emptyAmounts>
export type TaxState=TaxAmounts&{state:string;channel:PostingRow['channel']}
export type TaxJurisdictionSummary={key:string;state:string;channel:PostingRow['channel'];level:TaxJurisdiction['level'];name:string;country:'US';ratePercent:string;taxableCents:number;taxCents:number;taxCollectedCents:number;refundTaxCents:number;adjustmentTaxCents:number;transactionIds:string[]}
export const jurisdictionKey=(j:TaxJurisdiction,channel:string)=>JSON.stringify([j.state,channel,j.level,j.name,j.ratePercent])

async function period(env:Bindings,search:URLSearchParams) {
 const from=date(search.get('from')),to=date(search.get('to'))
 if(from>=to)fail('INPUT','Choose a From date before the exclusive To date.',400)
 const timeZone=await businessTimeZone(env.DB)
 return {from,to,timeZone,start:new Date(localInstant(from,0,timeZone)).toISOString(),end:new Date(localInstant(to,0,timeZone)).toISOString()}
}
function transaction(row:PostingRow):TaxTransaction {
 const evidence:unknown=JSON.parse(row.jurisdictions_json)
 if(!Array.isArray(evidence))fail('TAX_EVIDENCE','Stored tax jurisdiction evidence is unreadable.',409)
 const jurisdictions=evidence.filter((j):j is TaxJurisdiction=>j&&['state','county','city','district'].includes(j.level)&&typeof j.name==='string'&&!!j.name.trim()&&j.country==='US'&&j.state===row.destination_state&&typeof j.ratePercent==='string'&&/^\d+(?:\.\d+)?$/.test(j.ratePercent)&&Number.isSafeInteger(j.amountCents)&&Number.isSafeInteger(j.taxableCents))
 return {id:row.id,orderId:row.order_id,kind:row.kind,occurredAt:row.occurred_at,state:row.destination_state,channel:row.channel,grossCents:row.gross_cents,taxableCents:row.taxable_cents,nonTaxableCents:row.nontaxable_cents,exemptCents:row.exempt_cents,shippingCents:row.shipping_cents,taxCents:row.tax_cents,amountCents:row.amount_cents,calculationId:row.calculation_id,originalTransactionId:row.original_transaction_id,jurisdictions,unallocatedTaxCents:row.tax_cents-jurisdictions.reduce((sum,j)=>sum+j.amountCents,0)}
}
async function postings(env:Bindings,p:Awaited<ReturnType<typeof period>>) {
 const result=await env.DB.prepare('SELECT * FROM st_tax_postings WHERE occurred_at>=? AND occurred_at<? ORDER BY occurred_at,id').bind(p.start,p.end).all<PostingRow>()
 return result.results.map(transaction)
}
function add(amounts:TaxAmounts,t:TaxTransaction) {
 for(const key of ['grossCents','taxableCents','nonTaxableCents','exemptCents','shippingCents','taxCents','amountCents','unallocatedTaxCents'] as const)amounts[key]+=t[key]
 if(t.kind==='sale') {
  amounts.grossSalesCents+=t.grossCents;amounts.taxableSalesCents+=t.taxableCents;amounts.nonTaxableSalesCents+=t.nonTaxableCents;amounts.exemptSalesCents+=t.exemptCents;amounts.shippingSalesCents+=t.shippingCents;amounts.taxCollectedCents+=t.taxCents
 } else if(t.kind==='refund') {amounts.refundGrossCents+=t.grossCents;amounts.refundTaxCents+=t.taxCents}
 else amounts.adjustmentTaxCents+=t.taxCents
}
/** Authorization is enforced by the private API dispatcher before calling reports. */
export async function taxLiability(env:Bindings,search:URLSearchParams) {
 const p=await period(env,search),transactions=await postings(env,p),states=new Map<string,TaxState>(),jurisdictions=new Map<string,TaxJurisdictionSummary>(),totals=emptyAmounts()
 for(const t of transactions) {
  const key=JSON.stringify([t.state,t.channel]),state=states.get(key)??{state:t.state,channel:t.channel,...emptyAmounts()}
  add(state,t);add(totals,t);states.set(key,state)
  for(const j of t.jurisdictions) {
   const key=jurisdictionKey(j,t.channel),entry=jurisdictions.get(key)??{key,state:j.state,channel:t.channel,level:j.level,name:j.name,country:j.country,ratePercent:j.ratePercent,taxableCents:0,taxCents:0,taxCollectedCents:0,refundTaxCents:0,adjustmentTaxCents:0,transactionIds:[]}
   entry.taxableCents+=j.taxableCents;entry.taxCents+=j.amountCents
   if(t.kind==='sale')entry.taxCollectedCents+=j.amountCents
   else if(t.kind==='refund')entry.refundTaxCents+=j.amountCents
   else entry.adjustmentTaxCents+=j.amountCents
   if(!entry.transactionIds.includes(t.id))entry.transactionIds.push(t.id)
   jurisdictions.set(key,entry)
  }
 }
 return {period:p,currency:'USD' as const,totals,states:[...states.values()].sort((a,b)=>a.state.localeCompare(b.state)||a.channel.localeCompare(b.channel)),jurisdictions:[...jurisdictions.values()].sort((a,b)=>a.key.localeCompare(b.key)),transactions,
  policy:'Refunds and adjustments belong to their provider-observed posting date. Amounts are signed; net tax equals collected tax plus refund tax plus adjustments. Jurisdiction totals use only named provider evidence; any remaining tax is shown separately. Taxable bases at different jurisdiction levels overlap and must not be added together.'}
}
export type TaxLiabilityReport=Awaited<ReturnType<typeof taxLiability>>

export async function taxNexus(env:Bindings,search:URLSearchParams) {
 const p=await period(env,search),[transactions,configuration]=await Promise.all([postings(env,p),readTaxConfiguration(env)])
 const states=configuration.thresholds.map(threshold=>{
  const rows=transactions.filter(t=>t.state===threshold.state&&t.kind!=='adjustment'),sales=rows.filter(t=>t.kind==='sale'),refunds=rows.filter(t=>t.kind==='refund')
  const grossSalesCents=sales.reduce((n,t)=>n+t.grossCents,0),refundGrossCents=refunds.reduce((n,t)=>n+t.grossCents,0),netGrossCents=grossSalesCents+refundGrossCents,count=new Set(sales.map(t=>t.orderId)).size
  const salesPercent=threshold.salesCents?Math.max(0,netGrossCents)/threshold.salesCents*100:null,transactionsPercent=threshold.transactions?count/threshold.transactions*100:null,percent=Math.max(salesPercent??0,transactionsPercent??0)
  return {...threshold,grossSalesCents,refundGrossCents,netGrossCents,transactionCount:count,salesPercent,transactionsPercent,status:percent>=100?'crossed' as const:percent>=threshold.warningPercent?'warning' as const:'below' as const}
 })
 return {period:p,states,configurationRevision:configuration.revision,policy:'Configured thresholds are compared over your selected filing period. Sales use item gross excluding shipping and tax, less refunds posted in that period. Each distinct sale order counts once; refunds do not remove completed transactions. Adjustments are excluded. Both online and marketplace channels are included. An enabled sales or transaction measure can trigger a warning. This is configured threshold tracking; no provider nexus monitoring is active.'}
}
export type TaxNexusReport=Awaited<ReturnType<typeof taxNexus>>

// Quote all text; neutralize spreadsheet formulas, including leading whitespace.
function csvCell(value:unknown) {
 if(typeof value==='number')return String(value)
 const text=value==null?'':String(value),safe=/^[\s\u0000-\u001f]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text)?"'"+text:text
 return '"'+safe.replace(/"/g,'""')+'"'
}
export async function taxReportCsv(env:Bindings,search:URLSearchParams):Promise<Response> {
 const level=search.get('level')
 if(!['state','jurisdiction','transaction'].includes(level??''))fail('INPUT','Choose a state, jurisdiction or transaction export.',400)
 const report=await taxLiability(env,search)
 const rows:Record<string,unknown>[]=level==='state'?report.states:level==='jurisdiction'?report.jurisdictions.map(({transactionIds,...j})=>({...j,transactionIds:transactionIds.join(' ')})):report.transactions.map(({jurisdictions,...t})=>({...t,jurisdictions:JSON.stringify(jurisdictions)}))
 const headers=level==='state'?['state','channel',...Object.keys(emptyAmounts())]:level==='jurisdiction'?['state','channel','level','name','country','ratePercent','taxableCents','taxCents','taxCollectedCents','refundTaxCents','adjustmentTaxCents','transactionIds']:['id','orderId','kind','occurredAt','state','channel','grossCents','taxableCents','nonTaxableCents','exemptCents','shippingCents','taxCents','amountCents','calculationId','originalTransactionId','unallocatedTaxCents','jurisdictions']
 const periodColumns=['periodFrom','periodToExclusive','timeZone'],body=[periodColumns.concat(headers).map(csvCell).join(','),...rows.map(row=>[report.period.from,report.period.to,report.period.timeZone,...headers.map(key=>row[key])].map(csvCell).join(','))].join('\r\n')+'\r\n'
 return new Response(body,{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="stall-tax-${level}-${report.period.from}-${report.period.to}.csv"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
}
