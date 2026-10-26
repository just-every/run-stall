import type { Bindings } from '../../auth.server'
import { audit,clientKey,digest } from '../access'
import { fail,integer,Problem,text,type Order } from '../model'
import { rawBody } from '../stripe'
import { rate } from '../headless/auth'
import { customerActor,customerCommit,customerOrder,ownOrder } from './account'

const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow'}})
const tokenDigest=(env:Bindings,token:string)=>digest(`${env.SESSION_SECRET}\nguest-order\n${token}`)
async function input(request:Request) {
 try {const p=JSON.parse(await rawBody(request,10000));if(!p||typeof p!=='object'||Array.isArray(p))fail('INPUT','Supply a JSON object.',400);return p}
 catch(error){if(error instanceof Problem)throw error;return fail('INPUT','Invalid JSON.',400)}
}
export type GuestOrderAccess={order:Order;digest:string;expiresAt:number}
/** One opaque capability reads one paid order. It never supplies checkout authority. */
export async function guestOrder(env:Bindings,token:unknown,orderId?:string):Promise<GuestOrderAccess> {
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))fail('NOT_FOUND','Order link expired, revoked or unavailable.',404)
 const hash=await tokenDigest(env,token),row=await env.DB.prepare(`SELECT l.order_id,l.expires_at,o.value_json,o.revision FROM st_guest_order_links l JOIN st_orders o ON o.id=l.order_id WHERE l.digest=? AND l.expires_at>? AND lower(json_extract(o.value_json,'$.customerEmail'))=l.email AND json_extract(o.value_json,'$.erasedAt') IS NULL AND json_extract(o.value_json,'$.payment') IS NOT NULL`).bind(hash,Date.now()).first<{order_id:string;expires_at:number;value_json:string;revision:string}>()
 if(!row||(orderId!==undefined&&row.order_id!==orderId))fail('NOT_FOUND','Order link expired, revoked or unavailable.',404)
 const order:Order={...JSON.parse(row.value_json),revision:row.revision}
 return {order,digest:hash,expiresAt:row.expires_at}
}
/** Rechecked in the cart write transaction so revocation cannot race a copy. */
export function guestOrderGuard(env:Bindings,access:GuestOrderAccess) {
 return env.DB.prepare(`INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_guest_order_links l JOIN st_orders o ON o.id=l.order_id WHERE l.order_id=? AND l.digest=? AND l.expires_at>? AND o.revision=? AND lower(json_extract(o.value_json,'$.customerEmail'))=l.email AND json_extract(o.value_json,'$.erasedAt') IS NULL AND json_extract(o.value_json,'$.payment') IS NOT NULL) THEN 1 ELSE 0 END`).bind(access.order.id,access.digest,Date.now(),access.order.revision)
}
export async function guestOrderResponse(request:Request,env:Bindings):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(!['/api/stall/guest-order','/api/stall/account/guest-order-link'].includes(path))return null
 if(request.headers.has('authorization'))fail('CUSTOMER_AUTH','Use the native account or private order link.',401)
 if(request.headers.has('origin')&&request.headers.get('origin')!==env.AUTH_ORIGIN)fail('ORIGIN','Use this shop’s own order page.',403)
 await rate(env,'guest-order:'+await clientKey(env,request),120)
 if(path==='/api/stall/guest-order') {
  if(request.method!=='GET')fail('METHOD','Use GET.',405)
  const access=await guestOrder(env,request.headers.get('x-stall-order-token'))
  return json({order:customerOrder(access.order),orderId:access.order.id,expiresAt:new Date(access.expiresAt).toISOString()})
 }
 const actor=await customerActor(request,env)
 if(!['POST','DELETE'].includes(request.method))fail('METHOD','Use POST or DELETE.',405)
 const p=await input(request)
 if(Object.keys(p).some(key=>!['orderId',...(request.method==='POST'?['expiresInSeconds']:[])].includes(key)))fail('INPUT','Supply the order ID and optional link lifetime only.',400)
 const original=await ownOrder(env,actor,text(p.orderId,'Order ID',100))
 if(!original.payment)fail('PAST_ORDER_REQUIRED','Only a paid past order can have a guest link.')
 const guard=env.DB.prepare(`INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_orders WHERE id=? AND revision=? AND lower(json_extract(value_json,'$.customerEmail'))=? AND json_extract(value_json,'$.erasedAt') IS NULL AND json_extract(value_json,'$.payment') IS NOT NULL) THEN 1 ELSE 0 END`).bind(original.id,original.revision,actor.email.toLowerCase())
 if(request.method==='DELETE') {
  await customerCommit(env,actor,[guard,env.DB.prepare('DELETE FROM st_guest_order_links WHERE order_id=?').bind(original.id),audit(env.DB,actor,original.id,'customer.order-link-revoked')])
  return json({revoked:true,orderId:original.id})
 }
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join(''),expiresAt=Date.now()+integer(p.expiresInSeconds??86400,'Link lifetime seconds',1,604800)*1000
 await customerCommit(env,actor,[guard,env.DB.prepare('INSERT INTO st_guest_order_links VALUES(?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET digest=excluded.digest,email=excluded.email,expires_at=excluded.expires_at').bind(original.id,await tokenDigest(env,token),actor.email.toLowerCase(),expiresAt),audit(env.DB,actor,original.id,'customer.order-link-issued')])
 return json({token,orderId:original.id,expiresAt:new Date(expiresAt).toISOString()})
}
