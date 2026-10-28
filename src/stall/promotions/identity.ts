import type { Bindings } from '../../auth.server'
import { email } from '../model'
export async function customerKey(env:Bindings,address:string) {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('stall-promotion-customer:'+email(address))))].map(v=>v.toString(16).padStart(2,'0')).join('')
}
