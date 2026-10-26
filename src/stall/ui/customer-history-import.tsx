import { useRef,useState,type FormEvent } from 'react'
import { errorMessage,money,request } from './api'
import { Notice } from './primitives'
import { When } from './presentation'
import type { HistoricalOrder } from '../customers/order-history'

type Preview={rows:{id:string;email:string;value:HistoricalOrder;duplicate:boolean}[];fingerprint:string;newCount:number;duplicateCount:number}
type Reviewed={source:string;rows:unknown[];preview:Preview}

export function HistoricalOrderImport({canManage,onImported}:{canManage:boolean;onImported?:()=>void|Promise<void>}) {
 const [source,setSource]=useState(''),[input,setInput]=useState(''),[review,setReview]=useState<Reviewed>(),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const lock=useRef(false)
 function resetReview(){setReview(undefined);setConfirmed(false);setError('');setNotice('')}
 async function inspect(event:FormEvent) {
  event.preventDefault()
  if(lock.current)return
  lock.current=true;setBusy(true);resetReview()
  try {
   const rows:unknown=JSON.parse(input)
   if(!Array.isArray(rows))throw Error('Supply a JSON array of historical order rows.')
   const preview=await request<Preview>('/api/stall/customers/history/preview',{source,rows})
   setReview({source,rows,preview})
  }catch(error){setError(errorMessage(error))}
  finally{lock.current=false;setBusy(false)}
 }
 async function apply() {
  if(lock.current||!review||!confirmed)return
  lock.current=true;setBusy(true);setError('');setNotice('')
  try {
   const result=await request<{imported:number;duplicates:number}>('/api/stall/customers/history/apply',{source:review.source,rows:review.rows,fingerprint:review.preview.fingerprint,confirmed:true})
   setReview(undefined);setConfirmed(false)
   setNotice(`${result.imported} historical orders imported. ${result.duplicates} exact duplicates skipped.`)
   try {await onImported?.()}catch(error){setError('The import completed. Refresh customers to update the directory. '+errorMessage(error))}
  }catch(error){setError(errorMessage(error));setReview(undefined);setConfirmed(false)}
  finally{lock.current=false;setBusy(false)}
 }
 if(!canManage)return null
 return <details className="st-panel st-stack" style={{overflowWrap:'anywhere'}}><summary>Import historical orders</summary>
  <p>Bring in past USD orders from a named source. Matching source and order references skip exact duplicates; different facts require reconciliation. These records appear in the verified customer’s history and paid customer totals.</p>
  <p className="st-small">Importing records moves no money, reserves no stock and sends no messages. It creates no customer sign-in account.</p>
  <form className="st-stack" aria-label="Import historical orders" onSubmit={event=>void inspect(event)}>
   <label>Historical source system<input required maxLength={100} value={source} disabled={busy} onChange={event=>{setSource(event.target.value);resetReview()}} placeholder="Previous shop"/></label>
   <label>Historical order rows · JSON<textarea required rows={8} value={input} disabled={busy} onChange={event=>{setInput(event.target.value);resetReview()}} placeholder={'[{"recordId":"order-1001","email":"customer@example.com","createdAt":"2021-06-01T12:00:00Z","status":"paid","paid":true,"lines":[{"sku":"MUG","name":"Ceramic mug","quantity":1,"unitCents":2000}],"totalCents":2000}]'}/></label>
   <p className="st-small">Use 1 to 200 rows with a source recordId, email, ISO createdAt with timezone, status, paid, lines and totalCents. Each line needs sku, name, quantity and unitCents. Optional shippingCents and taxCents must reconcile to the total. Refunds use recordId, status and amountCents. Tracking uses shippedAt, deliveryStatus and optional trackingCode and secure trackingUrl. Optional address uses name, line1, city, state, postal_code and country (US or CA), plus optional line2. Supported order statuses: processing, paid, shipped, cancelled, refunded and partially_refunded. Refund statuses: pending, succeeded and failed.</p>
   <div className="st-actions"><button disabled={busy||!source.trim()||!input.trim()}>{busy?'Checking historical orders…':'Preview historical orders'}</button></div>
  </form>
  {error&&<Notice error>{error}</Notice>}{notice&&<Notice>{notice}</Notice>}
  {review&&<section className="st-stack" aria-label="Historical order import preview">
   <h3>Review historical orders</h3><p>Source: {review.source}</p><p>{review.preview.newCount} new · {review.preview.duplicateCount} exact duplicates skipped</p>
   <ol className="st-stack" aria-label="Reviewed historical orders">{review.preview.rows.map(row=>{
    const order=row.value,refunded=order.refunds.filter(refund=>refund.status==='succeeded').reduce((sum,refund)=>sum+refund.amountCents,0)
    return <li key={row.id} className="st-panel st-stack"><h4>{order.source.recordId} · {row.duplicate?'Skip exact duplicate':'Import order'}</h4>
     <p>{row.email} · <When at={order.createdAt}/> · {order.status.replaceAll('_',' ')} · {order.paid?'Recorded as paid':'Recorded as unpaid'}</p>
     <dl className="st-definition"><div><dt>Original total</dt><dd>{money(order.totalCents)}</dd></div><div><dt>Shipping</dt><dd>{money(order.shippingCents)}</dd></div><div><dt>Tax</dt><dd>{money(order.taxCents)}</dd></div><div><dt>Succeeded refunds</dt><dd>{money(refunded)}</dd></div></dl>
     <ul>{order.lines.map((line,index)=><li key={index}>{line.name} · {line.sku} · {line.quantity} × {money(line.unitCents)}</li>)}</ul>
     {order.shippingDetails&&<address>{order.shippingDetails.name}<br/>{order.shippingDetails.address.line1}<br/>{order.shippingDetails.address.line2&&<>{order.shippingDetails.address.line2}<br/></>}{order.shippingDetails.address.city}, {order.shippingDetails.address.state} {order.shippingDetails.address.postal_code} · {order.shippingDetails.address.country}</address>}
     {!!order.refunds.length&&<ul aria-label={`Historical refunds for ${order.source.recordId}`}>{order.refunds.map(refund=><li key={refund.id}>{refund.id} · {money(refund.amountCents)} · {refund.status}</li>)}</ul>}
     {order.shipment?.dispatches.map((dispatch,index)=><p key={index}>Shipment: {dispatch.deliveryStatus} · <When at={dispatch.shippedAt}/>{dispatch.tracking.map((tracking,index)=><span key={index}>{tracking.trackingCode&&<> · Tracking: {tracking.trackingCode}</>}{tracking.trackingUrl&&<> · <a href={tracking.trackingUrl} target="_blank" rel="noreferrer">Track historical shipment</a></>}</span>)}</p>)}
    </li>
   })}</ol>
   <label className="st-checkbox"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>I reviewed this source, customer mailboxes, order facts and totals and approve this historical import.</label>
   <div className="st-actions"><button disabled={busy||!confirmed||!review.preview.newCount} onClick={()=>void apply()}>{busy?'Importing historical orders…':`Import ${review.preview.newCount} reviewed historical orders`}</button></div>
  </section>}
 </details>
}
