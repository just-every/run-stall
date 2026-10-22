import type { Bindings } from '../../auth.server'
export const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('')
const bytes=(s:string)=>new TextEncoder().encode(s)
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,'0')).join('')
async function wrappingKey(env:Bindings) {return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',bytes('stall.headless.signing.v1:'+env.SESSION_SECRET)),'AES-GCM',false,['encrypt','decrypt'])}
export async function seal(env:Bindings,value:string) {
 const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},await wrappingKey(env),bytes(value))
 return hex(iv.buffer)+':'+hex(cipher)
}
export async function unseal(env:Bindings,value:string) {
 const [iv,cipher]=value.split(':'),decode=(s:string)=>new Uint8Array(s.match(/../g)!.map(v=>parseInt(v,16)))
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv)},await wrappingKey(env),decode(cipher)))
}
export async function signature(secret:string,timestamp:number,body:string) {
 const key=await crypto.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 return `t=${timestamp},v1=${hex(await crypto.subtle.sign('HMAC',key,bytes(`${timestamp}.${body}`)))}`
}
