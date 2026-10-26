import { useEffect,useState } from 'react'
import { errorMessage,money,request } from './api'
import { Notice } from './primitives'

type Entry={id:string;orderId:string;kind:'sale'|'refund';occurredAt:string;state:string;grossCents:number;shippingCents:number;taxCents:number;reference:string}
type State={consent:string;entries:Entry[]}
const header='kind,marketplace,reference,date,state,items,non-taxable items,shipping,tax,original reference'
function cents(value:string,label:string) {
 if(!/^\d+(\.\d{1,2})?$/.test(value))throw new Error(`${label} must be a USD amount such as 12.50.`)
 const [whole,fraction='']=value.split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0'))
}
function rows(text:string) {
 const lines=text.split('\n').map(line=>line.trim()).filter(Boolean)
 if(lines[0]?.toLowerCase()===header)lines.shift()
 return lines.map((line,index)=>{
  const [kind,marketplace,reference,occurredOn,state,items,nonTaxable,shipping,tax,originalReference]=line.split(',').map(part=>part.trim())
  if(kind!=='sale'&&kind!=='refund')throw new Error(`Row ${index+1} must start with sale or refund.`)
  return {kind,marketplace,reference,occurredOn,state,goodsCents:cents(items??'','Items'),nonTaxableCents:cents(nonTaxable||'0','Non-taxable items'),shippingCents:cents(shipping||'0','Shipping'),taxCents:cents(tax||'0','Tax'),...(originalReference?{originalReference}:{})}
 })
}
export function TaxMarketplace() {
 const [state,setState]=useState<State>(),[text,setText]=useState(''),[agreed,setAgreed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 useEffect(()=>{request<State>('/api/stall/tax/marketplace').then(setState,failure=>setError(errorMessage(failure)))},[])
 async function record() {
  if(!state||!agreed)return
  setBusy(true);setError('')
  try {setState(await request<State>('/api/stall/tax/marketplace',{consent:state.consent,rows:rows(text)}));setText('');setAgreed(false)}
  catch(failure){setError(errorMessage(failure))}finally{setBusy(false)}
 }
 return <section className="st-stack" aria-labelledby="tax-marketplace"><h3 id="tax-marketplace">Marketplace-facilitated sales</h3>
  <p>Record sales where the marketplace collected and remitted the tax. They stay in their own channel rows and totals and count toward configured nexus thresholds.</p>
  <label>One sale or refund per line<textarea rows={4} spellCheck={false} placeholder={header} value={text} disabled={busy} onChange={event=>setText(event.target.value)} /></label>
  {state&&<label className="st-check"><input type="checkbox" checked={agreed} disabled={busy} onChange={event=>setAgreed(event.target.checked)} /> {state.consent}</label>}
  {error&&<Notice error>{error}</Notice>}
  <div className="st-row"><button className="st-secondary" disabled={busy||!agreed||!text.trim()} onClick={()=>void record()}>{busy?'Recording…':'Record marketplace sales'}</button></div>
  {state&&state.entries.length>0&&<div className="st-table-wrap"><table className="st-tax-table"><caption>Recent marketplace entries</caption><thead><tr><th scope="col">Reference</th><th scope="col">Kind</th><th scope="col">State</th><th scope="col">Items</th><th scope="col">Tax</th></tr></thead><tbody>{state.entries.map(entry=><tr key={entry.id}><td data-label="Reference">{entry.orderId}</td><td data-label="Kind">{entry.kind}</td><td data-label="State">{entry.state}</td><td data-label="Items">{money(entry.grossCents)}</td><td data-label="Tax">{money(entry.taxCents)}</td></tr>)}</tbody></table></div>}
 </section>
}
