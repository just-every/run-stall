import { useEffect,useState } from 'react'
import type { Order,Run } from './types'
import { usePerson,When } from './presentation'

export function OrderAssignment({order,staff,busy,run}:{order:Order;staff:Record<string,string>;busy:boolean;run:Run}) {
 const person=usePerson(),current=order.assignments?.at(-1)?.assigneeId??''
 const [selected,setSelected]=useState(current)
 useEffect(()=>setSelected(current),[current,order.revision])
 return <section className="st-panel-block">
  <h3>Responsible staff</h3>
  <p className="st-small">{current?person(current):'Unassigned'}. Assignment does not change access permissions.</p>
  <form className="st-stack" aria-label="Order assignment" onSubmit={event=>{event.preventDefault();void run('order.assign',{orderId:order.id,revision:order.revision,assigneeId:selected||null})}}>
   <label>Assign to<select value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)}><option value="">Unassigned</option>{current&&!staff[current]&&<option value={current} disabled>{person(current)} (inactive)</option>}{Object.entries(staff).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
   <div className="st-actions"><button className="st-secondary" disabled={busy||selected===current}>Save assignment</button></div>
  </form>
  {!!order.assignments?.length&&<details><summary>Assignment history</summary>{[...order.assignments].reverse().map(change=><p className="st-small" key={change.id}>{change.assigneeId?`Assigned to ${person(change.assigneeId)}`:'Unassigned'} by {person(change.by)} · <When at={change.at} /></p>)}</details>}
 </section>
}
