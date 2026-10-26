import { useEffect,useState,type FormEvent } from 'react'
import { request,errorMessage,money } from './api'
import { Notice } from './primitives'
import type { OwnOrder,ReturnCase } from './customer-types'
type Option={sku:string;name:string;availableQuantity:number}
type LineView={sku:string;name:string;purchased:number;remaining:number;eligible:boolean;reasons:string[];exchangeOptions:Option[]}
type Policy={configured:true;windowDays:number;condition:string;feeCents:number;returnShipping:string;finalSaleSkus:string[];exchanges:boolean;cancellation:string;decisions:string}|{configured:false;message:string}
type View={policy:Policy;cancellation:{eligible:boolean;reason?:string};returnsOpen:{endsAt:string|null}|null;exchangeStock:string;lines:LineView[];cases:ReturnCase[]}
const reasons:Record<string,string>={wrong_size:'Wrong size or fit',defective:'Damaged or defective',not_as_described:'Not as described',changed_mind:'Changed my mind',other:'Another reason'}
const label=(value:string)=>value.replaceAll('_',' ')
export function ReturnProgress({cases}:{cases:ReturnCase[]}) {
 if(!cases.length)return null
 return <div className="st-stack" aria-label="Request progress">{cases.map(item=><article key={item.id} className="st-panel st-stack" aria-label={`Request ${item.id}`}>
  <h4>{label(item.kind)} request · {item.state==='requested'?'awaiting a person’s review':item.state}</h4>
  <ul>{item.lines.map(line=><li key={line.sku}>{line.name} × {line.quantity}{line.toName?` → ${line.toName}`:''}{line.reason?` · ${reasons[line.reason]??line.reason}`:''}</li>)}</ul>
  <ol className="st-progress">{item.progress.map((step,i)=><li key={i}><time dateTime={step.at}>{new Date(step.at).toLocaleString()}</time> · {step.text}</li>)}</ol>
  {item.replacementReserved&&<Notice>Your replacement is set aside. Nothing is charged or refunded by this step.</Notice>}
 </article>)}</div>
}
/** One paid order's help: the shop's policy, what each line can still do and its requests' progress. */
export function ReturnHelp({order,token,cases,refresh}:{order:OwnOrder;token:string;cases:ReturnCase[];refresh:()=>void}) {
 const [view,setView]=useState<View>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState('')
 const [kind,setKind]=useState('return'),[picked,setPicked]=useState<Record<string,{quantity:number;reason:string;toSku:string}>>({}),[note,setNote]=useState('')
 const headers:Record<string,string>=token?{'X-Stall-Order-Token':token}:{}
 const load=()=>request<View>('/api/stall/returns/eligibility?orderId='+encodeURIComponent(order.id),undefined,'GET',headers).then(setView).catch(e=>setError(errorMessage(e)))
 useEffect(()=>{void load()},[order.id,cases.length])
 async function submit(event:FormEvent) {
  event.preventDefault();setBusy(true);setError('');setDone('')
  const lines=kind==='cancellation'?[]:Object.entries(picked).map(([sku,line])=>({sku,quantity:line.quantity,reason:line.reason,...(kind==='exchange'?{toSku:line.toSku}:{})}))
  try{const result=await request<{message:string}>('/api/stall/returns/requests',{orderId:order.id,kind,lines,...(note.trim()?{note:note.trim()}:{})},'POST',headers);setDone(result.message);setPicked({});setNote('');refresh()}
  catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 const policy=view?.policy,exchanges=!!policy?.configured&&policy.exchanges
 const choose=(line:LineView,on:boolean)=>setPicked(current=>{const next={...current};if(on)next[line.sku]={quantity:1,reason:'wrong_size',toSku:line.exchangeOptions[0]?.sku??''};else delete next[line.sku];return next})
 const edit=(sku:string,patch:Partial<{quantity:number;reason:string;toSku:string}>)=>setPicked(current=>({...current,[sku]:{...current[sku],...patch}}))
 return <div className="st-stack" aria-label={`Returns and exchanges for order ${order.id}`}>
  <h4>Return, exchange or cancel</h4>
  {error&&<Notice error>{error}</Notice>}
  {!view&&!error&&<p role="status">Loading the shop’s policy and what this order allows…</p>}
  {policy&&(policy.configured?<section className="st-stack" aria-label="Return policy">
   <p><strong>Return window:</strong> {policy.windowDays} days from dispatch{view?.returnsOpen?.endsAt?`, open until ${new Date(view.returnsOpen.endsAt).toLocaleDateString()}`:''}. <strong>Condition:</strong> {policy.condition}</p>
   <p><strong>Return shipping:</strong> {policy.returnShipping}. <strong>Fee:</strong> {policy.feeCents?`${money(policy.feeCents)} may be kept from a refund`:'none'}. <strong>Exchanges:</strong> {exchanges?'available by size or variant, from current stock':'not offered'}.</p>
   {!!policy.finalSaleSkus.length&&<p><strong>Final sale:</strong> {policy.finalSaleSkus.join(', ')} cannot be returned or exchanged.</p>}
   <p>{policy.cancellation} {policy.decisions}</p>
  </section>:<Notice>{policy.message}</Notice>)}
  {view&&<form className="st-stack" aria-label="Request help with this order" onSubmit={e=>void submit(e)}>
   <label>What do you need<select aria-label="Request kind" value={kind} disabled={busy} onChange={e=>{setKind(e.target.value);setPicked({});setDone('');setError('')}}>
    <option value="return">Return items</option>{exchanges&&<option value="exchange">Exchange for another size or variant</option>}<option value="cancellation">Cancel the order</option></select></label>
   {kind==='cancellation'?<p>{view.cancellation.eligible?'The whole order will be reviewed for cancellation. Nothing is canceled or refunded until a person decides.':view.cancellation.reason}</p>
    :<fieldset className="st-stack"><legend>Choose the items</legend>{view.lines.map(line=><div key={line.sku} className="st-stack">
     <label className="st-check"><input type="checkbox" disabled={busy||!line.eligible||(kind==='exchange'&&!line.exchangeOptions.length)} checked={!!picked[line.sku]} onChange={e=>choose(line,e.target.checked)} />{line.name} · {line.remaining} of {line.purchased} can still be requested</label>
     {!line.eligible&&<p className="st-small">{line.reasons[0]}</p>}
     {line.eligible&&kind==='exchange'&&!line.exchangeOptions.length&&<p className="st-small">No other size or variant is in stock right now{view.exchangeStock==='unavailable'?' (stock could not be checked)':''}.</p>}
     {picked[line.sku]&&<div className="st-stack">
      <label>Quantity<input type="number" min={1} max={kind==='exchange'?Math.max(1,...line.exchangeOptions.map(o=>o.availableQuantity)):line.remaining} value={picked[line.sku].quantity} onChange={e=>edit(line.sku,{quantity:Number(e.target.value)})} /></label>
      <label>Reason<select value={picked[line.sku].reason} onChange={e=>edit(line.sku,{reason:e.target.value})}>{Object.entries(reasons).map(([key,text])=><option key={key} value={key}>{text}</option>)}</select></label>
      {kind==='exchange'&&<label>Replacement<select value={picked[line.sku].toSku} onChange={e=>edit(line.sku,{toSku:e.target.value})}>{line.exchangeOptions.map(o=><option key={o.sku} value={o.sku}>{o.name} · {o.availableQuantity} in stock</option>)}</select></label>}
     </div>}</div>)}</fieldset>}
   {kind!=='cancellation'&&<label>Note for the shop (optional)<textarea maxLength={500} value={note} disabled={busy} onChange={e=>setNote(e.target.value)} /></label>}
   <button disabled={busy||(kind==='cancellation'?!view.cancellation.eligible:!Object.keys(picked).length)}>{busy?'Sending request…':'Send request for review'}</button>
  </form>}
  {done&&<Notice>{done}</Notice>}
  <ReturnProgress cases={cases} />
 </div>
}
