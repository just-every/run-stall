import type { Bindings } from '../../auth.server'
import { digest,live } from '../access'
import { fail,integer,requirePerson,text,type Actor,type Order,type Refund } from '../model'
import { readOrder,saveOrder } from '../store'
import { commerceCall,taxTestMode,requireTaxDestination,taxDestinationHash,type TaxItem,type TaxJurisdiction } from './commerce-provider'
import { postGoodwillAdjustment,postTaxTransaction } from './transactions-postings'

type Work={id:string;order_id:string;kind:string;intent_hash:string;status:string;provider_id:string|null;restored:number}
/** Unknown POST outcomes are observation-only forever, independent of key retention. */
async function transactionWrite(env:Bindings,order:Order,id:string,kind:'sale'|'refund',form:URLSearchParams,recoveredId?:string) {
 taxTestMode(env)
 const account=await commerceCall(env,'/account')
 if(account.id!==order.tax?.accountId)fail('TAX_ACCOUNT','Reconnect the original Stripe account before recording this order’s tax transaction.',503)
 const hash=await digest(form.toString())
 await env.DB.prepare("INSERT OR IGNORE INTO st_tax_transactions(id,order_id,kind,intent_hash,status) VALUES(?,?,?,?,'prepared')").bind(id,order.id,kind,hash).run()
 const work=(await env.DB.prepare('SELECT * FROM st_tax_transactions WHERE id=?').bind(id).first<Work>())!
 if(work.intent_hash!==hash||work.order_id!==order.id||work.kind!==kind)fail('TAX_MISMATCH','The original tax transaction intent differs from this order.')
 if(work.restored&&!recoveredId)fail('TAX_RECOVERY','Restored tax writes are historical evidence. No replacement tax transaction can be sent.')
 const claim=await env.DB.prepare("UPDATE st_tax_transactions SET status='uncertain',attempted_at=? WHERE id=? AND status='prepared' AND restored=0").bind(new Date().toISOString(),id).run()
 let result:any
 if(claim.meta.changes===1)result=await commerceCall(env,kind==='sale'?'/tax/transactions/create_from_calculation':'/tax/transactions/create_reversal',form,id)
 else {
  const original=work.provider_id??recoveredId
  if(typeof original!=='string'||!/^tax_[A-Za-z0-9]+$/.test(original))fail('TAX_RECOVERY','The original tax transaction outcome is unknown. Recover its provider ID against the saved reference; no POST will be retried.')
  result=await commerceCall(env,'/tax/transactions/'+encodeURIComponent(original))
 }
 if(typeof result?.id!=='string'||!/^tax_[A-Za-z0-9]+$/.test(result.id))fail('TAX_RESPONSE','Stripe omitted its tax transaction reference.',502)
 await env.DB.prepare('UPDATE st_tax_transactions SET provider_id=? WHERE id=? AND (provider_id IS NULL OR provider_id=?)').bind(result.id,id,result.id).run()
 if(result.object!=='tax.transaction'||result.currency!=='usd'||result.livemode!==false||result.reference!==id||result.type!==(kind==='sale'?'transaction':'reversal'))fail('TAX_MISMATCH','Stripe tax transaction does not match its original reference and USD test-mode intent.',502)
 if(kind==='refund'&&result.reversal?.original_transaction!==order.tax!.transactionId)fail('TAX_MISMATCH','The reversal does not belong to the original tax transaction.',502)
 const lines=await commerceCall(env,'/tax/transactions/'+encodeURIComponent(result.id)+'/line_items?limit=100')
 if(!Array.isArray(lines.data)||lines.has_more!==false)fail('TAX_RESPONSE','Stripe omitted complete tax transaction line custody.',502)
 const signed=(v:unknown)=>integer(v,'Observed transaction cents',-99999999,99999999)
 const shippingAmount=result.shipping_cost?signed(result.shipping_cost.amount):0,shippingTax=result.shipping_cost?signed(result.shipping_cost.amount_tax):0
 const observedTaxCents=lines.data.reduce((n:number,l:any)=>n+signed(l.amount_tax),shippingTax),observedTotalCents=lines.data.reduce((n:number,l:any)=>n+signed(l.amount)+signed(l.amount_tax),shippingAmount+shippingTax)
 return {...result,line_items:lines,observedTaxCents,observedTotalCents}
}
function matchLine(actual:any,expected:TaxItem,reversal=false) {
 if(typeof actual?.id!=='string'||!/^tax_li_[A-Za-z0-9]+$/.test(actual.id)||actual.reference!==expected.reference||actual.amount!==(reversal?-expected.amount:expected.amount)||actual.amount_tax!==(reversal?-expected.taxCents:expected.taxCents)||actual.tax_behavior!=='exclusive'||(!reversal&&(actual.quantity!==expected.quantity||actual.tax_code!==expected.taxCode))||(reversal&&actual.reversal?.original_line_item!==expected.providerLineId))fail('TAX_MISMATCH','Stripe tax line evidence differs from the original allocated amounts.',502)
}
export async function ensureSaleTax(env:Bindings,order:Order,recoveredId?:string):Promise<Order> {
 if(!order.tax||!order.payment||order.payment.source==='staff')return order
 let tax=order.tax
 if(tax.transactionId&&!recoveredId)return order
 if(recoveredId&&tax.transactionId&&recoveredId!==tax.transactionId)fail('TAX_MISMATCH','Recover only the order’s original Tax transaction reference.')
 const restored=await env.DB.prepare('SELECT restored FROM st_tax_transactions WHERE id=?').bind('stall-tax-sale-'+order.id).first<{restored:number}>()
 if(!restored?.restored||!recoveredId)await requireTaxDestination(env,tax,order.shippingDetails?.address)
 const id='stall-tax-sale-'+order.id,form=new URLSearchParams({calculation:tax.calculationId,reference:id})
 const result=await transactionWrite(env,order,id,'sale',form,recoveredId)
 if(restored?.restored) {
  const destinationHash=await taxDestinationHash(env,order.shippingDetails?.address)
  await requireTaxDestination(env,{...tax,destinationHash},result.customer_details?.address)
  tax={...tax,destinationHash}
  order={...order,tax}
 }
 if(result.observedTaxCents!==tax.taxCents||result.observedTotalCents!==order.totalCents||(result.shipping_cost?.amount??0)!==(order.shippingCents??0)||(result.shipping_cost?.amount_tax??0)!==tax.shippingTaxCents||result.line_items.data.length!==tax.lines.length)fail('TAX_MISMATCH','The paid order and original Tax transaction totals differ.',502)
 const lines=tax.lines.map(line=>{const matches=result.line_items.data.filter((actual:any)=>actual.reference===line.reference);if(matches.length!==1)fail('TAX_MISMATCH','The Tax transaction has missing or duplicate lines.',502);matchLine(matches[0],line);return {...line,providerLineId:matches[0].id}})
 await postTaxTransaction(env,order,result,'sale',lines,order.shippingCents??0,tax.shippingTaxCents,tax.shippingJurisdictions)
 await env.DB.prepare("UPDATE st_tax_transactions SET status='observed',result_json=? WHERE id=? AND provider_id=?").bind(JSON.stringify({id:result.id,postedAt:result.posted_at}),id,result.id).run()
 return saveOrder(env,{...order,tax:{...tax,transactionId:result.id,lines}},'tax.sale-recorded')
}
export async function ensureRefundTax(env:Bindings,order:Order,refund:Refund,recoveredId?:string):Promise<Order> {
 if(!order.tax||refund.status!=='succeeded'||refund.taxReversalId||refund.kind==='address_change')return order
 order=await ensureSaleTax(env,order)
 if(refund.kind==='goodwill') {await postGoodwillAdjustment(env,order,refund);return order}
 if(!order.tax?.transactionId||!refund.taxAllocation)fail('TAX_RECOVERY','The successful refund needs its original tax transaction and reviewed tax allocation.')
 const allocation=refund.taxAllocation,id='stall-tax-refund-'+refund.id,form=new URLSearchParams({mode:'partial',original_transaction:order.tax.transactionId,reference:id})
 allocation.lines.forEach((line,i)=>{if(!line.providerLineId)fail('TAX_RECOVERY','Recover original transaction line IDs before reversing tax.');for(const [key,value] of Object.entries({amount:-line.amount,amount_tax:-line.taxCents,original_line_item:line.providerLineId,quantity:line.quantity,reference:line.reference}))form.set(`line_items[${i}][${key}]`,String(value))})
 if(allocation.shippingCents) {form.set('shipping_cost[amount]',String(-allocation.shippingCents));form.set('shipping_cost[amount_tax]',String(-allocation.shippingTaxCents))}
 const result=await transactionWrite(env,order,id,'refund',form,recoveredId)
 if(result.observedTotalCents!==-refund.amountCents||result.observedTaxCents!==-allocation.taxCents||result.line_items.data.length!==allocation.lines.length||(result.shipping_cost?.amount??0)!==-allocation.shippingCents||(result.shipping_cost?.amount_tax??0)!==-allocation.shippingTaxCents)fail('TAX_MISMATCH','Stripe tax reversal differs from the successful financial refund.',502)
 allocation.lines.forEach(line=>{const matches=result.line_items.data.filter((actual:any)=>actual.reference===line.reference);if(matches.length!==1)fail('TAX_MISMATCH','Reversal lines are incomplete.',502);matchLine(matches[0],line,true)})
 await postTaxTransaction(env,order,result,'refund',allocation.lines,allocation.shippingCents,allocation.shippingTaxCents,allocation.shippingJurisdictions)
 await env.DB.prepare("UPDATE st_tax_transactions SET status='observed',result_json=? WHERE id=? AND provider_id=?").bind(JSON.stringify({id:result.id,postedAt:result.posted_at}),id,result.id).run()
 return saveOrder(env,{...order,refunds:order.refunds.map(r=>r.id===refund.id?{...r,taxReversalId:result.id}:r)},'tax.refund-reversed')
}
export type TaxRefundAllocation={lines:TaxItem[];shippingCents:number;shippingTaxCents:number;taxCents:number;shippingJurisdictions:TaxJurisdiction[]}
export async function recoverTaxTransaction(env:Bindings,actor:Actor,p:any) {
 requirePerson(actor)
 if(actor.role!=='owner')fail('FORBIDDEN','Only the owner may recover original Tax transaction evidence.',403)
 await live(env,actor)
 const order=await readOrder(env.DB,text(p.orderId,'Order ID')),providerId=text(p.transactionId,'Original Stripe Tax transaction ID',100)
 const workId=p.refundId?'stall-tax-refund-'+text(p.refundId,'Refund ID'):'stall-tax-sale-'+order.id
 const original=await env.DB.prepare('SELECT * FROM st_tax_transactions WHERE id=? AND order_id=?').bind(workId,order.id).first<Work>()
 if(!original||original.status==='prepared')fail('TAX_RECOVERY','Recovery requires an existing attempted original Tax operation. No new transaction can be created by supplying a provider ID.')
 if(p.refundId) {const refund=order.refunds.find(r=>r.id===p.refundId);if(!refund)fail('REFUND','Choose an existing refund.');return ensureRefundTax(env,order,refund,providerId)}
 return ensureSaleTax(env,order,providerId)
}
