import { useEffect,useState } from 'react'
import { request,errorMessage } from './api'
import { Notice,Section } from './primitives'
import { staffRoles } from '../permissions'
import type { Run } from './types'
type Staff={id:string;name:string;email:string;role:string;status:string;staffRole:string|null;refundLimitCents:number|null;separateApproval:number|null}
export function StaffAccess({run,busy}:{run:Run;busy:boolean}) {
 const [staff,setStaff]=useState<Staff[]>([]),[error,setError]=useState(''),[email,setEmail]=useState(''),[notice,setNotice]=useState('')
 const load=async()=>setStaff((await request<{staff:Staff[]}>('/api/stall/staff')).staff)
 useEffect(()=>{void load().catch(e=>setError(errorMessage(e)))},[])
 async function invite(event:React.FormEvent) {
  event.preventDefault();setError('');setNotice('')
  try { await request('/auth/invite',{email,displayName:email,role:'member',returnTo:'/app'});setNotice('Invitation requested. Grant a staff role after the account is active.');setEmail('');await load() } catch(e) { setError(errorMessage(e)) }
 }
 return <Section id="staff-access" title="Staff permissions">
  <p>Invite staff, then grant one shop role. Accounts without a staff grant can see only their own purchases. The owner alone changes these grants and downloads business data.</p>
  {error&&<Notice error>{error}</Notice>}{notice&&<Notice>{notice}</Notice>}
  <form onSubmit={event=>void invite(event)} className="st-stack"><label>Staff email<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label><button disabled={busy}>Invite staff</button></form>
  {staff.filter(person=>person.role!=='owner').map(person=><StaffGrant key={person.id} person={person} busy={busy} save={async payload=>{if(await run('staff.configure',payload))await load()}} />)}
 </Section>
}
function StaffGrant({person,busy,save}:{person:Staff;busy:boolean;save:(p:unknown)=>Promise<void>}) {
 const [role,setRole]=useState(person.staffRole??''),[limit,setLimit]=useState(String((person.refundLimitCents??0)/100)),[separate,setSeparate]=useState(person.separateApproval!==0)
 return <form className="st-stack st-panel" aria-label={`Permissions for ${person.email}`} onSubmit={event=>{event.preventDefault();void save({actorId:person.id,staffRole:role||null,refundLimitCents:Math.round(Number(limit)*100),separateApproval:separate})}}>
  <h3>{person.name||person.email}</h3><p>{person.email} · {person.status} · sign-in role: {person.role}</p>
  <label>Shop role<select aria-label="Shop role" value={role} onChange={e=>setRole(e.target.value)}><option value="">No staff grant</option>{staffRoles.map(value=><option key={value} value={value}>{value.replace('_',' ')}</option>)}</select></label>
  <label>Refund approval limit (USD)<input type="number" min="0" max="1000000" step="0.01" required value={limit} onChange={e=>setLimit(e.target.value)} /></label>
  <label><input type="checkbox" checked={separate} onChange={e=>setSeparate(e.target.checked)} />Another person must approve refunds</label>
  <p>Changes apply to the next request and invalidate prepared approvals. Native administrators retain their existing shop authority; their refund limit and approval separation apply here.</p>
  <button disabled={busy||person.status!=='active'}>Save permissions</button>
 </form>
}
