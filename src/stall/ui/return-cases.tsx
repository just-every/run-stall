import { useState } from 'react'
import { errorMessage,request } from './api'
import { Badge,Notice } from './primitives'
import { humanLabel,shortId,When } from './presentation'
import { PhotoLink, ReturnProgress } from './return-help'
import type { ReturnCase } from './customer-types'
export type StaffCase=ReturnCase&{revision:string;channel:string;decidedBy:string|null}
/** The owner or an administrator reads each request with its reasons and records one explained decision. */
export function ReturnCases({cases,reload}:{cases:StaffCase[];reload:()=>Promise<void>}) {
 const [explanations,setExplanations]=useState<Record<string,string>>({}),[error,setError]=useState(''),[busy,setBusy]=useState('')
 async function decide(item:StaffCase,decision:'accept'|'refuse') {
  setBusy(item.id);setError('')
  try{await request('/api/stall/commands',{type:'return.decide',payload:{caseId:item.id,revision:item.revision,decision,explanation:explanations[item.id]??''}});await reload()}
  catch(e){setError(errorMessage(e))}finally{setBusy('')}
 }
 return <section className="st-stack" aria-label="Return, exchange and cancellation requests">
  <h2>Return, exchange and cancellation requests</h2>
  <p>Shoppers asked for these through their account or a private order link, inside your return policy. A person decides each one and explains it to the shopper. Accepting never refunds, cancels or restocks: record those through the order. Accepting an exchange sets the replacement aside.</p>
  {error&&<Notice error>{error}</Notice>}
  {!cases.length&&<p>No return, exchange or cancellation requests yet.</p>}
  {cases.map(item=><article className="st-panel st-stack" aria-label={`Case ${item.id}`} key={item.id}>
   <div className="st-row"><h3>{humanLabel(item.kind)} · order {shortId(item.orderId)}</h3><Badge value={item.state==='requested'?'needs review':item.state} /></div>
   <p>Requested <When at={item.createdAt} /> through {item.channel==='guest_link'?'a private order link':'the shopper’s account'}.</p>
   <ul>{item.lines.map(line=><li key={line.sku}>{line.name} × {line.quantity}{line.toName?` → ${line.toName}`:''}{line.reason?` · ${humanLabel(line.reason)}`:''}</li>)}</ul>
   {item.note&&<p>Shopper’s note: {item.note}</p>}
   <a href={`#orders/${encodeURIComponent(item.orderId)}`}>Open order {item.orderId}</a>
   {item.state==='requested'?<div className="st-stack">
    {!!item.attachments?.length&&<p>Photos: {item.attachments.map(photo=><PhotoLink key={photo.id} id={photo.id} name={photo.name} headers={{}} />)}</p>}
    <label>Explanation the shopper will read<textarea maxLength={500} value={explanations[item.id]??''} disabled={busy===item.id} onChange={e=>setExplanations({...explanations,[item.id]:e.target.value})} /></label>
    <div className="st-actions"><button disabled={busy===item.id||!(explanations[item.id]??'').trim()} onClick={()=>void decide(item,'accept')}>Accept request<span className="st-sr-only"> {shortId(item.id)}</span></button>
     <button className="st-secondary" disabled={busy===item.id||!(explanations[item.id]??'').trim()} onClick={()=>void decide(item,'refuse')}>Refuse request<span className="st-sr-only"> {shortId(item.id)}</span></button></div>
   </div>:<ReturnProgress cases={[item]} />}
  </article>)}
 </section>
}
