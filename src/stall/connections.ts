import type { Bindings } from '../auth.server'
import { audit,commit } from './access'
import { fail,requirePerson,text,type Actor } from './model'

// Pier and Stripe connections the owner enters on Settings. They live sealed in
// Stall's own database and are read on every request; a Worker secret or
// .dev.vars value of the same name still wins, so existing installs keep working.
// Backups never carry them (portability-policy excludes st_connections).

const FIELDS={pier:['PIER_ORIGIN','PIER_SESSION','PIER_CUSTOMER_ID'],stripe:['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET']} as const
type Name=keyof typeof FIELDS
const PIER_KEY=/^pier_stall_[a-f0-9]{64}$/

async function key(env:Bindings) {
 if(!env.SESSION_SECRET) fail('CONFIG','Stall has no session secret to protect saved connections.',503)
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),'HKDF',false,['deriveKey'])
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(32),info:new TextEncoder().encode('stall-connections-v1')},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])
}
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes))
const unb64=(text:string)=>Uint8Array.from(atob(text),c=>c.charCodeAt(0))
async function seal(env:Bindings,name:Name,value:Record<string,string>) {
 const iv=crypto.getRandomValues(new Uint8Array(12))
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(name)},await key(env),new TextEncoder().encode(JSON.stringify(value)))
 return b64(iv)+'.'+b64(new Uint8Array(data))
}
async function open(env:Bindings,name:string,sealed:string):Promise<Record<string,string>> {
 const [iv,data]=sealed.split('.')
 try { return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:new TextEncoder().encode(name)},await key(env),unb64(data)))) }
 catch { return {} } // A changed session secret makes a saved connection unreadable: Settings shows it as not connected.
}

/** The bindings with saved connections filled in where no secret of that name is set. */
export async function withConnections(env:Bindings):Promise<Bindings> {
 const rows=(await env.DB.prepare('SELECT name,sealed FROM st_connections').all<{name:string;sealed:string}>()).results
 const merged:Record<string,unknown>={...env}
 for(const row of rows) for(const [k,v] of Object.entries(await open(env,row.name,row.sealed))) if(!merged[k]) merged[k]=v
 return merged as unknown as Bindings
}

/** What Settings shows: where each connection comes from, never its secrets. */
export async function connectionDetails(original:Bindings,env:Bindings) {
 const saved=new Set((await original.DB.prepare('SELECT name FROM st_connections').all<{name:string}>()).results.map(r=>r.name))
 const source=(name:Name)=>FIELDS[name].some(f=>(original as any)[f])?'server settings':saved.has(name)?'this page':null
 return {pier:{origin:env.PIER_ORIGIN??null,source:source('pier')},stripe:{mode:env.STRIPE_SECRET_KEY?.startsWith('sk_live_')||env.STRIPE_SECRET_KEY?.startsWith('rk_live_')?'live':env.STRIPE_SECRET_KEY?'test':null,source:source('stripe'),local:env.AUTH_LOCAL==='true',webhook:Boolean(env.STRIPE_WEBHOOK_SECRET)}}
}

function origin(value:unknown,env:Bindings) {
 let url:URL;try { url=new URL(text(value,'Pier address',300).replace(/\/+$/,'')) }catch { return fail('INPUT','Enter Pier’s address as it shows in Pier’s browser tab, for example http://localhost:8787.',400) }
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname)
 if(url.username||url.password||!(url.protocol==='https:'||(url.protocol==='http:'&&local&&env.AUTH_LOCAL==='true'))) fail('INPUT','Use Pier’s https:// address. A http:// address works only for a Pier on this computer.',400)
 return url.origin
}
async function pierCustomer(base:string,key:string) {
 let response:Response
 try { response=await fetch(base+'/api/pier/state',{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{cookie:`pier_channel=${key}`,origin:base}}) }
 catch { return fail('PIER_UNAVAILABLE',`Stall could not reach Pier at ${base}. Check that Pier is running at that address.`,400) }
 const body:any=await response.json().catch(()=>({}))
 if(!response.ok) fail('PIER_REFUSED',typeof body?.error?.message==='string'?`Pier refused the key: ${body.error.message}`:'Pier refused the key. Create a new key for Stall in Pier and paste it here.',400)
 const customers=Array.isArray(body.parties)?body.parties.filter((p:any)=>p?.kind==='customer'):[]
 if(customers.length!==1) fail('PIER_RESPONSE','Pier did not name one shop customer for this key. Create a new key for Stall in Pier.',400)
 return String(customers[0].id)
}
async function stripeAccount(secret:string) {
 let response:Response
 try { response=await fetch('https://api.stripe.com/v1/balance',{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{authorization:`Bearer ${secret}`,'Stripe-Version':'2025-06-30.basil'}}) }
 catch { return fail('STRIPE_UNAVAILABLE','Stall could not reach Stripe to check the key. Try again.',400) }
 if(!response.ok) fail('STRIPE_REFUSED','Stripe refused this secret key. Copy the secret key again from Stripe → Developers → API keys.',400)
}

export async function connectionCommand(env:Bindings,actor:Actor,type:string,p:any) {
 requirePerson(actor)
 if(actor.role!=='owner') fail('FORBIDDEN','Only the owner may change Stall’s connections.',403)
 let name:Name,value:Record<string,string>|null
 if(type==='connection.pier') {
  const base=origin(p.origin,env),pierKey=text(p.key,'Pier key',200).trim()
  if(!PIER_KEY.test(pierKey)) fail('INPUT','Paste the key Pier showed for Stall. It starts with pier_stall_.',400)
  name='pier';value={PIER_ORIGIN:base,PIER_SESSION:`pier_channel=${pierKey}`,PIER_CUSTOMER_ID:await pierCustomer(base,pierKey)}
 } else if(type==='connection.stripe') {
  const secret=text(p.secretKey,'Stripe secret key',300).trim(),given=typeof p.webhookSecret==='string'&&p.webhookSecret.trim()!==''
  if(!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secret)) fail('INPUT','Paste Stripe’s secret key. It starts with sk_test_ or sk_live_.',400)
  // Stripe sends webhooks only to public addresses. A shop on this computer asks
  // Stripe instead, so a signing secret here could only be invented: refuse it.
  if(env.AUTH_LOCAL==='true'&&given) fail('INPUT','Leave the webhook signing secret empty. A shop on this computer cannot receive Stripe’s webhooks, so Stall confirms each payment by asking Stripe. Webhooks are for an online shop.',400)
  const webhook=env.AUTH_LOCAL==='true'?null:text(p.webhookSecret,'Stripe webhook signing secret',300).trim()
  if(webhook!==null&&!/^whsec_[A-Za-z0-9]+$/.test(webhook)) fail('INPUT','Paste the webhook signing secret from your Stripe webhook endpoint. It starts with whsec_.',400)
  await stripeAccount(secret)
  name='stripe';value={STRIPE_SECRET_KEY:secret,...(webhook?{STRIPE_WEBHOOK_SECRET:webhook}:{})}
 } else if(type==='connection.remove') {
  if(!['pier','stripe'].includes(p.name)) fail('INPUT','Choose Pier or Stripe.',400)
  name=p.name;value=null
 } else return fail('COMMAND','Unknown connection command.',404)
 const statement=value?env.DB.prepare('INSERT INTO st_connections VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET sealed=excluded.sealed,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(name,await seal(env,name,value),actor.id,new Date().toISOString()):env.DB.prepare('DELETE FROM st_connections WHERE name=?').bind(name)
 await commit(env.DB,actor,[statement,audit(env.DB,actor,name,value?'connection.saved':'connection.removed')])
 return {name,connected:Boolean(value),...(value?.PIER_ORIGIN?{origin:value.PIER_ORIGIN}:{})}
}
