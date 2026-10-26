import { useEffect,useState,type FormEvent } from 'react'
import { request,errorMessage } from './api'
import { Notice,Section } from './primitives'
import type { Run } from './types'
type Policy={revision:string;windowDays:number;condition:string;feeCents:number;returnShipping:string;finalSaleSkus:string[];exchanges:boolean}
const blank={windowDays:30,condition:'Unused and in the original packaging',feeCents:0,returnShipping:'The customer pays return postage',finalSaleSkus:[] as string[],exchanges:true}
export function ReturnPolicy({busy,run}:{busy:boolean;run:Run}) {
 const [saved,setSaved]=useState<Policy|null>(),[loaded,setLoaded]=useState(false),[error,setError]=useState('')
 const [windowDays,setWindowDays]=useState(String(blank.windowDays)),[condition,setCondition]=useState(blank.condition),[fee,setFee]=useState('0'),[shipping,setShipping]=useState(blank.returnShipping),[finalSale,setFinalSale]=useState(''),[exchanges,setExchanges]=useState(blank.exchanges)
 const load=()=>request<{policy:Policy|null}>('/api/stall/returns').then(data=>{setSaved(data.policy);setLoaded(true);if(data.policy){setWindowDays(String(data.policy.windowDays));setCondition(data.policy.condition);setFee(String(data.policy.feeCents/100));setShipping(data.policy.returnShipping);setFinalSale(data.policy.finalSaleSkus.join(', '));setExchanges(data.policy.exchanges)}}).catch(e=>setError(errorMessage(e)))
 useEffect(()=>{void load()},[])
 async function save(event:FormEvent) {
  event.preventDefault();setError('')
  if(await run('return.policy.save',{revision:saved?.revision??null,windowDays:Number(windowDays),condition,feeCents:Math.round(Number(fee)*100),returnShipping:shipping,finalSaleSkus:finalSale.split(',').map(x=>x.trim()).filter(Boolean),exchanges}))await load()
 }
 return <Section id="return-policy" title="Return policy">
  <p>Shoppers read this before asking, and requests outside it are refused with the rule that applies. Every request is still decided by a person. The fee is shown to shoppers and applied only when you record the refund.</p>
  {error&&<Notice error>{error}</Notice>}
  {!loaded&&!error&&<p role="status">Loading the return policy…</p>}
  {loaded&&!saved&&<Notice>No policy is published, so shoppers cannot request returns or exchanges. Cancellation before shipment still works.</Notice>}
  {loaded&&<form className="st-stack" aria-label="Return policy" onSubmit={e=>void save(e)}>
   <label>Return window in days after dispatch<input type="number" min={0} max={365} value={windowDays} onChange={e=>setWindowDays(e.target.value)} /></label>
   <label>Required condition<textarea maxLength={500} value={condition} onChange={e=>setCondition(e.target.value)} /></label>
   <label>Return fee in USD (shown to shoppers)<input type="number" min={0} step="0.01" value={fee} onChange={e=>setFee(e.target.value)} /></label>
   <label>Who pays return shipping<input maxLength={300} value={shipping} onChange={e=>setShipping(e.target.value)} /></label>
   <label>Final-sale SKUs, separated by commas<input value={finalSale} onChange={e=>setFinalSale(e.target.value)} /></label>
   <label className="st-check"><input type="checkbox" checked={exchanges} onChange={e=>setExchanges(e.target.checked)} />Offer exchanges for another size or variant from current stock</label>
   <button disabled={busy}>Save return policy</button>
  </form>}
 </Section>
}
