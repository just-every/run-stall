import { useState } from 'react'
import { money } from './api'
import { Notice } from './primitives'
import { shortId } from './presentation'
export type ShipmentTask={id:string;shipmentDraft:{shipmentId:string;reference:string;draftRevision:string}|null;shipmentPreparation:{available:boolean;reason:string|null;orderId:string;revision:string|null;status:string|null;totalCents:number|null;lines:{sku:string;name:string;quantity:number}[]}|null}
export function WorkflowShipment({task,busy,run,refresh}:{task:ShipmentTask;busy:boolean;run:(type:string,payload:unknown)=>Promise<boolean>;refresh:()=>Promise<void>}) {
 const [reference,setReference]=useState(''),[refreshing,setRefreshing]=useState(false)
 const prep=task.shipmentPreparation,draft=task.shipmentDraft
 if(draft) return <Notice>Shipment draft {shortId(draft.shipmentId)} prepared: {draft.reference}. It awaits a separate authorized approval in the order desk. No stock was dispatched.</Notice>
 if(!prep) return null
 return <form className="st-stack" aria-label="Prepare workflow shipment draft" onSubmit={e=>{e.preventDefault();void run('workflow.task.prepare-shipment',{id:task.id,revision:prep.revision,reference})}}>
  <h5>Review shipment draft</h5>
  <p>Order {shortId(prep.orderId)} · {prep.status??'Status unavailable'} · {typeof prep.totalCents==='number'?money(prep.totalCents):'Total unavailable'}</p>
  <ul>{prep.lines.map(l=><li key={l.sku}>{l.quantity} × {l.name} ({l.sku})</li>)}</ul>
  {prep.revision&&<p style={{overflowWrap:'anywhere'}}>Reviewed order revision: {prep.revision}</p>}
  {prep.reason&&<Notice error>{prep.reason}</Notice>}
  <label>Shipment reference<input required maxLength={160} value={reference} onChange={e=>setReference(e.target.value)} /></label>
  <p>Prepare saves a draft only. A person must separately review and approve shipment from the order desk.</p>
  <div className="st-actions"><button disabled={busy||refreshing||!prep.available}>Prepare shipment draft</button><button type="button" className="st-secondary" disabled={busy||refreshing} onClick={()=>{setRefreshing(true);void refresh().finally(()=>setRefreshing(false))}}>Refresh current order</button></div>
 </form>
}
