import { useEffect,useRef,useState } from 'react'
import { errorMessage,money,request } from './api'
import { Notice } from './primitives'

type Purchase={lines:{sku:string;quantity:number;personalization?:Record<string,string>}[];customerEmail:string;shipping?:{service:string;postalCode?:string;quote:string};promotionCode?:string}
type Mode={enabled:boolean;requiresReview?:boolean;shopperConsent:string}
type Quote={quoteId:string;calculationId:string;taxCents:number;totalCents:number;expiresAt:number;exempt:boolean;jurisdictions:{level:string;name:string;state:string;ratePercent:string;amountCents:number}[];unallocatedTaxCents:number}
type Destination={line1:string;line2:string;city:string;state:string;postal_code:string;country:'US'}
export function useTaxCheckout(purchase:Purchase,zip:string,setZip:(value:string)=>void,initialDestination?:{line1:string;line2?:string;city:string;state:string}) {
 const [mode,setMode]=useState<Mode>(),[destination,setDestination]=useState<Destination>({line1:'',line2:'',city:'',state:'',postal_code:'',country:'US'}),[consent,setConsent]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState<{key:string;value:Quote}>(),[clock,setClock]=useState(Date.now())
 useEffect(()=>{if(initialDestination)setDestination(value=>({...value,line1:initialDestination.line1,line2:initialDestination.line2??'',city:initialDestination.city,state:initialDestination.state}))},[initialDestination?.line1,initialDestination?.line2,initialDestination?.city,initialDestination?.state])
 const [recovery,setRecovery]=useState({quoteId:'',calculationId:''})
 const generation=useRef(0),attempt=useRef<{key:string;id:string}|undefined>(undefined)
 useEffect(()=>{let active=true;request<Mode>('/api/stall/tax/mode').then(value=>{if(active)setMode(value)}).catch(error=>{if(active)setError(errorMessage(error))});return()=>{active=false}},[])
 const address={...destination,postal_code:zip.trim()},key=JSON.stringify({purchase,address}),current=result?.key===key&&result.value.expiresAt*1000>clock?result.value:undefined
 useEffect(()=>{generation.current++;setConsent(false);setResult(undefined);setError('')},[key])
 useEffect(()=>{if(!current)return;const timer=setTimeout(()=>setClock(Date.now()),Math.max(1,Math.min(60000,current.expiresAt*1000-Date.now())));return()=>clearTimeout(timer)},[current,clock])
 async function quote() {
  if(!mode?.enabled||!consent||busy)return
  const version=++generation.current;setBusy(true);setError('')
  if(attempt.current?.key!==key)attempt.current={key,id:crypto.randomUUID()}
  try {const value=await request<Quote>('/api/stall/tax/quote',{...purchase,id:recovery.quoteId.trim()||attempt.current!.id,...(recovery.calculationId.trim()?{calculationId:recovery.calculationId.trim()}:{}),destination:address,consent:mode.shopperConsent});if(version===generation.current){setClock(Date.now());setResult({key,value})}}
  catch(error){if(version===generation.current)setError(errorMessage(error))}finally{setBusy(false)}
 }
 return {recovery,setRecovery,requiresReview:!!mode?.requiresReview,enabled:mode?.enabled??false,loading:!mode,blocked:!mode||!!mode.requiresReview||(mode.enabled&&!current),quote:current,error,busy,consent,setConsent,disclosure:mode?.shopperConsent??'',address,change:(field:keyof Destination,value:string)=>{if(field==='postal_code')setZip(value);else setDestination(current=>({...current,[field]:value}))},calculate:quote}
}
export function TaxCheckout({state,disabled}:{state:ReturnType<typeof useTaxCheckout>;disabled:boolean}) {
 if(state.loading)return <p role="status">Checking tax checkout availability…{state.error&&<span role="alert"> {state.error}</span>}</p>
 if(state.requiresReview)return <Notice error>The shop owner needs to review restored tax settings before checkout can accept payments.</Notice>
 if(!state.enabled)return null
 return <div className="st-stack" role="group" aria-label="Sales tax quote">
  <fieldset className="st-stack" disabled={disabled||state.busy}><legend>US address for sales tax</legend>
   {([['line1','Street address','address-line1'],['line2','Address line 2','address-line2'],['city','City','address-level2'],['state','State','address-level1'],['postal_code','ZIP code','postal-code']] as const).map(([key,label,complete])=><label key={key}>{label}<input autoComplete={complete} required={key!=='line2'} maxLength={key==='state'?2:key==='postal_code'?10:200} value={state.address[key]} onChange={event=>state.change(key,event.target.value)} /></label>)}
   <p>Country: United States</p>
   <label className="st-check"><input type="checkbox" checked={state.consent} onChange={event=>state.setConsent(event.target.checked)} />{state.disclosure}</label>
   <button type="button" className="st-secondary" disabled={!state.consent} onClick={()=>void state.calculate()}>{state.busy?'Calculating sales tax…':'Calculate sales tax'}</button>
  </fieldset>
  {state.error&&<><Notice error>{state.error}</Notice><details><summary>Recover original tax quote</summary><div className="st-stack"><p>Ask the shop owner for the original calculation reference. Recovery retrieves that calculation; it never repeats an uncertain request.</p><label>Original quote ID<input value={state.recovery.quoteId} onChange={event=>state.setRecovery({...state.recovery,quoteId:event.target.value})} /></label><label>Original Stripe calculation ID<input value={state.recovery.calculationId} onChange={event=>state.setRecovery({...state.recovery,calculationId:event.target.value})} /></label></div></details></>}
  {state.quote&&<><div className="st-row"><span>Sales tax{state.quote.exempt?' · reviewed exemption':''}</span><strong>{money(state.quote.taxCents)}</strong></div><details open><summary>Tax by jurisdiction</summary><ul>{state.quote.jurisdictions.map((entry,index)=><li key={index}>{entry.name} · {entry.level} · {entry.ratePercent}% · {money(entry.amountCents)}</li>)}</ul>{state.quote.unallocatedTaxCents!==0&&<p>Tax without named jurisdiction evidence: {money(state.quote.unallocatedTaxCents)}</p>}</details></>}
 </div>
}
type OwnerMode={enabled:boolean;revision:string|null;accountId:string|null;consent:string;restored:boolean}
export function TaxCommerceControls() {
 const [reviewed,setReviewed]=useState(false)
 const [mode,setMode]=useState<OwnerMode>(),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 useEffect(()=>{request<OwnerMode>('/api/stall/tax/commerce').then(setMode).catch(error=>setError(errorMessage(error)))},[])
 async function reviewAccount() {
  setBusy(true);setError('');setAccepted(false)
  try {setMode(await request<OwnerMode>('/api/stall/tax/commerce?review=1'));setReviewed(true)}catch(error){setError(errorMessage(error))}finally{setBusy(false)}
 }
 async function change(enabled=!mode?.enabled) {
  if(!mode||!accepted||(enabled&&!reviewed))return
  setBusy(true);setError('')
  try {setMode(await request<OwnerMode>('/api/stall/tax/commerce',{enabled,revision:mode.revision,consent:mode.consent}));setAccepted(false);setReviewed(false)}catch(error){setError(errorMessage(error))}finally{setBusy(false)}
 }
 return <details><summary>Taxed sales · {mode?.enabled?'Enabled':'Off'}</summary><div className="st-stack">
  {mode&&<>{!mode.enabled&&<button type="button" className="st-secondary" disabled={busy} onClick={()=>void reviewAccount()}>Review connected account</button>}<p>{mode.consent}</p>{mode.restored&&<p>Restored sale authority is inactive until reviewed locally.</p>}<label className="st-check"><input type="checkbox" disabled={busy||(!mode.enabled&&!mode.restored&&!reviewed)} checked={accepted} onChange={event=>setAccepted(event.target.checked)} />I reviewed this separate taxed-sales authority.</label><button type="button" className="st-secondary" disabled={busy||!accepted||(!mode.enabled&&!reviewed)} onClick={()=>void change()}>{busy?'Updating taxed sales…':mode.enabled?'Disable taxed sales':'Enable taxed sales'}</button>{mode.restored&&<button type="button" className="st-secondary" disabled={busy||!accepted} onClick={()=>void change(false)}>Keep taxed sales off</button>}</>}
  {error&&<Notice error>{error}</Notice>}
  <TaxTransactionRecovery />
 </div></details>
}

function TaxTransactionRecovery() {
 const [orderId,setOrderId]=useState(''),[refundId,setRefundId]=useState(''),[transactionId,setTransactionId]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false)
 async function recover() {
  setBusy(true);setError('');setStatus('')
  try {await request('/api/stall/tax/recover',{orderId:orderId.trim(),transactionId:transactionId.trim(),...(refundId.trim()?{refundId:refundId.trim()}:{})});setStatus('Original tax transaction recovered. Refresh the order to inspect its references.')}
  catch(error){setError(errorMessage(error))}finally{setBusy(false)}
 }
 return <details><summary>Recover original Tax transaction</summary><div className="st-stack">
  <p>Use the original Stripe Tax transaction or reversal ID from the connected account. Stall checks the saved order reference and exact amounts. Unknown requests are never resent.</p>
  <label>Order ID<input value={orderId} onChange={event=>setOrderId(event.target.value)} /></label>
  <label>Refund ID · for reversal only<input value={refundId} onChange={event=>setRefundId(event.target.value)} /></label>
  <label>Original Stripe Tax transaction ID<input value={transactionId} onChange={event=>setTransactionId(event.target.value)} /></label>
  <button type="button" className="st-secondary" disabled={busy||!orderId.trim()||!transactionId.trim()} onClick={()=>void recover()}>{busy?'Retrieving original…':'Recover original transaction'}</button>
  {error&&<Notice error>{error}</Notice>}{status&&<p role="status">{status}</p>}
 </div></details>
}
