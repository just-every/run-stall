import { useState } from 'react'
import type { Order,Run } from './types'
import { usePerson,When } from './presentation'

export function OrderNotes({order,busy,run,owner}:{order:Order;busy:boolean;run:Run;owner:boolean}) {
 const person=usePerson(),[note,setNote]=useState(''),[tag,setTag]=useState(''),[redacting,setRedacting]=useState(''),[reason,setReason]=useState('')
 const payload={orderId:order.id,revision:order.revision}
 return <section className="st-panel-block" aria-label="Internal notes and tags">
  <h3>Internal notes and tags</h3><p className="st-small">Visible only to the owner and administrators. Corrections are new notes.</p>
  {order.notes?.map(entry=><div className="st-note-entry" key={entry.id}>
   <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{entry.text}</p><p className="st-small">{person(entry.by)} · <When at={entry.at} />{entry.redaction&&<> · Redacted by {person(entry.redaction.by)} · {entry.redaction.reason}</>}</p>
   {owner&&!entry.redaction&&!order.erasedAt&&<button type="button" className="st-link" disabled={busy} onClick={()=>{setRedacting(entry.id);setReason('')}}>Redact note<span className="st-sr-only"> from {person(entry.by)} at {entry.at}</span></button>}
   {redacting===entry.id&&<form className="st-stack" aria-label="Redact internal note" onSubmit={event=>{event.preventDefault();void run('order.note.redact',{...payload,noteId:entry.id,reason}).then(saved=>{if(saved)setRedacting('')})}}><label>Redaction reason<input maxLength={500} required value={reason} onChange={event=>setReason(event.target.value)} /></label><div className="st-actions"><button disabled={busy}>Confirm redaction</button><button type="button" className="st-secondary" onClick={()=>setRedacting('')}>Cancel</button></div></form>}
  </div>)}
  {!order.erasedAt&&<form className="st-stack" aria-label="Add internal note" onSubmit={event=>{event.preventDefault();void run('order.note.add',{...payload,text:note}).then(saved=>{if(saved)setNote('')})}}><label>Internal note<textarea required maxLength={2000} value={note} disabled={busy} onChange={event=>setNote(event.target.value)} /></label><div><button className="st-secondary" disabled={busy||!note.trim()}>Add note</button></div></form>}
  <ul className="st-tag-list" aria-label="Order tags">{order.tags?.map(value=><li key={value}>{value} {!order.erasedAt&&<button className="st-link" disabled={busy} onClick={()=>void run('order.tag.remove',{...payload,tag:value})}>Remove<span className="st-sr-only"> tag {value}</span></button>}</li>)}</ul>
  {!order.erasedAt&&<form className="st-stack" aria-label="Add order tag" onSubmit={event=>{event.preventDefault();void run('order.tag.add',{...payload,tag}).then(saved=>{if(saved)setTag('')})}}><label>Tag<input required maxLength={40} value={tag} disabled={busy} onChange={event=>setTag(event.target.value)} /></label><div><button className="st-secondary" disabled={busy||!tag.trim()||(order.tags?.length??0)>=50}>Add tag</button></div></form>}
 </section>
}
