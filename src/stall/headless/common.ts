import { fail,Problem,text } from '../model'
import { rawBody } from '../stripe'
export const prefix='/api/stall/v1'
export const scopes=['catalog:read','cart:write','checkout:write','customer:read','orders:read'] as const
export const kinds=['order','customer','stock','promotion','return'] as const
export const now=()=>new Date().toISOString()
export const uuid=(v:unknown,name:string)=>{const value=text(v,name,100);if(!/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value)) fail('INPUT',`${name} must be a random UUID.`,400);return value}
export async function body(request:Request) {
 try {const p=JSON.parse(await rawBody(request,100000));if(!p||typeof p!=='object'||Array.isArray(p)) fail('INPUT','A JSON object is required.',400);return p}
 catch(e) {if(e instanceof Problem) throw e;return fail('INPUT','Invalid JSON request.',400)}
}
export function pickList(value:unknown,allowed:readonly string[],name:string) {
 if(!Array.isArray(value)||!value.length||value.length>allowed.length||value.some(v=>typeof v!=='string'||!allowed.includes(v))||new Set(value).size!==value.length) fail('INPUT',`Choose distinct supported ${name}.`,400)
 return value as string[]
}
export function json(value:unknown,status=200,origin?:string) {
 return Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',vary:'Origin',...(origin?{'access-control-allow-origin':origin,'access-control-allow-credentials':'true'}:{})}})
}
export function origin(value:unknown,local=false) {
 const raw=text(value,'Storefront origin',300);let u:URL
 try {u=new URL(raw)}catch{return fail('INPUT','Use one exact HTTPS origin.',400)}
 if(u.origin!==raw||u.username||u.password||(u.protocol!=='https:'&&!(local&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))) fail('INPUT','Use one exact HTTPS origin.',400)
 return u.origin
}
