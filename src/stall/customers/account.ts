import type { Bindings } from '../../auth.server'
import { current } from '../access'
import { fail,text,type Actor,type Order } from '../model'
import { orders,readOrder } from '../store'
export async function customerActor(request:Request,env:Bindings) {
 if(request.headers.has('authorization')) fail('CUSTOMER_AUTH','Use your independently verified native customer session.',401)
 const actor=await current(request,env)
 if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==env.AUTH_ORIGIN) fail('ORIGIN','Use this shop’s own account page.',403)
 return actor
}
/** Customer authority is independent of merchant/staff permissions. Rechecked
 * in the write transaction, including native session expiry/revocation. */
export async function customerCommit(env:Bindings,a:Actor,statements:D1PreparedStatement[]=[]) {
 await env.DB.batch([env.DB.prepare(`INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND o.id=? AND o.version=? AND s.operator_version=o.version AND lower(o.email)=? AND o.status='active' AND s.revoked_at IS NULL AND s.expires_at>?) THEN 1 ELSE 0 END`).bind(a.sessionId!,a.id,a.version,a.email.toLowerCase(),Date.now()),...statements,env.DB.prepare('DELETE FROM st_guard')])
}
export function customerOrder(o:Order) {
 return {id:o.id,createdAt:o.createdAt,status:o.status,totalCents:o.totalCents,currency:o.currency,shippingCents:o.shippingCents??0,shippingDetails:o.shippingDetails,
 lines:o.lines.map(({sku,name,quantity,unitCents,variant,personalization})=>({sku,name,quantity,unitCents,variant,personalization:personalization?.map(({fileId,fileName,...answer})=>answer)})),
 shipment:o.shipment?{status:o.shipment.status,dispatches:o.shipment.dispatches?.map(({shippedAt,deliveryStatus,tracking})=>({shippedAt,deliveryStatus,tracking}))}:null,
 refunds:o.refunds.map(({id,status,amountCents,lines})=>({id,status,amountCents,lines}))}
}
export async function ownOrder(env:Bindings,a:Actor,id:string) {
 const o=await readOrder(env.DB,id)
 if(o.erasedAt||o.customerEmail?.toLowerCase()!==a.email.toLowerCase()) fail('NOT_FOUND','Order not found.',404)
 await customerCommit(env,a)
 return o
}
export async function account(env:Bindings,a:Actor) {
 const email=a.email.toLowerCase()
 const history=(await orders(env.DB)).filter(o=>!o.erasedAt&&o.customerEmail?.toLowerCase()===email).sort((x,y)=>y.createdAt.localeCompare(x.createdAt)||y.id.localeCompare(x.id))
 const addresses=(await env.DB.prepare('SELECT id,revision,value_json FROM st_customer_addresses WHERE email=? ORDER BY created_at,id').bind(email).all<any>()).results.map(({value_json,...r})=>({...r,address:JSON.parse(value_json)}))
 const requests=(await env.DB.prepare(`SELECT id,order_id AS orderId,kind,created_at AS createdAt FROM st_workflow_requests WHERE order_id IN(SELECT id FROM st_orders WHERE lower(json_extract(value_json,'$.customerEmail'))=? AND json_extract(value_json,'$.erasedAt') IS NULL) ORDER BY created_at DESC,id`).bind(email).all()).results
 await customerCommit(env,a)
 return {email,orders:history.map(customerOrder),addresses,requests,giftBalanceStatus:'not_available',authentication:'native_verified_email_invitation',registration:'owner_invitation_required'}
}
export function addressValue(p:any) {
 if(!p||typeof p!=='object'||Array.isArray(p)||!['US','CA'].includes(p.country)) fail('INPUT','Choose a US or Canadian address.',400)
 const value={name:text(p.name,'Recipient',200),line1:text(p.line1,'Address line 1',200),line2:p.line2?text(p.line2,'Address line 2',200):'',city:text(p.city,'City',100),state:text(p.state,'State or province',2).toUpperCase(),postal_code:text(p.postal_code,'Postal code',10).toUpperCase(),country:p.country as string}
 if(!/^[A-Z]{2}$/.test(value.state)||(value.country==='US'?!/^\d{5}(-\d{4})?$/.test(value.postal_code):! /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTVWXYZ] ?\d[ABCEGHJ-NPRSTVWXYZ]\d$/.test(value.postal_code))) fail('INPUT','Enter a valid two-letter state/province and postal code.',400)
 return value
}
export async function saveAddress(env:Bindings,a:Actor,p:any,remove=false) {
 if(!p||Object.keys(p).some(k=>!['id','revision','address'].includes(k))) fail('INPUT','Supply only the address and its current revision.',400)
 const email=a.email.toLowerCase(),id=p.id?text(p.id,'Address ID',100):crypto.randomUUID(),revision=crypto.randomUUID()
 const existing=await env.DB.prepare('SELECT revision FROM st_customer_addresses WHERE id=? AND email=?').bind(id,email).first<{revision:string}>()
 if(p.id&&(!existing||existing.revision!==p.revision)) fail('NOT_FOUND','Address not found or changed. Refresh your own address book.',404)
 if(remove&&!existing) fail('NOT_FOUND','Address not found.',404)
 const statements=remove?[env.DB.prepare('DELETE FROM st_customer_addresses WHERE id=? AND email=? AND revision=?').bind(id,email,p.revision)]:existing?
 [env.DB.prepare('UPDATE st_customer_addresses SET value_json=?,revision=? WHERE id=? AND email=? AND revision=?').bind(JSON.stringify(addressValue(p.address)),revision,id,email,p.revision)]:
 [env.DB.prepare('INSERT INTO st_customer_addresses SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM st_customer_addresses WHERE email=?)<20').bind(id,email,revision,JSON.stringify(addressValue(p.address)),new Date().toISOString(),email)]
 await customerCommit(env,a,[...statements,env.DB.prepare('INSERT INTO st_guard(value) VALUES(changes())'),env.DB.prepare('INSERT INTO st_audit VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,'customer:'+a.id,remove?'customer.address-deleted':'customer.address-saved',new Date().toISOString())])
 return account(env,a)
}
