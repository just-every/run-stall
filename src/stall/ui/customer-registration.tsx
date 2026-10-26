import { useEffect,useState,type FormEvent } from 'react'
import { errorMessage,request } from './api'
import { Notice,Section } from './primitives'

export function CustomerRegistrationForm() {
 const [email,setEmail]=useState(''),[displayName,setDisplayName]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 async function submit(event:FormEvent) {
  event.preventDefault();setBusy(true);setError('');setNotice('')
  try {
   const result=await request<{message:string}>('/api/stall/customer/registration',{email,displayName,necessaryAccountConsent:consent})
   setNotice(result.message);setEmail('');setDisplayName('');setConsent(false)
  }catch(error){setError(errorMessage(error))}finally{setBusy(false)}
 }
 return <Section title="Request an account">
  <p>The shop owner reviews account requests. If approved, you will receive a single-use email link to verify your address before you can sign in. Unreviewed requests expire after seven days.</p>
  {error&&<Notice error>{error}</Notice>}{notice&&<Notice>{notice}</Notice>}
  <form className="st-stack" aria-label="Customer account request" onSubmit={event=>void submit(event)}>
   <label>Your name<input required autoComplete="name" maxLength={120} value={displayName} disabled={busy} onChange={event=>setDisplayName(event.target.value)}/></label>
   <label>Email address<input required type="email" autoComplete="email" maxLength={254} value={email} disabled={busy} onChange={event=>setEmail(event.target.value)}/></label>
   <label className="st-checkbox"><input required type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/>I agree that the shop may use my name and email to review this request and send necessary account emails.</label>
   <p className="st-small">This choice does not subscribe you to marketing.</p>
   <div className="st-actions"><button disabled={busy||!consent}>{busy?'Submitting…':'Request account review'}</button></div>
  </form>
 </Section>
}

type RegistrationRequest={id:string;email:string;displayName:string;requestedAt:number;expiresAt:number;consentVersion:string;status:'pending'|'sending'|'failed'}
function RegistrationRequestReview({item,busy,decide}:{item:RegistrationRequest;busy:boolean;decide:(id:string,decision:'approve'|'decline')=>Promise<void>}) {
 const [reviewed,setReviewed]=useState(false)
 return <article className="st-panel st-stack" aria-label={`Account request from ${item.email}`}>
  <h3>{item.displayName}</h3><p style={{overflowWrap:'anywhere'}}>{item.email}</p>
  <p>Requested {new Date(item.requestedAt).toLocaleString()}. Expires {new Date(item.expiresAt).toLocaleString()}.</p>
  <p>The requester agreed to account review and necessary account emails. Their email address is unverified.</p>
  {item.status==='pending'?<>
   <p>Approval sends a native account invitation. Access begins only after the person verifies their email through its link.</p>
   <label className="st-checkbox"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event=>setReviewed(event.target.checked)}/>I reviewed this request and am ready to approve or decline it.</label>
   <div className="st-actions"><button disabled={busy||!reviewed} onClick={()=>void decide(item.id,'approve')}>Approve and send verification</button><button className="st-secondary" disabled={busy||!reviewed} onClick={()=>void decide(item.id,'decline')}>Decline request</button></div>
  </>:<Notice error={item.status==='failed'}>{item.status==='sending'?'Invitation approval is being processed. Refresh to see its result.':'Invitation delivery was not confirmed. Review the native invitation record before taking another action.'}</Notice>}
 </article>
}

export function RegistrationRequests() {
 const [items,setItems]=useState<RegistrationRequest[]>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 async function load() {const result=await request<{requests:RegistrationRequest[]}>('/api/stall/customer/registration-requests');setItems(result.requests)}
 useEffect(()=>{void load().catch(error=>setError(errorMessage(error)))},[])
 async function refresh(){setBusy(true);setError('');try{await load()}catch(error){setError(errorMessage(error))}finally{setBusy(false)}}
 async function decide(id:string,decision:'approve'|'decline') {
  setBusy(true);setError('');setNotice('')
  try {
   await request('/api/stall/customer/registration-requests',{id,decision,reviewed:true})
   setNotice(decision==='approve'?'Invitation sent. Email verification is required before account access.':'Account request declined.');await load()
  }catch(error){setError(errorMessage(error));await load().catch(()=>{})}finally{setBusy(false)}
 }
 return <Section title="Account requests">
  <p>Only the owner using a native sign-in session can review these requests. Approval creates an invitation for a customer account.</p>
  {error&&<Notice error>{error}</Notice>}{notice&&<Notice>{notice}</Notice>}
  <div className="st-actions"><button className="st-secondary" disabled={busy} onClick={()=>void refresh()}>Refresh account requests</button></div>
  {!items&&!error&&<p role="status">Loading account requests…</p>}{items?.length===0&&<p>No account requests are awaiting review.</p>}
  {items?.map(item=><RegistrationRequestReview key={item.id} item={item} busy={busy} decide={decide}/>)}
 </Section>
}
