import { useEffect,useRef,useState,type FormEvent } from 'react'
import { request,errorMessage,money } from './api'
import { Notice,Section } from './primitives'
import { When } from './presentation'

type BalanceEntry={id:string;kind:'gift'|'credit';action:'issue'|'adjust';amountCents:number;createdAt:string;reason:string|null}
type Balances={email:string;currency:'usd';revision:string;giftCents:number;creditCents:number;ledger:BalanceEntry[];redemption:'not_available'}
type Reviewed={commandId:string;type:'issue'|'adjust';email:string;kind:'gift'|'credit';amountCents:number;revision:string;reason:string;currency:'usd';confirmed:true}
const kindLabel=(kind:'gift'|'credit')=>kind==='gift'?'Gift balance':'Goodwill credit'

function BalanceHistory({data}:{data:Balances}) {
 return <div className="st-stack">
  <dl className="st-definition"><div><dt>Gift balance · USD</dt><dd>{money(data.giftCents)}</dd></div><div><dt>Goodwill credit · USD</dt><dd>{money(data.creditCents)}</dd></div></dl>
  <p className="st-small">These balances belong only to {data.email}. Checkout redemption is not connected. Balance entries do not send an email, refund a payment or pay out cash.</p>
  {!data.ledger.length&&<p>No gift balance or goodwill credit has been recorded for this mailbox.</p>}
  {!!data.ledger.length&&<ol className="st-stack" aria-label="Balance history">{data.ledger.map(entry=><li key={entry.id}><p><strong>{kindLabel(entry.kind)} · {entry.amountCents>0?'+':''}{money(entry.amountCents)}</strong> · {entry.action==='issue'?'Issued':'Approved reduction'} · <When at={entry.createdAt}/></p>{entry.reason&&<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{entry.reason}</p>}</li>)}</ol>}
 </div>
}

export function CustomerBalances() {
 const [data,setData]=useState<Balances>(),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const lock=useRef(false)
 async function refresh(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{setData(await request<Balances>('/api/stall/account/balances'))}catch(error){setError(errorMessage(error))}finally{lock.current=false;setBusy(false)}}
 useEffect(()=>{void refresh()},[])
 return <Section title="Gift balances"><div className="st-stack"><div className="st-actions"><button className="st-secondary" disabled={busy} onClick={()=>void refresh()}>Refresh balances</button></div>{error&&<Notice error>{error}</Notice>}{!data&&!error&&<p role="status">Loading your balances…</p>}{data&&<BalanceHistory data={data}/>}</div></Section>
}

function BalanceEditor({data,busy,apply}:{data:Balances;busy:boolean;apply:(body:Reviewed)=>Promise<boolean>}) {
 const [type,setType]=useState<'issue'|'adjust'>('issue'),[kind,setKind]=useState<'gift'|'credit'>('gift'),[cents,setCents]=useState(''),[reason,setReason]=useState(''),[review,setReview]=useState<Reviewed>(),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('')
 function clearReview(){setReview(undefined);setConfirmed(false);setError('')}
 function inspect(event:FormEvent){event.preventDefault();const amount=Number(cents);if(!Number.isSafeInteger(amount)||amount<=0||amount>100000000){setError('Enter positive whole cents.');return}const delta=type==='issue'?amount:-amount,current=kind==='gift'?data.giftCents:data.creditCents;if(current+delta<0||current+delta>100000000){setError('The reviewed change must leave a supported nonnegative balance.');return}setError('');setConfirmed(false);setReview({commandId:crypto.randomUUID(),type,email:data.email,kind,amountCents:delta,revision:data.revision,reason:reason.trim(),currency:'usd',confirmed:true})}
 return <div className="st-stack">
  <form className="st-stack" aria-label="Review balance change" onSubmit={inspect} onChange={clearReview}>
   <div className="st-form-grid"><label>Balance action<select value={type} disabled={busy} onChange={event=>setType(event.target.value as 'issue'|'adjust')}><option value="issue">Issue balance</option><option value="adjust">Reduce balance</option></select></label><label>Balance kind<select value={kind} disabled={busy} onChange={event=>setKind(event.target.value as 'gift'|'credit')}><option value="gift">Gift balance</option><option value="credit">Goodwill credit</option></select></label><label>Amount · whole USD cents<input required type="number" min="1" max="100000000" step="1" value={cents} disabled={busy} onChange={event=>setCents(event.target.value)}/></label></div>
   <label>Customer-visible reason<textarea required maxLength={1000} rows={3} value={reason} disabled={busy} onChange={event=>setReason(event.target.value)}/></label>
   <div className="st-actions"><button disabled={busy||!reason.trim()}>Review balance change</button></div>
  </form>
  {error&&<Notice error>{error}</Notice>}
  {review&&<section className="st-panel st-stack" aria-label="Balance change review"><h4>Approve exact balance change</h4><p style={{overflowWrap:'anywhere'}}>Mailbox: {review.email}</p><p>{kindLabel(review.kind)}: {money(kind==='gift'?data.giftCents:data.creditCents)} → {money((kind==='gift'?data.giftCents:data.creditCents)+review.amountCents)}. {review.type==='issue'?'Issue':'Reduce by'} {money(Math.abs(review.amountCents))} ({Math.abs(review.amountCents)} cents).</p><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{review.reason}</p><label className="st-checkbox"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>I reviewed this exact mailbox, amount and reason and approve this balance entry.</label><div className="st-actions"><button disabled={busy||!confirmed} onClick={()=>void apply(review).then(ok=>{if(ok){clearReview();setCents('');setReason('')}})}>{review.type==='issue'?'Issue reviewed balance':'Approve reviewed reduction'}</button><button className="st-secondary" disabled={busy} onClick={clearReview}>Cancel balance review</button></div></section>}
 </div>
}

/** Mount only for a native owner or administrator managing this directory row. */
export function MerchantCustomerBalances({emails}:{emails:string[]}) {
 const [mailbox,setMailbox]=useState(emails[0]??''),[data,setData]=useState<Balances>(),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 const lock=useRef(false),generation=useRef(0),identity=emails.join('\n'),selected=emails.includes(mailbox)?mailbox:emails[0]??''
 useEffect(()=>{const current=++generation.current;setData(undefined);setError('');setNotice('');if(!selected)return;setBusy(true);void request<Balances>('/api/stall/customer-balances?email='+encodeURIComponent(selected)).then(value=>{if(current===generation.current)setData(value)}).catch(error=>{if(current===generation.current)setError(errorMessage(error))}).finally(()=>{if(current===generation.current)setBusy(false)});return()=>{generation.current++}},[selected,identity])
 async function refresh(){if(lock.current||!selected)return;const current=++generation.current;lock.current=true;setBusy(true);setError('');try{const value=await request<Balances>('/api/stall/customer-balances?email='+encodeURIComponent(selected));if(current===generation.current)setData(value)}catch(error){if(current===generation.current)setError(errorMessage(error))}finally{lock.current=false;if(current===generation.current)setBusy(false)}}
 async function apply(body:Reviewed){if(lock.current)return false;lock.current=true;setBusy(true);setError('');setNotice('');try{setData(await request<Balances>('/api/stall/customer-balances',body));setNotice('The reviewed balance entry is recorded.');return true}catch(error){setError(errorMessage(error));return false}finally{lock.current=false;setBusy(false)}}
 return <section className="st-stack" aria-label="Customer balances"><h3>Gift balances and goodwill credit</h3><label>Balance mailbox<select aria-label="Balance mailbox" disabled={busy} value={selected} onChange={event=>setMailbox(event.target.value)}>{emails.map(address=><option key={address} value={address}>{address}</option>)}</select></label><p className="st-small">Directory names and merges never combine mailbox balances. Every change requires your approval of exact cents and a customer-visible reason.</p><div className="st-actions"><button className="st-secondary" disabled={busy||!selected} onClick={()=>void refresh()}>Refresh customer balances</button></div>{error&&<Notice error>{error}</Notice>}{notice&&<Notice>{notice}</Notice>}{busy&&!data&&<p role="status">Loading balances…</p>}{data&&<><BalanceHistory data={data}/><BalanceEditor key={data.email+'-'+data.revision} data={data} busy={busy} apply={apply}/></>}</section>
}
