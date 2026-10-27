import { useEffect,useState } from 'react'
import { request,errorMessage } from './api'
import { recordAnalytics } from './analytics-events'
type Privacy={policyVersion:string;analyticsAllowed:boolean;advertising:boolean;doNotSellOrShare:boolean;region:string;regionSelected?:boolean}
/** A persistent preference door shares the existing privacy policy authority. */
export function AnalyticsConsent() {
 const [privacy,setPrivacy]=useState<Privacy|null>(null),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[analytics,setAnalytics]=useState(false),[region,setRegion]=useState('')
 useEffect(()=>{
  if(!location.pathname.startsWith('/shop'))return
  void request<Privacy>('/api/stall/privacy').then(value=>{setPrivacy(value);setAnalytics(value.analyticsAllowed);setRegion(value.regionSelected?value.region:'');if(value.analyticsAllowed)void recordAnalytics('visit')}).catch(e=>setError(errorMessage(e)))
 },[])
 async function choose(allow:boolean) {
  if(!privacy||busy)return
  setBusy(true);setError('')
  try {
   const next=await request<Privacy>('/api/stall/privacy',{policyVersion:privacy.policyVersion,analytics:allow,advertising:privacy.advertising,doNotSellOrShare:privacy.doNotSellOrShare,region:region.trim().toUpperCase()})
   setPrivacy(next);setAnalytics(next.analyticsAllowed);setOpen(false)
   if(next.analyticsAllowed){await recordAnalytics('visit');dispatchEvent(new Event('stall-analytics-consented'))}
  }catch(e){setError(errorMessage(e))}finally{setBusy(false)}
 }
 if(!privacy&&!error)return null
 return <aside className="st-stack" aria-label="Analytics preferences" style={{maxWidth:1100,margin:'16px auto',padding:'0 20px'}}>
  <details open={open} onToggle={event=>setOpen(event.currentTarget.open)}><summary>Privacy preferences · analytics {privacy?.analyticsAllowed?'allowed':'off'}</summary><div className="st-stack">
   <p>Optional first-party analytics records visits, product and basket activity, campaign tags, referring site, landing page and device category. Events and browser links expire after 30 days. Paid orders keep source labels as commercial history. No advertising pixels are installed.</p>
   <label className="st-check"><input type="checkbox" checked={analytics} disabled={busy||!privacy} onChange={event=>setAnalytics(event.target.checked)}/>Allow first-party analytics</label>
   <label>Region (optional)<input value={region} maxLength={10} placeholder="Unknown" disabled={busy} onChange={event=>setRegion(event.target.value)}/></label><div className="st-actions"><button type="button" disabled={busy||!privacy} onClick={()=>void choose(analytics)}>Apply privacy choice</button><button className="st-secondary" type="button" disabled={busy||!privacy} onClick={()=>void choose(false)}>Refuse analytics</button></div>
  </div></details>{error&&<div className="st-notice st-error" role="alert">{error}</div>}
 </aside>
}
