import { useEffect,useRef,useState } from 'react'
import type { TaxAddress,TaxConfiguration,TaxConfigurationValue,TaxExemption,TaxExemptions } from '../tax/configuration'
import { errorMessage,request } from './api'
import { Notice,Section } from './primitives'
import { TaxPreview } from './tax-preview'

type ThresholdDraft={state:string;salesCents:string;transactions:string;warningPercent:string}
type Draft={shipFrom:TaxAddress;categories:{sku:string;taxCode:string}[];thresholds:ThresholdDraft[]}
const blankAddress=():TaxAddress=>({line1:'',line2:'',city:'',state:'',postal_code:'',country:'US'})
const draftOf=(value:TaxConfiguration):Draft=>({shipFrom:value.shipFrom??blankAddress(),categories:value.categories,thresholds:value.thresholds.map(row=>({...row,salesCents:String(row.salesCents),transactions:String(row.transactions),warningPercent:String(row.warningPercent)}))})
function whole(value:string,label:string) {
 if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw new Error(`${label} must be a whole number.`)
 return Number(value)
}
function valueOf(draft:Draft):TaxConfigurationValue {
 const {shipFrom,categories,thresholds}=draft
 return {shipFrom:Object.entries(shipFrom).some(([key,value])=>key!=='country'&&value.trim())?shipFrom:null,categories,thresholds:thresholds.map(row=>({state:row.state,salesCents:whole(row.salesCents,'Sales cents'),transactions:whole(row.transactions,'Transactions'),warningPercent:whole(row.warningPercent,'Warning percent')}))}
}
type Readiness={states:string[];observedAt?:string;accountId?:string;connectedAccountId?:string;boundary?:{accountId?:string};registrations?:{state?:string;id?:string;status?:string}[]}

export function TaxSettings() {
 const [initial,setInitial]=useState<{configuration:TaxConfiguration;evidence:TaxExemptions}>(),[error,setError]=useState(''),[loading,setLoading]=useState(false)
 async function load() {
  setLoading(true);setError('')
  try {const [configuration,evidence]=await Promise.all([request<TaxConfiguration>('/api/stall/tax/configuration'),request<TaxExemptions>('/api/stall/tax/exemptions')]);setInitial({configuration,evidence})}
  catch(error){setError(errorMessage(error))}finally{setLoading(false)}
 }
 useEffect(()=>{void load()},[])
 return <Section id="tax-settings" title="Tax settings">
  <p>Keep merchant configuration and reviewed evidence here. Taxed checkout is enabled separately; configuration does not register your business.</p>
  {error&&<Notice error>{error} <button className="st-secondary" onClick={()=>void load()} disabled={loading}>Retry tax settings</button></Notice>}
  {!initial&&!error&&<p role="status">Loading tax settings…</p>}
  {initial&&<><TaxConfigurationEditor initial={initial.configuration} onSaved={configuration=>setInitial(previous=>previous?{...previous,configuration}:previous)} /><ExemptionEvidence initial={initial.evidence} /><TaxReadiness /><TaxPreview configuration={initial.configuration} /></>}
 </Section>
}
function TaxConfigurationEditor({initial,onSaved}:{initial:TaxConfiguration;onSaved:(value:TaxConfiguration)=>void}) {
 const [draft,setDraft]=useState(()=>draftOf(initial)),[error,setError]=useState(''),[status,setStatus]=useState('')
 const current=useRef(draft),revision=useRef(initial.revision),saved=useRef(JSON.stringify(draft)),queue=useRef(Promise.resolve()),pending=useRef(0)
 function update(next:Draft){current.current=next;setDraft(next);setStatus('')}
 function persist(next=current.current) {
  const snapshot=JSON.stringify(next)
  if(snapshot===saved.current&&pending.current===0)return
  pending.current++;setStatus('Saving…')
  queue.current=queue.current.then(async()=>{
   if(snapshot===saved.current)return
   try {
    const result=await request<TaxConfiguration>('/api/stall/tax/configuration',{revision:revision.current,value:valueOf(next)})
    revision.current=result.revision;saved.current=snapshot;setError('');onSaved(result)
   }catch(error){setError(errorMessage(error))}
  }).finally(()=>{pending.current--;setStatus(pending.current?'Saving…':JSON.stringify(current.current)===saved.current?'Saved':'Changes kept here; correct the issue and leave the field to retry.')})
 }
 function remove(kind:'categories'|'thresholds',index:number) {const next={...current.current,[kind]:current.current[kind].filter((_,i)=>i!==index)};update(next);persist(next)}
 return <div className="st-stack">
  {error&&<Notice error>{error}</Notice>}{status&&<p role="status">{status}</p>}
  <details><summary>Ship-from address</summary><div className="st-stack">
   <p>Use the US address goods ship from. It is stored locally until you explicitly request a provider preview.</p>
   <form className="st-stack" aria-label="Tax ship-from address" onSubmit={event=>event.preventDefault()}>
    {([['line1','Street address'],['line2','Address line 2'],['city','City'],['state','State'],['postal_code','ZIP code']] as const).map(([key,label])=><label key={key}>{label}<input name={`tax-ship-${key}`} autoComplete="off" value={draft.shipFrom[key]??''} maxLength={key==='state'?2:key==='postal_code'?10:key==='city'?100:200} onChange={event=>update({...current.current,shipFrom:{...current.current.shipFrom,[key]:event.target.value}})} onBlur={()=>persist()} /></label>)}
    <p>Country: United States</p>
    <button type="button" className="st-secondary" onClick={()=>{const next={...current.current,shipFrom:blankAddress()};update(next);persist(next)}}>Clear ship-from address</button>
   </form>
  </div></details>
  <details><summary>Product tax codes · {draft.categories.length}</summary><div className="st-stack">
   <p>Map each product or variant SKU to an explicit Stripe txcd_ code. A catalog tax category does not supply this mapping.</p>
   {draft.categories.map((row,index)=><div className="st-stack" key={index}>
    <label>SKU<input aria-label={`Tax code SKU ${index+1}`} value={row.sku} maxLength={100} onChange={event=>update({...current.current,categories:current.current.categories.map((item,i)=>i===index?{...item,sku:event.target.value}:item)})} onBlur={()=>persist()} /></label>
    <label>Product tax code<input aria-label={`Product tax code ${index+1}`} placeholder="txcd_ followed by eight digits" value={row.taxCode} maxLength={20} onChange={event=>update({...current.current,categories:current.current.categories.map((item,i)=>i===index?{...item,taxCode:event.target.value}:item)})} onBlur={()=>persist()} /></label>
    <button type="button" className="st-secondary" onClick={()=>remove('categories',index)}>Remove tax code {row.sku||index+1}</button>
   </div>)}
   <button type="button" className="st-secondary" onClick={()=>update({...current.current,categories:[...current.current.categories,{sku:'',taxCode:''}]})}>Add SKU tax code</button>
  </div></details>
  <details><summary>Economic nexus thresholds · {draft.thresholds.length}</summary><div className="st-stack">
   <p>Enter the thresholds you have reviewed for each state. Either positive measure can trigger a warning; zero disables that measure. Warnings do not register your business.</p>
   {draft.thresholds.map((row,index)=><div className="st-stack" key={index}>
    <label>State<input aria-label={`Threshold state ${index+1}`} maxLength={2} value={row.state} onChange={event=>update({...current.current,thresholds:current.current.thresholds.map((item,i)=>i===index?{...item,state:event.target.value}:item)})} onBlur={()=>persist()} /></label>
    {([['salesCents','Sales threshold · USD cents'],['transactions','Transaction threshold'],['warningPercent','Warn at percent of threshold']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={`${label} ${index+1}`} type="number" min={key==='warningPercent'?1:0} max={key==='warningPercent'?100:undefined} step="1" value={row[key]} onChange={event=>update({...current.current,thresholds:current.current.thresholds.map((item,i)=>i===index?{...item,[key]:event.target.value}:item)})} onBlur={()=>persist()} /></label>)}
    <button type="button" className="st-secondary" onClick={()=>remove('thresholds',index)}>Remove threshold {row.state||index+1}</button>
   </div>)}
   <button type="button" className="st-secondary" onClick={()=>update({...current.current,thresholds:[...current.current.thresholds,{state:'',salesCents:'0',transactions:'0',warningPercent:'80'}]})}>Add state threshold</button>
  </div></details>
 </div>
}
function ExemptionEvidence({initial}:{initial:TaxExemptions}) {
 const [rows,setRows]=useState(()=>initial.exemptions.length?initial.exemptions.map(value=>({key:value.id,value:value as TaxExemption|null})):[{key:'new-evidence',value:null}])
 const [total,setTotal]=useState(initial.total)
 return <details open={!initial.exemptions.length}><summary>Customer exemption evidence · {total}</summary><div className="st-stack">
  <p>Document evidence you reviewed for a customer and state. Evidence alone never waives tax; separately enabled taxed checkout uses a current record only for a proven customer identity and matching state. Expired, revoked and restored records remain historical evidence.</p>
  {initial.truncated&&<Notice>Showing the {initial.limit} most recently reviewed records of {initial.total}. Older records remain stored.</Notice>}
  {rows.map(row=><ExemptionEditor key={row.key} initial={row.value} onCreated={()=>setTotal(count=>count+1)} />)}
  <button type="button" className="st-secondary" onClick={()=>setRows([...rows,{key:crypto.randomUUID(),value:null}])}>Add exemption evidence</button>
 </div></details>
}
type EvidenceDraft={customerEmail:string;state:string;evidenceReference:string;expiresOn:string;revoked:boolean}
const evidenceValue=(value:EvidenceDraft):EvidenceDraft=>({customerEmail:value.customerEmail,state:value.state,evidenceReference:value.evidenceReference,expiresOn:value.expiresOn,revoked:value.revoked})
function ExemptionEditor({initial,onCreated}:{initial:TaxExemption|null;onCreated:()=>void}) {
 const [draft,setDraft]=useState<EvidenceDraft>(()=>initial?evidenceValue(initial):{customerEmail:'',state:'',evidenceReference:'',expiresOn:'',revoked:false}),[error,setError]=useState(''),[status,setStatus]=useState(''),[review,setReview]=useState(initial),[reviewConsent,setReviewConsent]=useState(false),[reviewing,setReviewing]=useState(false)
 const current=useRef(draft),record=useRef(initial),saved=useRef(initial?JSON.stringify(evidenceValue(initial)):''),queue=useRef(Promise.resolve()),pending=useRef(0)
 function update(next:EvidenceDraft){current.current=next;setDraft(next);setStatus('');setReviewConsent(false)}
 function persist(reviewRestored=false) {
  if(reviewRestored&&(!reviewConsent||!record.current?.restored)){setError('Affirm your fresh local review of this historical evidence before reviewing it.');return}
  const next=evidenceValue(current.current),snapshot=JSON.stringify(next)
  let reviewed=false
  if(!next.customerEmail.trim()||!next.state.trim()||!next.evidenceReference.trim()||!next.expiresOn){setStatus('Complete the email, state, evidence reference and expiration date to record your review.');return}
  if(!reviewRestored&&snapshot===saved.current&&pending.current===0)return
  if(reviewRestored)setReviewing(true)
  pending.current++;setStatus('Recording review…')
  queue.current=queue.current.then(async()=>{
   if(!reviewRestored&&snapshot===saved.current)return
   try {const creating=!record.current,result=await request<TaxExemption>('/api/stall/tax/exemptions',{...(record.current?{id:record.current.id,revision:record.current.revision}:{}),...next,...(reviewRestored?{reviewRestored:true}:{})});record.current=result;setReview(result);saved.current=snapshot;setError('');if(reviewRestored){reviewed=true;setReviewConsent(false)}if(creating)onCreated()}
   catch(error){setError(errorMessage(error))}
  }).finally(()=>{pending.current--;if(reviewRestored)setReviewing(false);setStatus(pending.current?'Recording review…':reviewRestored&&!reviewed?'Local review failed; historical evidence remains.':JSON.stringify(evidenceValue(current.current))===saved.current?'Saved':'Changes kept here; correct the issue and leave the field to retry.')})
 }
 return <details open={!initial}><summary>{review?`${review.customerEmail} · ${review.state}`:'New exemption evidence'}</summary><form className="st-stack" aria-label={initial?`Exemption evidence for ${initial.customerEmail}`:'New exemption evidence'} onSubmit={event=>event.preventDefault()}>
  {([['customerEmail','Customer email','email',254],['state','Jurisdiction state','text',2],['evidenceReference','Evidence reference or document name','text',300],['expiresOn','Evidence expires on','date',10]] as const).map(([key,label,type,maxLength])=><label key={key}>{label}<input type={type} maxLength={maxLength} required value={draft[key]} disabled={reviewing} onChange={event=>update({...current.current,[key]:event.target.value})} onBlur={()=>persist()} /></label>)}
  <label className="st-check"><input type="checkbox" checked={draft.revoked} disabled={reviewing} onChange={event=>update({...current.current,revoked:event.target.checked})} onBlur={()=>persist()} />Evidence revoked</label>
  {review&&<p>Reviewed {review.reviewedAt.slice(0,10)}{review.revoked?' · revoked':''} · expires {review.expiresOn}</p>}
  {review?.restored&&<div className="st-stack"><Notice>Historical evidence</Notice><label className="st-check"><input type="checkbox" checked={reviewConsent} disabled={reviewing} onChange={event=>setReviewConsent(event.target.checked)} />I have freshly reviewed the currently shown document, customer email, jurisdiction state and expiration date for this installation.</label><button type="button" className="st-secondary" disabled={!reviewConsent||reviewing} onClick={()=>persist(true)}>{reviewing?'Recording local review…':'Review restored evidence'}</button></div>}
  {error&&<Notice error>{error}</Notice>}{status&&<p role="status">{status}</p>}
 </form></details>
}
function TaxReadiness() {
 const [value,setValue]=useState<Readiness>(),[busy,setBusy]=useState(false),[error,setError]=useState('')
 async function inspect() {
  setBusy(true);setError('');setValue(undefined)
  try{setValue(await request<Readiness>('/api/stall/tax/readiness'))}catch(error){setError(errorMessage(error))}finally{setBusy(false)}
 }
 const account=value?.boundary?.accountId??value?.accountId??value?.connectedAccountId
 return <details><summary>Connected Stripe Tax readiness</summary><div className="st-stack">
  <p>Read the connected account’s tax settings and active registrations when requested. This check sends no customer address and changes no provider settings.</p>
  <button type="button" className="st-secondary" disabled={busy} onClick={()=>void inspect()}>{busy?'Checking Stripe Tax…':'Check Stripe Tax readiness'}</button>
  {error&&<Notice error>{error}</Notice>}
  {value&&<><p>Active US registrations: {value.states.join(', ')||'None'}.</p>{account&&<p style={{overflowWrap:'anywhere'}}>Connected account: {account}</p>}{value.observedAt&&<p>Checked {value.observedAt}</p>}</>}
 </div></details>
}
