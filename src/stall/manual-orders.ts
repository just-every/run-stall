import type { Bindings } from '../auth.server'
import { audit,commit,digest } from './access'
import { actorLabel,email,fail,integer,requirePerson,requireSupplier,shopCurrency,text,type Order,type ManualPayment } from './model'
import { businessTimeZone } from './preferences'
import { pierOrigin } from './pier'
import { priceSelection,selectLines } from './order-selection'
import { readOrder } from './store'
import { staffPaymentLabel } from './payment-labels'
import { reservePaid } from './payments'

function receivedDate(value:unknown,timeZone:string) {
 const date=text(value,'Received date',10)
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date) fail('INPUT','Enter a valid received calendar date.',400)
 const today=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
 if(date>today) fail('INPUT','Payment received date cannot be after today in the shop time zone.',400)
 return date
}

/** Already-paid sales only. A retry always recovers the original order and Pier command. */
export async function createManualOrder(env:Bindings,actor:import('./model').Actor,p:any):Promise<Order> {
 requireSupplier(actor);requirePerson(actor)
 const key=text(p.idempotencyKey,'Manual order idempotency key',100)
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(key)) fail('INPUT','Retain a fresh random UUID when retrying this sale.',400)
 const selection=selectLines(p.lines),customerEmail=email(p.customerEmail),name=text(p.name,'Customer name',200),address=p.address
 if(!address||address.country!=='US') fail('INPUT','Manual orders require a US shipping address.',400)
 const shippingDetails={name,address:{line1:text(address.line1,'Address line 1',200),line2:address.line2?text(address.line2,'Address line 2',200):'',city:text(address.city,'City',100),state:text(address.state,'State',2).toUpperCase(),postal_code:text(address.postal_code,'ZIP code',10),country:'US'}}
 if(!/^[A-Z]{2}$/.test(shippingDetails.address.state)||!/^\d{5}(-\d{4})?$/.test(shippingDetails.address.postal_code)) fail('INPUT','Use a two-letter US state and a US ZIP code.',400)
 const expectedTotalCents=integer(p.expectedTotalCents,'Reviewed total cents',50,99999999)
 if(!['cash','check','bank_transfer','other'].includes(p.method)) fail('INPUT','Choose cash, check, bank transfer or other.',400)
 const receivedOn=receivedDate(p.receivedOn,await businessTimeZone(env.DB)),amountCents=integer(p.amountCents,'Payment amount cents',50,99999999)
 if(amountCents!==expectedTotalCents) fail('PAYMENT_AMOUNT','Record exactly the reviewed order total.',400)
 const reference=p.reference?text(p.reference,'Payment reference',500):undefined
 const checkoutKey=await digest('manual:'+key),requestDigest=await digest(JSON.stringify({selection,customerEmail,shippingDetails,expectedTotalCents,method:p.method,receivedOn,amountCents,reference}))
 const resume=async(id:string)=>{
  const order=await readOrder(env.DB,id)
  if(order.requestDigest!==requestDigest||order.erasedAt||order.channel!=='manual') fail('IDEMPOTENCY','This key already records a different or erased sale. Review the existing order.')
  return order
 }
 const existing=await env.DB.prepare("SELECT id FROM st_orders WHERE json_extract(value_json,'$.checkoutKey')=?").bind(checkoutKey).first<{id:string}>()
 let order:Order
 if(existing) order=await resume(existing.id)
 else {
  const priced=await priceSelection(env,selection,expectedTotalCents),at=new Date().toISOString()
  if(priced.lines.some(line=>line.personalization?.some(answer=>answer.fileId))) fail('PERSONALIZATION','A file upload can be attached only through the shop’s own checkout.',400)
  const manualPayment:ManualPayment={label:staffPaymentLabel,method:p.method,amountCents,receivedOn,...(reference?{reference}:{}),by:actorLabel(actor),at}
  order={id:crypto.randomUUID(),revision:crypto.randomUUID(),channel:'manual',customerEmail,shippingDetails,...priced,currency:shopCurrency,status:'paid',createdAt:at,requestDigest,checkoutKey,pierOrigin:pierOrigin(env),pierCustomerId:env.PIER_CUSTOMER_ID!,payment:{source:'staff',label:staffPaymentLabel,paidAt:at},manualPayment,taxTreatment:'no_tax_recorded',refunds:[]}
  try { await commit(env.DB,actor,[env.DB.prepare('INSERT INTO st_orders VALUES(?,?,?)').bind(order.id,JSON.stringify(order),order.revision),audit(env.DB,actor,order.id,'order.manual-created'),audit(env.DB,actor,order.id,'payment.staff-recorded')]) }
  catch(error) {
   const winner=await env.DB.prepare("SELECT id FROM st_orders WHERE json_extract(value_json,'$.checkoutKey')=?").bind(checkoutKey).first<{id:string}>()
   if(!winner) throw error
   order=await resume(winner.id)
  }
 }
 return reservePaid(env,order,actor)
}
