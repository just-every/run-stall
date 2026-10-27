import { analyticsTestOrder } from './test-mode'
import { businessTimeZone } from '../preferences'
import { orders } from '../store'
import { date,localParts,localInstant,shiftDate } from '../workflows/time'
import { fail } from '../model'
import { costState } from './costs'
import { historicalRows } from './historical'
import { allocate,orderMoney,sumMoney } from './money'
import { dimensions,type AnalyticsReport,type Attribution,type Dimension,type DrillOrder,type HistoricalRow,type ReportOrder,type Seller,type TrafficRow } from './report-model'

type Session={id:string;started_at:string;value:Attribution & {channel?:string;test?:boolean}}
type Event={session_id:string;kind:string;occurred_at:string;sku:string|null}
const unknown='Unknown — not recorded'
const known=(value?:string)=>value||unknown
function historicalOrder(row:HistoricalRow):DrillOrder {
 const gross=row.lines.reduce((n,line)=>n+line.quantity*line.unitCents,0),discounts=allocate(row.discountCents,row.lines.map(l=>l.quantity*l.unitCents))
 const merchandiseRefunds=row.lines.reduce((n,line)=>n+line.refundedCents,0)
 return {id:row.id,createdAt:row.createdAt,channel:row.channel,customer:null,historical:true,test:false,conversion:false,analytics:null,cost:null,shopper:null,provenance:{source:row.source,sourceId:row.sourceId,importedAt:row.importedAt},references:{processor:row.processorReference,processorRefunds:[],taxTransaction:null,accounting:row.accountingReference?[row.accountingReference]:[]},
  grossSalesCents:gross,discountsCents:row.discountCents,netSalesCents:gross-row.discountCents-merchandiseRefunds,taxCents:row.taxCents-row.refundTaxCents,shippingCollectedCents:row.shippingCents-row.refundShippingCents,refundsCents:row.refundsCents,netCollectedCents:row.totalCents-row.refundsCents,itemCostCents:null,shippingCostCents:null,feesCents:null,giftLiabilityCents:null,contributionMarginCents:null,
  lines:row.lines.map((line,i)=>({...line,refundedQuantity:line.refundedQuantity,grossSalesCents:line.quantity*line.unitCents,netSalesCents:line.quantity*line.unitCents-discounts[i]-line.refundedCents}))}
}
function bestSellers(rows:DrillOrder[],variant:boolean):Seller[] {
 const groups=new Map<string,Seller>()
 for(const row of rows)for(const line of row.lines) {
  const key=variant?line.sku:line.productSku,group=groups.get(key)??{productSku:line.productSku,sku:variant?line.sku:line.productSku,name:line.name,unitsSold:0,unitsRefunded:0,netUnits:0,grossSalesCents:0,netSalesCents:0}
  group.unitsSold+=line.quantity
  group.unitsRefunded=group.unitsRefunded===null||line.refundedQuantity===null?null:group.unitsRefunded+line.refundedQuantity
  group.netUnits=group.netUnits===null||line.refundedQuantity===null?null:group.netUnits+line.quantity-line.refundedQuantity
  group.grossSalesCents+=line.grossSalesCents;group.netSalesCents+=line.netSalesCents;groups.set(key,group)
 }
 return [...groups.values()].sort((a,b)=>b.unitsSold-a.unitsSold||b.netSalesCents-a.netSalesCents||a.sku.localeCompare(b.sku))
}
export async function buildAnalyticsReport(db:D1Database,query:URLSearchParams):Promise<AnalyticsReport> {
 const timeZone=await businessTimeZone(db),today=localParts(Date.now(),timeZone).date
 const from=date(query.get('from')||shiftDate(today,-29)),to=date(query.get('to')||today)
 if(from>to)fail('REPORT_PERIOD','The start date must be on or before the end date.',400)
 const start=new Date(localInstant(from,0,timeZone)).toISOString(),endExclusive=new Date(localInstant(shiftDate(to,1),0,timeZone)).toISOString()
 const inside=(at:string)=>at>=start&&at<endExclusive
 const filters=Object.fromEntries(['channel','product','variant','customer',...dimensions].map(key=>[key,(query.get(key)??'').trim()]).filter(([,value])=>value))
 const [all,costs,historical,rawSessions,rawEvents]=await Promise.all([orders(db),costState(db),historicalRows(db),db.prepare('SELECT id,started_at,value_json FROM st_analytics_sessions').all<any>(),db.prepare('SELECT session_id,kind,occurred_at,sku FROM st_analytics_events').all<Event>()])
 const sessions:Session[]=rawSessions.results.map(row=>({id:row.id,started_at:row.started_at,value:JSON.parse(row.value_json)})).filter(row=>inside(row.started_at)&&row.value.consent==='granted'&&!row.value.restored&&!row.value.test)
 const validSessions=new Set(sessions.map(s=>s.id))
 const latestCost=new Map(costs.records.map(row=>[row.orderId,row]))
 const live=all.filter((value):value is ReportOrder=>{const order=value as ReportOrder;return !!order.payment&&order.analyticsExcluded!=='imported'&&!order.imported&&!order.canceledAt&&!['canceled','cancelled','test'].includes(order.status)&&inside(order.createdAt)})
 const liveRows:DrillOrder[]=live.map(order=>{
  const cost=costs.enabled?(latestCost.get(order.id)??null):null,{money,lines}=orderMoney(order,cost,costs.enabled)
  const test=analyticsTestOrder(order),conversion=!test&&order.channel!=='manual'&&!!order.analytics?.sessionId&&validSessions.has(order.analytics.sessionId)&&!order.analytics.restored
  return {...money,id:order.id,createdAt:order.createdAt,channel:order.channel??'online',customer:order.customerEmail,shopper:order.shopper??null,historical:false,test,conversion,lines,analytics:order.analytics??null,cost,provenance:null,references:{processor:order.payment?.source==='staff'?(order.manualPayment?.reference??null):(order.payment?.intentId??null),processorRefunds:order.refunds.filter(r=>r.status==='succeeded'&&r.stripeId).map(r=>r.stripeId!),taxTransaction:order.tax?.transactionId??null,accounting:[]}}
 })
 const matches=(row:DrillOrder)=>!((filters.channel&&row.channel!==filters.channel)||(filters.product&&!row.lines.some(l=>l.productSku===filters.product))||(filters.variant&&!row.lines.some(l=>l.sku===filters.variant))||(filters.customer&&!`${row.customer??''} ${live.find(o=>o.id===row.id)?.shippingDetails?.name??''}`.toLowerCase().includes(filters.customer.toLowerCase()))||dimensions.some(key=>filters[key]&&known(row.analytics?.[key])!==filters[key]))
 const selected=[...liveRows.filter(row=>!row.test),...historical.filter(row=>inside(row.createdAt)).map(historicalOrder)].filter(matches).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id))
 const orderSessions=new Set(selected.filter(r=>r.conversion).map(r=>r.analytics!.sessionId!))
 const events=rawEvents.results.filter(e=>inside(e.occurred_at)&&validSessions.has(e.session_id))
 const parentSkus=new Map(all.flatMap(o=>o.lines.map(l=>[l.sku,l.productSku??l.sku] as const)))
 const filteredSessions=sessions.filter(s=>{
  if(filters.channel&&(s.value.channel??'online')!==filters.channel)return false
  if(filters.customer&&!orderSessions.has(s.id))return false
  if(filters.variant&&!events.some(e=>e.session_id===s.id&&e.sku===filters.variant))return false
  if(filters.product&&!events.some(e=>e.session_id===s.id&&e.sku&&(parentSkus.get(e.sku)??e.sku)===filters.product))return false
  return !dimensions.some(key=>filters[key]&&known(s.value[key])!==filters[key])
 })
 const filteredIds=new Set(filteredSessions.map(s=>s.id)),observed=filteredSessions.length||null
 const conversionOrders=selected.filter(row=>row.conversion&&filteredIds.has(row.analytics!.sessionId!)).length
 const traffic=Object.fromEntries(dimensions.map(dimension=>{
  const groups=new Map<string,TrafficRow>(),get=(value:string)=>{let row=groups.get(value);if(!row){row={value,sessions:null,paidOrders:0,netSalesCents:0,conversionRate:null};groups.set(value,row)}return row}
  for(const session of filteredSessions) {const row=get(known(session.value[dimension]));row.sessions=(row.sessions??0)+1}
  for(const order of selected) {const row=get(known(order.analytics?.[dimension]));row.netSalesCents+=order.netSalesCents;if(order.conversion&&filteredIds.has(order.analytics!.sessionId!))row.paidOrders++}
  for(const row of groups.values())row.conversionRate=row.sessions?row.paidOrders/row.sessions:null
  return [dimension,[...groups.values()].sort((a,b)=>(b.sessions??0)-(a.sessions??0)||b.netSalesCents-a.netSalesCents||a.value.localeCompare(b.value))]
 })) as Record<Dimension,TrafficRow[]>
 const sellers={products:bestSellers(selected,false),variants:bestSellers(selected,true)}
 if(query.get('rank')==='netSales')for(const rows of Object.values(sellers))rows.sort((a,b)=>b.netSalesCents-a.netSalesCents||b.unitsSold-a.unitsSold||a.sku.localeCompare(b.sku))
 const groupOrders=(key:(row:DrillOrder)=>string)=>{const groups=new Map<string,DrillOrder[]>();for(const row of selected){const value=key(row);groups.set(value,[...(groups.get(value)??[]),row])}return [...groups].map(([value,rows])=>({value,...sumMoney(rows),paidOrders:rows.length,conversionOrders:rows.filter(row=>row.conversion&&filteredIds.has(row.analytics!.sessionId!)).length})).sort((a,b)=>a.value.localeCompare(b.value))}
 const channels=groupOrders(row=>row.channel),dates=groupOrders(row=>localParts(Date.parse(row.createdAt),timeZone).date)
 const publicOrder=(row:DrillOrder)=>({...row,conversion:row.conversion&&filteredIds.has(row.analytics!.sessionId!),analytics:row.analytics?Object.fromEntries(dimensions.filter(key=>row.analytics?.[key]).map(key=>[key,row.analytics![key]])):null})
 const publicOrders=selected.map(publicOrder),excludedTestOrders=liveRows.filter(row=>row.test&&matches(row)).map(publicOrder)
 const stage=(kind:string)=>observed===null?null:new Set(events.filter(event=>event.kind===kind&&filteredIds.has(event.session_id)).map(e=>e.session_id)).size
 return {currency:'USD',period:{from,to,timeZone,start,endExclusive},filters,costConsent:costs.enabled,totals:{...sumMoney(selected),paidOrders:selected.length,conversionOrders,sessions:observed,conversionRate:observed?conversionOrders/observed:null},channels,dates,bestSellers:sellers,traffic,funnel:{visits:observed,productViews:stage('product_view'),addToCart:stage('add_to_cart'),checkouts:stage('checkout'),payments:observed===null?null:new Set(selected.filter(row=>row.conversion&&filteredIds.has(row.analytics!.sessionId!)).map(row=>row.analytics!.sessionId!)).size},orders:publicOrders,excludedTestOrders,
 policy:{traffic:'Observed consented sessions only. Total traffic and nonconsenting visits are unknown. No observed sessions is shown as unknown, never as measured zero traffic.',attribution:'Last non-direct click within 30 days; source snapshots are retained with paid orders. Direct visits do not replace a recent non-direct source.',conversion:'Eligible paid live online orders divided by observed consented sessions started in this same date window. Historical, canceled, test, manual and duplicate records never create new conversion. Unlinked payments are outside the observed conversion numerator.',dates:'Inclusive shop calendar dates of order placement and session start. Refunds succeeded by report time are applied to their original orders; timestamps remain UTC.',filters:'Filters select whole orders. Customer filtering limits observed sessions to linked matching orders; product and variant session filters use recorded product events. Unobserved customer or product traffic remains unknown.',refunds:'Succeeded refunds only. Gross sales are items before discounts; net sales exclude shipping and tax. Shipping promotions are disclosed as discounts against original shipping. Unallocated goodwill is apportioned across items in integer cents; historical refunds require explicit merchandise, shipping and tax allocations. Unrecorded historical refunded item quantities remain unknown.',costs:'Owner-recorded order cost snapshots only. Costs are net actual expenses for this order after any recoveries, including any explicitly recorded zero. Any absent item, shipping or fee cost, or disabled cost consent, makes contribution margin unknown. Catalog costs are never substituted.',history:'Historical sales retain immutable source ID, reviewed preview, importer and timestamp. They create no live orders, sessions, stock, payment or new conversion. Historical quantities are gross sold units; any unrecorded refunded quantities are unknown.',giftLiability:'Gift liability is unknown unless explicitly recorded for each order. This report does not infer a gift ledger balance.',bots:'Stripe test credentials and native demo mode refuse capture. Provider-identified test purchases are labelled separately, never included in live sales or new conversion. Known automated user agents are excluded at capture. Unidentified bots and traffic without current analytics consent are unmeasured.'}}
}
