import { useState } from 'react'
import type { Run,State } from './types'
import { money } from './api'
import { ShippingChoice, useShippingQuote, zipOf } from './shipping-options'
import { useBusinessTime } from './presentation'
import { staffPaymentLabel } from '../payment-labels'

export function ManualOrder({state,busy,run,close}:{state:State;busy:boolean;run:Run;close:()=>void}) {
 const {timeZone}=useBusinessTime(),published=state.products.filter(product=>product.value.active)
 const [quantities,setQuantities]=useState<Record<string,string>>({}),[customer,setCustomer]=useState({customerEmail:'',name:'',line1:'',line2:'',city:'',state:'',postal_code:''})
 const [method,setMethod]=useState('check'),[reference,setReference]=useState(''),[receivedOn,setReceivedOn]=useState(()=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))
 const [reviewed,setReviewed]=useState<number|null>(null),[key]=useState(()=>crypto.randomUUID())
 const lines=published.filter(product=>Number(quantities[product.id])>0).map(product=>({sku:product.id,quantity:Number(quantities[product.id])}))
 const options=useShippingQuote(lines,customer.postal_code),service=options.chosen
 const currentTotal=lines.reduce((sum,line)=>sum+line.quantity*published.find(product=>product.id===line.sku)!.value.unitCents,0)+(service?.cents??0)
 const total=reviewed??currentTotal
 const field=(name:keyof typeof customer,label:string,required=true)=><label>{label}<input required={required} value={customer[name]} maxLength={name==='state'?2:name==='postal_code'?10:200} type={name==='customerEmail'?'email':'text'} onChange={event=>setCustomer({...customer,[name]:event.target.value})} disabled={busy||reviewed!==null} /></label>
 return <section className="st-panel-block" aria-label="Manual retail order">
  <h2>Record a paid sale</h2><p>{staffPaymentLabel}. Enter a sale already paid outside Stall. No confirmation or receipt is sent.</p>
  <form className="st-stack" onSubmit={event=>{event.preventDefault();if(!reviewed){setReviewed(total);return}void run('order.manual',{idempotencyKey:key,customerEmail:customer.customerEmail,name:customer.name,address:{line1:customer.line1,line2:customer.line2,city:customer.city,state:customer.state,postal_code:customer.postal_code,country:'US'},lines,expectedTotalCents:total,amountCents:total,method,receivedOn,reference,shipping:{service:service!.code,quote:service!.quote}}).then(saved=>{if(saved)close()})}}>
   <fieldset className="st-stack" disabled={busy||reviewed!==null}><legend>Published items · current USD prices</legend>{published.map(product=><label key={product.id}>{product.value.name} · {money(product.value.unitCents)}<input aria-label={`Manual quantity for ${product.value.name}`} type="number" min="0" max="1000" step="1" value={quantities[product.id]??'0'} onChange={event=>setQuantities({...quantities,[product.id]:event.target.value})} /></label>)}</fieldset>
   {field('customerEmail','Customer email')}{field('name','Customer name')}{field('line1','Address line 1')}{field('line2','Address line 2',false)}{field('city','City')}{field('state','US state')}{field('postal_code','ZIP code')}
   <label>Payment method<select value={method} disabled={busy||reviewed!==null} onChange={event=>setMethod(event.target.value)}><option value="cash">Cash</option><option value="check">Check</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label>
   <label>Payment received on<input type="date" required value={receivedOn} disabled={busy||reviewed!==null} onChange={event=>setReceivedOn(event.target.value)} /></label><p className="st-small">Received date uses {timeZone}.</p>
   <label>Payment reference (optional)<input maxLength={500} value={reference} disabled={busy||reviewed!==null} onChange={event=>setReference(event.target.value)} /></label>
   <ShippingChoice state={options} zip={customer.postal_code} setZip={value=>setCustomer({...customer,postal_code:value})} busy={busy||reviewed!==null} />
   <p>Shipping: {service?`${service.name} · ${money(service.cents)}`:'choose an option above'} · No tax recorded</p><p><strong>Total paid: {money(total)}</strong></p>
   {reviewed&&<p>Confirm these items, customer, delivery address, received date and payment record. Stock will be reserved in Pier. Shipment still requires approval.</p>}
   <div className="st-actions"><button disabled={busy||!lines.length||lines.length>50||total<50||!service||!zipOf(customer.postal_code)||options.loading}>{reviewed?'Record paid sale':'Review paid sale'}</button>{reviewed&&<button type="button" className="st-secondary" disabled={busy} onClick={()=>setReviewed(null)}>Edit sale</button>}<button type="button" className="st-secondary" disabled={busy} onClick={close}>Close manual order</button></div>
  </form>
 </section>
}
