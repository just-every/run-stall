import { useEffect,useState } from 'react'
import { request,errorMessage } from './api'
import { Badge,Notice,RecordDetail,Section } from './primitives'
import { shortId,When } from './presentation'
import type { Run,State } from './types'
type Rules={enabled:boolean;holdElevated:boolean;holdHighest:boolean;holdAddressMismatch:boolean;holdPaymentMismatch:boolean;scoreThreshold:number|null;revision:string|null}
type Risk={orderId:string;revision:string;status:string;observedAt:string;reasons:string[];signals:unknown[];reviewer?:{id:string;at:string;decision:string}}
type Snapshot={rules:Rules;queue:Risk[];notifications:{id:string;orderId:string;readAt?:string}[];counts:{total:number;held:number;canceled:number};truncated:boolean}
export function RiskReview({state,busy,run}:{state:State;busy:boolean;run:Run}) {
 const [data,setData]=useState<Snapshot>(),[error,setError]=useState(''),[selected,setSelected]=useState('')
 const load=async()=>setData(await request<Snapshot>('/api/stall/risk'))
 useEffect(()=>{void load().catch(e=>setError(errorMessage(e)))},[])
 async function save(type:string,p:unknown){setError('');if(await run(type,p))try{await load()}catch(e){setError(errorMessage(e))}}
 return <Section id="risk-review" title="Risk review">
  <p>Processor signals are advisory, not a finding of fraud. Configured holds stop fulfillment until an owner or administrator records a release or cancellation.</p>
  {error&&<Notice error>{error}</Notice>}
  {data&&<><RiskRules rules={data.rules} busy={busy} save={p=>save('risk.configure',p)} />
   <p>{data.counts.held} held · {data.counts.canceled} fulfillment canceled · {data.counts.total} observations{data.truncated?' (newest 100 shown)':''}</p>
   <form className="st-stack" onSubmit={e=>{e.preventDefault();void save('risk.refresh',{orderId:selected})}}><label>Refresh provider observation<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose a Stripe-paid order</option>{state.orders.filter(o=>o.payment&&o.payment.source!=='staff').map(o=><option key={o.id} value={o.id}>Order {shortId(o.id)}</option>)}</select></label><button disabled={busy||!selected}>Read current risk</button></form>
   {!data.queue.length&&<p>No risk observations yet. Enable rules, then read an existing paid order or wait for a verified payment callback.</p>}
   {data.queue.map(row=><article className="st-panel st-stack" key={row.orderId} aria-label={`Risk for ${row.orderId}`}>
    <div className="st-row"><h3><a href={`#orders/${row.orderId}`}>Order {shortId(row.orderId)}</a></h3><Badge value={row.status} /></div>
    <p>Observed <When at={row.observedAt} />. {row.reasons.length?row.reasons.join(', ').replaceAll('_',' '):'No configured hold reason.'}</p>
    <RecordDetail label="Processor signals and provenance" value={row.signals} />
    {row.reviewer&&<p>Reviewer {shortId(row.reviewer.id)} recorded {row.reviewer.decision} <When at={row.reviewer.at} />.</p>}
    {['held','advisory'].includes(row.status)&&<div className="st-actions"><button disabled={busy} onClick={()=>void save('risk.release',{orderId:row.orderId,revision:row.revision})}>Release fulfillment</button><button className="st-secondary" disabled={busy} onClick={()=>void save('risk.cancel',{orderId:row.orderId,revision:row.revision})}>Cancel fulfillment</button></div>}
    {row.status==='canceled'&&<Notice>Fulfillment canceled. Payment and reserved stock remain recorded; handle money and stock separately through their authorized workflows.</Notice>}
    {data.notifications.filter(n=>n.orderId===row.orderId&&!n.readAt).map(n=><button key={n.id} className="st-secondary" disabled={busy} onClick={()=>void save('risk.notification.read',{id:n.id})}>Mark staff alert read</button>)}
   </article>)}
  </>}
 </Section>
}
function RiskRules({rules,busy,save}:{rules:Rules;busy:boolean;save:(p:unknown)=>Promise<void>}) {
 const [value,setValue]=useState(rules)
 useEffect(()=>setValue(rules),[rules])
 return <form className="st-stack" aria-label="Risk hold rules" onSubmit={e=>{e.preventDefault();void save(value)}}>
  {([['enabled','Enable fulfillment holds'],['holdElevated','Hold elevated processor risk'],['holdHighest','Hold highest processor risk'],['holdAddressMismatch','Hold failed address checks'],['holdPaymentMismatch','Hold failed payment checks']] as const).map(([key,label])=><label className="st-check" key={key}><input type="checkbox" checked={value[key]} onChange={e=>setValue({...value,[key]:e.target.checked})} />{label}</label>)}
  <label>Hold at processor risk score (optional)<input type="number" min="0" max="100" value={value.scoreThreshold??''} onChange={e=>setValue({...value,scoreThreshold:e.target.value===''?null:Number(e.target.value)})} /></label>
  <p>Saving rules requires a fresh provider observation before another Stripe-paid order can be approved. Disabling rules does not release existing holds. Repeat signals preserve an explicit release; changed signals may require review again.</p><button disabled={busy}>Save risk rules</button>
 </form>
}
