import { useEffect,useState } from 'react'
import { request,errorMessage } from './api'
import { Badge,Notice,RecordDetail,Section } from './primitives'
import { humanLabel,shortId,When } from './presentation'
import { WorkflowEditor } from './workflow-editor'
import { WorkflowShipment,type ShipmentTask } from './workflow-shipment'
type Rule={id:string;revision:string;state:string;localAuthority:boolean;value:{name:string;trigger:string;assigneeId:string;dueMinutes:number};checkedAt?:string;errorCode?:string;source:{available:boolean;reason:string}}
type Task=ShipmentTask&{id:string;ruleId:string;sourceKind:string;sourceId:string;status:string;assigneeId:string;dueAt:string;dispatchAt:string;humanApprovalRequired:boolean;errorCode?:string}
export type WorkflowData={rules:Rule[];tasks:Task[];notifications:{id:string;taskId:string;readAt?:string}[];staff:{id:string;email:string;name:string}[];timeZone:string;canManage:boolean;total:number;truncated:boolean;unsupported:string[]}
export function Workflows() {
 const [data,setData]=useState<WorkflowData>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState<unknown>(),[notice,setNotice]=useState('')
 const load=async()=>setData(await request<WorkflowData>('/api/stall/workflows'))
 useEffect(()=>{void load().catch(e=>setError(errorMessage(e)))},[])
 async function run(type:string,payload:unknown) {
  if(busy)return false;setBusy(true);setError('');setNotice('')
  try {const {result}=await request<{result:unknown}>('/api/stall/workflows',{type,payload});if(type==='workflow.dry-run')setPreview(result);else{await load();setNotice(type==='workflow.task.complete'?'Task marked complete. No commercial effect was performed.':type==='workflow.task.prepare-shipment'?'Shipment draft prepared. Separate approval is required; no stock was dispatched.':'Workflow state saved.')}return true}catch(e){setError(errorMessage(e));return false}finally{setBusy(false)}
 }
 return <Section id="workflows" title="Workflows and follow-up">
  {error&&<Notice error>{error}</Notice>}{notice&&<Notice>{notice}</Notice>}
  <p>Rules create visible internal tasks and staff alerts. Draft and reconciliation follow-up still require a person with the appropriate authority; completing a task moves no money or stock.</p>
  {data&&<>{data.canManage&&<><WorkflowEditor staff={data.staff} timeZone={data.timeZone} busy={busy} run={run} /><button disabled={busy} onClick={()=>void run('workflow.run',{})}>Run active workflows now</button>
   {preview!==undefined&&<RecordDetail label="Dry-run explanation" value={preview} />}
   {data.rules.map(rule=><article className="st-panel st-stack" key={rule.id} aria-label={`Workflow ${rule.value.name}`}><div className="st-row"><h3>{rule.value.name}</h3><Badge value={rule.state==='active'&&!rule.localAuthority?'local activation required':rule.state} /></div><p>{rule.value.trigger.replaceAll('_',' ')} · due in {rule.value.dueMinutes} minutes · {data.staff.find(s=>s.id===rule.value.assigneeId)?.name||shortId(rule.value.assigneeId)}</p><p>{rule.source.reason}</p>{rule.errorCode&&<Notice error>Evaluation needs attention: {rule.errorCode}</Notice>}{rule.checkedAt&&<p>Last checked <When at={rule.checkedAt} /></p>}<div className="st-actions"><button className="st-secondary" disabled={busy} onClick={()=>void run('workflow.dry-run',{id:rule.id})}>Explain matches</button>{rule.state==='active'&&rule.localAuthority?<button className="st-secondary" disabled={busy} onClick={()=>void run('workflow.pause',{id:rule.id,revision:rule.revision})}>Pause rule</button>:<button disabled={busy||!rule.source.available} onClick={()=>void run('workflow.activate',{id:rule.id,revision:rule.revision})}>Activate rule</button>}</div></article>)}
   <p>Still owed: {data.unsupported.join('; ')}.</p>
  </>}
  <h3>Follow-up tasks ({data.total})</h3>{data.truncated&&<p>Newest 100 shown.</p>}{!data.tasks.length&&<p>No follow-up tasks yet.</p>}
  {data.tasks.map(task=><article className="st-panel st-stack" key={task.id} aria-label={`Task ${task.id}`}><div className="st-row"><h4>{data.rules.find(r=>r.id===task.ruleId)?.value.name||'Assigned follow-up'}</h4><Badge value={task.status} /></div><p style={{overflowWrap:'anywhere'}}>{task.sourceKind} · {task.sourceKind==='stock'?task.sourceId:shortId(task.sourceId)} · responsible: {data.staff.find(s=>s.id===task.assigneeId)?.name||shortId(task.assigneeId)}</p><p>Due <When at={task.dueAt} /> · alert after <When at={task.dispatchAt} /> ({data.timeZone})</p>{task.humanApprovalRequired&&<Notice>A person must review the source record and use its authorized workflow. This task has no commercial approval.</Notice>}{task.errorCode&&<Notice error>{task.errorCode==='RULE_PAUSED'?'This rule is paused or needs local activation. An owner or administrator must activate it before pending work can resume.':task.errorCode==='CUSTOMER_ERASED'?'Customer follow-up stopped after erasure.':task.errorCode==='ASSIGNEE'?'The responsible person no longer has active staff access. Ask an owner or administrator to review the assignment.':humanLabel(task.errorCode)}</Notice>}<WorkflowShipment task={task} busy={busy} run={run} refresh={async()=>{try{await load();setError('')}catch(e){setError(errorMessage(e))}}} />{task.status==='open'&&<button disabled={busy} onClick={()=>void run('workflow.task.complete',{id:task.id})}>Mark task complete</button>}{data.canManage&&['paused','failed'].includes(task.status)&&<button disabled={busy} onClick={()=>void run('workflow.task.retry',{id:task.id})}>Recheck pending task</button>}{data.notifications.filter(n=>n.taskId===task.id&&!n.readAt).map(n=><button className="st-secondary" key={n.id} disabled={busy} onClick={()=>void run('workflow.notification.read',{id:n.id})}>Mark task alert read</button>)}</article>)}
  </>}
 </Section>
}
