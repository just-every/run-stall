import { useEffect,useState } from 'react'
import type { TaxAddress,TaxConfiguration } from '../tax/configuration'
import { errorMessage,money,request } from './api'
import { Notice } from './primitives'

type Boundary={accountId:string;provider:string;purpose:string;sends:string[];retains:string[];providerRetention:string;consent:string}
type LineDraft={reference:string;unitCents:string;quantity:string;taxCode:string}
type PreviewResult={calculationId:string;subtotalCents:number;taxCents:number;totalCents:number;historicalObservation:boolean;expiresAt:number;breakdown:{country:string|null;state:string|null;taxType:string|null;ratePercent:string;amountCents:number;taxableCents:number;reason:string}[]}
type PreviewRecord={id:string;status:string;attempts:number;attempted_at:string|null;observed_at:string|null;provider_id:string|null;error_code:string|null;restored:number;result:PreviewResult|null}
type History={previews:PreviewRecord[];total:number;limit:number;truncated:boolean}
const address=():TaxAddress=>({line1:'',line2:'',city:'',state:'',postal_code:'',country:'US'})
const line=():LineDraft=>({reference:'',unitCents:'',quantity:'1',taxCode:''})
function whole(value:string,label:string) {
 if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw new Error(`${label} must be a whole number.`)
 return Number(value)
}

export function TaxPreview({configuration}:{configuration:TaxConfiguration}) {
 const [shipFrom,setShipFrom]=useState(()=>configuration.shipFrom??address()),[destination,setDestination]=useState(address),[lines,setLines]=useState<LineDraft[]>(()=>[line()]),[shipping,setShipping]=useState('0')
 const [id,setId]=useState(()=>crypto.randomUUID() as string),[calculationId,setCalculationId]=useState(''),[boundary,setBoundary]=useState<Boundary>(),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<PreviewResult>(),[history,setHistory]=useState<History>(),[historyError,setHistoryError]=useState('')
 async function loadHistory() {
  try{setHistory(await request<History>('/api/stall/tax/previews'));setHistoryError('')}
  catch(error){setHistoryError(errorMessage(error))}
 }
 useEffect(()=>{void loadHistory()},[])
 useEffect(()=>{if(configuration.shipFrom){setShipFrom(configuration.shipFrom);setConsent(false)}},[configuration.revision])
 async function readBoundary() {
  setBusy(true);setError('');setConsent(false);setBoundary(undefined)
  try{setBoundary(await request<Boundary>('/api/stall/tax/boundary'))}catch(error){setError(errorMessage(error))}finally{setBusy(false)}
 }
 async function savedAddress() {
  setBusy(true);setError('')
  try {const saved=await request<TaxConfiguration>('/api/stall/tax/configuration');if(!saved.shipFrom)throw new Error('Enter and finish saving your ship-from address above first.');setShipFrom(saved.shipFrom);setConsent(false);setResult(undefined)}
  catch(error){setError(errorMessage(error))}finally{setBusy(false)}
 }
 async function preview() {
  if(!boundary||!consent){setError('Read the connected account boundary and explicitly accept it before requesting a preview.');return}
  setBusy(true);setError('');setResult(undefined)
  try {
   const payload={id,consent:boundary.consent,shipFrom,destination,lines:lines.map(row=>({reference:row.reference,unitCents:whole(row.unitCents,'Unit cents'),quantity:whole(row.quantity,'Quantity'),taxCode:row.taxCode})),shippingCents:whole(shipping,'Discounted shipping cents'),...(calculationId.trim()?{calculationId:calculationId.trim()}:{})}
   setResult(await request<PreviewResult>('/api/stall/tax/preview',payload))
  }catch(error){setError(errorMessage(error))}finally{setBusy(false);await loadHistory()}
 }
 function changeLine(index:number,key:keyof LineDraft,value:string){setLines(current=>current.map((row,i)=>i===index?{...row,[key]:value}:row));setConsent(false);setResult(undefined)}
 function recover(record:PreviewRecord) {setId(record.id);setCalculationId(record.provider_id??'');setResult(undefined);setConsent(false);setError('')}
 return <details><summary>Address-level tax preview</summary><div className="st-stack">
  <p>Preview USD tax with your connected Stripe test account. No payment, tax transaction, filing or sale exemption is created. Checkout keeps its current tax treatment.</p>
  <button type="button" className="st-secondary" disabled={busy} onClick={()=>void readBoundary()}>Read connected preview boundary</button>
  {boundary&&<details open><summary>Data sent to {boundary.provider}</summary><div className="st-stack">
   <p style={{overflowWrap:'anywhere'}}>Connected account: {boundary.accountId}. {boundary.purpose}.</p>
   <div><p>Sent for this preview:</p><ul>{boundary.sends.map(item=><li key={item}>{item}</li>)}</ul></div>
   <div><p>Retained in preview history:</p><ul>{boundary.retains.map(item=><li key={item}>{item}</li>)}</ul></div>
   <p>{boundary.providerRetention}</p>
  </div></details>}
  <form className="st-stack" aria-label="Address-level tax preview" onSubmit={event=>{event.preventDefault();void preview()}}>
   <details open><summary>Destination and ship-from</summary><div className="st-stack">
    <AddressFields title="Destination" value={destination} disabled={busy} update={value=>{setDestination(value);setConsent(false);setResult(undefined)}} />
    <AddressFields title="Ship-from" value={shipFrom} disabled={busy} update={value=>{setShipFrom(value);setConsent(false);setResult(undefined)}} />
    <button type="button" className="st-secondary" disabled={busy} onClick={()=>void savedAddress()}>Use saved ship-from address</button>
   </div></details>
   <details open><summary>Line amounts and tax codes · {lines.length}</summary><div className="st-stack">
    <p>Use opaque line references, without customer names or emails. Enter unit amounts after discounts and explicit Stripe product tax codes.</p>
    {lines.map((row,index)=><div className="st-stack" key={index}>
     <label>Opaque line reference<input aria-label={`Preview line reference ${index+1}`} required pattern="[A-Za-z0-9_-]+" maxLength={100} value={row.reference} disabled={busy} onChange={event=>changeLine(index,'reference',event.target.value)} /></label>
     <label>Unit amount · USD cents<input aria-label={`Preview unit cents ${index+1}`} type="number" required min="1" max="99999999" step="1" value={row.unitCents} disabled={busy} onChange={event=>changeLine(index,'unitCents',event.target.value)} /></label>
     <label>Quantity<input aria-label={`Preview quantity ${index+1}`} type="number" required min="1" max="1000" step="1" value={row.quantity} disabled={busy} onChange={event=>changeLine(index,'quantity',event.target.value)} /></label>
     {!!configuration.categories.length&&<label>Use mapped product tax code<select aria-label={`Mapped product tax code ${index+1}`} value="" disabled={busy} onChange={event=>{if(event.target.value)changeLine(index,'taxCode',event.target.value)}}><option value="">Choose a saved SKU mapping</option>{configuration.categories.map(item=><option key={item.sku} value={item.taxCode}>{item.sku} · {item.taxCode}</option>)}</select></label>}
     <label>Product tax code<input aria-label={`Preview product tax code ${index+1}`} required pattern="txcd_[0-9]{8}" maxLength={20} value={row.taxCode} disabled={busy} onChange={event=>changeLine(index,'taxCode',event.target.value)} /></label>
     {lines.length>1&&<button type="button" className="st-secondary" disabled={busy} onClick={()=>{setLines(lines.filter((_,i)=>i!==index));setConsent(false);setResult(undefined)}}>Remove preview line {index+1}</button>}
    </div>)}
    <button type="button" className="st-secondary" disabled={busy||lines.length>=50} onClick={()=>{setLines([...lines,line()]);setConsent(false);setResult(undefined)}}>Add preview line</button>
    <label>Shipping after discounts · USD cents<input name="tax-preview-shipping" type="number" required min="0" max="99999999" step="1" value={shipping} disabled={busy} onChange={event=>{setShipping(event.target.value);setConsent(false);setResult(undefined)}} /></label>
   </div></details>
   <details><summary>Preview identity and recovery</summary><div className="st-stack">
    <p>Keep the original preview ID and all original addresses, amounts and tax codes for recovery. An uncertain attempt is never replaced by another provider calculation.</p>
    <label>Preview UUID<input name="tax-preview-id" required maxLength={36} value={id} disabled={busy} onChange={event=>{setId(event.target.value);setConsent(false);setResult(undefined)}} /></label>
    <label>Original Stripe calculation ID, for recovery<input name="tax-preview-calculation" maxLength={100} value={calculationId} disabled={busy} onChange={event=>{setCalculationId(event.target.value);setConsent(false);setResult(undefined)}} /></label>
    <button type="button" className="st-secondary" disabled={busy} onClick={()=>{setId(crypto.randomUUID());setCalculationId('');setResult(undefined);setConsent(false);setError('')}}>Start a different preview</button>
   </div></details>
   {boundary&&<label className="st-check"><input name="tax-preview-consent" type="checkbox" required checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)} />{boundary.consent}</label>}
   <button disabled={busy||!boundary||!consent}>{busy?'Requesting tax preview…':calculationId?'Recover original tax preview':'Request tax preview'}</button>
  </form>
  {error&&<Notice error>{error} Keep the entered values and original preview ID when recovering an uncertain calculation.</Notice>}
  {result&&<PreviewObservation result={result} />}
  <details><summary>Saved preview history{history?` · ${history.total}`:''}</summary><div className="st-stack">
   {historyError&&<Notice error>{historyError} <button type="button" className="st-secondary" onClick={()=>void loadHistory()}>Retry preview history</button></Notice>}
   {history&&!history.previews.length&&<p>No saved tax previews yet.</p>}
   {history?.truncated&&<p>Showing the newest {history.limit} of {history.total} previews.</p>}
   {history?.previews.map(record=><details key={record.id}><summary style={{overflowWrap:'anywhere'}}>{record.id} · {record.status}{record.restored?' · restored':''}</summary><div className="st-stack">
    {record.provider_id&&<p style={{overflowWrap:'anywhere'}}>Calculation: {record.provider_id}</p>}
    {record.error_code&&<p>Last outcome: {record.error_code}</p>}
    {record.result&&<PreviewObservation result={{...record.result,historicalObservation:true}} />}
    <button type="button" className="st-secondary" disabled={busy} onClick={()=>recover(record)}>Use original preview identity</button>
   </div></details>)}
  </div></details>
 </div></details>
}
function AddressFields({title,value,disabled,update}:{title:string;value:TaxAddress;disabled:boolean;update:(value:TaxAddress)=>void}) {
 return <div className="st-stack"><h3>{title} · United States</h3>
  {([['line1','Street address'],['line2','Address line 2'],['city','City'],['state','State'],['postal_code','ZIP code']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={`${title} ${label.toLowerCase()}`} required={key!=='line2'} maxLength={key==='state'?2:key==='postal_code'?10:key==='city'?100:200} value={value[key]??''} disabled={disabled} onChange={event=>update({...value,[key]:event.target.value})} /></label>)}
 </div>
}
function PreviewObservation({result}:{result:PreviewResult}) {
 return <div className="st-stack" role="group" aria-label="Tax preview observation">
  <Notice>{result.historicalObservation?'Historical tax observation':'Tax preview only'} · no authority to charge a sale.</Notice>
  <p>Subtotal {money(result.subtotalCents)} · tax {money(result.taxCents)} · total {money(result.totalCents)}</p>
  <p style={{overflowWrap:'anywhere'}}>Calculation: {result.calculationId}</p>
  {result.breakdown.length?<ul>{result.breakdown.map((entry,index)=><li key={index}>{[entry.country,entry.state,entry.taxType].filter(Boolean).join(' · ')} · {entry.ratePercent}% · {money(entry.amountCents)} on {money(entry.taxableCents)} · {entry.reason.replaceAll('_',' ')}</li>)}</ul>:<p>No jurisdiction breakdown was returned.</p>}
 </div>
}
