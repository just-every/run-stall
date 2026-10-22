import { useState } from 'react'
type Staff={id:string;email:string;name:string}
const triggerLabels=[['low_stock','Low stock'],['overdue_fulfillment','Overdue fulfillment'],['return_request','Return request'],['cancellation_request','Cancellation request'],['order','Order changed'],['customer','Customer created'],['scheduled_reconciliation','Scheduled reconciliation'],['promotion','Promotion (source pending)']]
export function WorkflowEditor({staff,timeZone,busy,run}:{staff:Staff[];timeZone:string;busy:boolean;run:(type:string,payload:unknown)=>Promise<boolean>}) {
 const [name,setName]=useState(''),[trigger,setTrigger]=useState('low_stock'),[assignee,setAssignee]=useState(''),[due,setDue]=useState('1440'),[threshold,setThreshold]=useState('5'),[sku,setSku]=useState(''),[hours,setHours]=useState('168'),[localTime,setLocalTime]=useState('09:00'),[quiet,setQuiet]=useState(false),[start,setStart]=useState('20:00'),[end,setEnd]=useState('08:00'),[action,setAction]=useState('task')
 const rule={name,trigger,assigneeId:assignee,dueMinutes:Number(due),notifyStaff:true,action,conditions:{...(sku&&['low_stock','overdue_fulfillment','order'].includes(trigger)?{sku}:{}),...(trigger==='low_stock'?{stockAtMost:Number(threshold)}:{}),...(trigger==='overdue_fulfillment'?{overdueHours:Number(hours)}:{})},...(trigger==='scheduled_reconciliation'?{localTime}:{}),...(quiet?{quietHours:{start,end}}:{})}
 return <form className="st-stack st-panel" aria-label="New workflow rule" onSubmit={e=>{e.preventDefault();void run('workflow.save',{rule}).then(saved=>{if(saved)setName('')})}}>
  <h3>New workflow rule</h3><label>Rule name<input required maxLength={100} value={name} onChange={e=>setName(e.target.value)} /></label>
  <label>Trigger<select value={trigger} onChange={e=>setTrigger(e.target.value)}>{triggerLabels.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
  <label>Responsible staff<select required value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">Choose active staff</option>{staff.map(person=><option key={person.id} value={person.id}>{person.name||person.email}</option>)}</select></label>
  <label>Due after matching (minutes)<input required type="number" min="1" max="525600" value={due} onChange={e=>setDue(e.target.value)} /></label>
  {['low_stock','overdue_fulfillment','order'].includes(trigger)&&<label>Item SKU condition (optional)<input value={sku} onChange={e=>setSku(e.target.value)} /></label>}
  {trigger==='low_stock'&&<label>Stock at most<input required type="number" min="0" value={threshold} onChange={e=>setThreshold(e.target.value)} /></label>}
  {trigger==='overdue_fulfillment'&&<label>Overdue after elapsed hours<input required type="number" min="0" max="8760" value={hours} onChange={e=>setHours(e.target.value)} /></label>}
  {trigger==='scheduled_reconciliation'&&<label>Daily time ({timeZone})<input required type="time" value={localTime} onChange={e=>setLocalTime(e.target.value)} /></label>}
  <label>Action<select value={action} onChange={e=>setAction(e.target.value)}><option value="task">Internal task</option><option value="draft_followup">Human-reviewed draft follow-up</option><option value="reconcile_followup">Human-reviewed reconciliation follow-up</option></select></label>
  <label className="st-check"><input type="checkbox" checked={quiet} onChange={e=>setQuiet(e.target.checked)} />Hold staff alerts during quiet hours ({timeZone})</label>
  {quiet&&<div className="st-form-grid"><label>Quiet hours start<input type="time" required value={start} onChange={e=>setStart(e.target.value)} /></label><label>Quiet hours end<input type="time" required value={end} onChange={e=>setEnd(e.target.value)} /></label></div>}
  <div className="st-actions"><button disabled={busy}>Save workflow draft</button><button type="button" className="st-secondary" disabled={busy||!name||!assignee} onClick={()=>void run('workflow.dry-run',{rule})}>Dry-run rule</button></div>
 </form>
}
