import type { Bindings } from '../auth.server'
import { audit,commit,live } from './access'
import { requirePerson,requireSupplier,type Actor } from './model'
import { pierConfigured,pierState } from './pier'
import { paymentsReady,stripe } from './stripe'

export type ProviderObservation={checkedAt:string;status:'ready'|'unavailable'|'not_configured';message:string}
const messages={ready:'The provider answered the read-only check.',unavailable:'The provider check failed. Check the saved connection and provider availability.',not_configured:'Complete the provider connection before checking it.'} as const
export function providerConfiguration(env:Bindings) {
 return {pier:pierConfigured(env),stripe:paymentsReady(env)}
}
export async function providerObservations(env:Bindings) {
 const rows=(await env.DB.prepare("SELECT key,value_json FROM st_operations WHERE key IN ('provider:pier','provider:stripe')").all<{key:string;value_json:string}>()).results
 const result:{pier:ProviderObservation|null;stripe:ProviderObservation|null}={pier:null,stripe:null}
 for(const row of rows) {
  const name=row.key==='provider:pier'?'pier':'stripe',value=JSON.parse(row.value_json)
  if(['ready','unavailable','not_configured'].includes(value.status)&&Number.isFinite(Date.parse(value.checkedAt))) {
   const status=value.status as ProviderObservation['status']
   result[name]={checkedAt:value.checkedAt,status,message:messages[status]}
  }
 }
 return result
}
/** Explicit staff action; never writes to either provider or stores their payload. */
export async function probeProviders(env:Bindings,actor:Actor) {
 requirePerson(actor);requireSupplier(actor);await live(env,actor)
 const configured=providerConfiguration(env)
 const observations=await Promise.all((['pier','stripe'] as const).map(async name=>{
  let status:ProviderObservation['status']='not_configured'
  if(configured[name]) {
   try {
    if(name==='pier') {
     const state=await pierState(env)
     if(!Array.isArray(state.items)||!Array.isArray(state.locations)||!Array.isArray(state.positions)||!Array.isArray(state.parties)||!state.parties.some((party:any)=>party.id===env.PIER_CUSTOMER_ID&&party.kind==='customer')) throw new Error('Invalid provider response')
    } else {
     const balance=await stripe(env,'/balance')
     if(balance?.object!=='balance'||!Array.isArray(balance.available)||!Array.isArray(balance.pending)) throw new Error('Invalid provider response')
    }
    status='ready'
   } catch { status='unavailable' }
  }
  const value:ProviderObservation={checkedAt:new Date().toISOString(),status,message:messages[status]}
  return {name,value}
 }))
 await commit(env.DB,actor,[...observations.map(({name,value})=>env.DB.prepare('INSERT INTO st_operations(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json').bind('provider:'+name,JSON.stringify(value))),audit(env.DB,actor,'operations','operations.providers-probed')])
 return Object.fromEntries(observations.map(({name,value})=>[name,value]))
}
