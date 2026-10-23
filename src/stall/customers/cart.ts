import { operatorAuth,type Bindings } from '../../auth.server'
import { audit,changed,clientKey,commit,current,digest,live } from '../access'
import { fail,text,email,Problem,type Actor } from '../model'
import { rawBody } from '../stripe'
import { selectLines,priceSelection,type Selected } from '../order-selection'
import { checkout } from '../checkout'
import { qualification,requireQualified } from '../promotions/eligibility'
import { promotionCode } from '../promotions/model'
import { customerCommit,requireProvenEmail } from './account'
import { reorder } from './reorder'
import { checkoutFields,fieldReport,fieldSave,shopperDetails } from './checkout-details'
import { rate } from '../headless/auth'
export type CartContext={actor:Actor|null;guestHash:string;cookie:string;client:string}
export type NativeCart={id:string;owner_email:string|null;guest_hash:string|null;revision:string;value_json:string;updated_at:string;review_digest:string|null;checkout_key:string|null;checkout_intent:string|null;order_id:string|null}
export const cartPublic=(r:NativeCart)=>({id:r.id,revision:r.revision,value:JSON.parse(r.value_json),updatedAt:r.updated_at,locked:!!r.checkout_key,orderId:r.order_id})
const json=(v:unknown,ctx?:CartContext)=>Response.json(v,{headers:{'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff',...(ctx?{'set-cookie':ctx.cookie}:{})}})
async function input(r:Request) {let p:any;try{p=JSON.parse(await rawBody(r,100000))}catch{fail('INPUT','Supply a JSON object.',400)}if(!p||typeof p!=='object'||Array.isArray(p))fail('INPUT','Supply a JSON object.',400);return p}
export async function cartContext(request:Request,env:Bindings):Promise<CartContext> {
 if(request.headers.has('authorization'))fail('CUSTOMER_AUTH','Use the native guest cart or independently verified customer session.',401)
 if(request.method!=='GET'&&request.headers.get('origin')!==env.AUTH_ORIGIN)fail('ORIGIN','Use this shop’s own cart.',403)
 const s=await operatorAuth(env).getSession(request),actor:Actor|null=s?{id:s.operator.id,email:s.operator.email,role:s.operator.role,version:s.operator.version,sessionId:s.id,agent:false}:null
 if(s)await requireProvenEmail(env,s.id,s.operator.id)
 const previous=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('stall_cart='))?.slice(11),token=previous&&/^[a-f0-9]{64}$/.test(previous)?previous:Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('')
 return {actor,guestHash:await digest(token),client:await clientKey(env,request),cookie:`stall_cart=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${new URL(env.AUTH_ORIGIN).protocol==='https:'?'; Secure':''}`}
}
function ownership(ctx:CartContext) {return ctx.actor?{sql:'owner_email=?',value:ctx.actor.email.toLowerCase()}:{sql:'owner_email IS NULL AND guest_hash=?',value:ctx.guestHash}}
export async function cartRead(env:Bindings,ctx:CartContext,id?:string):Promise<NativeCart|null> {
 const own=ownership(ctx),r=await env.DB.prepare(`SELECT * FROM st_shop_carts WHERE ${own.sql}${id?' AND id=?':''} ORDER BY updated_at DESC,rowid DESC LIMIT 1`).bind(own.value,...(id?[id]:[])).first<NativeCart>()
 if(id&&!r)fail('NOT_FOUND','Cart not found.',404)
 if(ctx.actor)await customerCommit(env,ctx.actor)
 return r
}
export async function cartWrite(env:Bindings,ctx:CartContext,statements:D1PreparedStatement[]) {if(ctx.actor)await customerCommit(env,ctx.actor,statements);else await env.DB.batch([...statements,env.DB.prepare('DELETE FROM st_guard')])}
function selection(value:any):Selected[] {if(Array.isArray(value)&&!value.length)return [];return selectLines(value)}
export async function cartCreate(env:Bindings,ctx:CartContext,value:any,guards:D1PreparedStatement[]=[]) {
 const id=crypto.randomUUID(),stamp=new Date().toISOString(),revision=crypto.randomUUID()
 await cartWrite(env,ctx,[...guards,env.DB.prepare('INSERT INTO st_shop_carts VALUES(?,?,?,?,?,?,NULL,NULL,NULL,NULL)').bind(id,ctx.actor?.email.toLowerCase()??null,ctx.actor?null:ctx.guestHash,revision,JSON.stringify(value),stamp),env.DB.prepare('INSERT INTO st_audit VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,ctx.actor?'customer:'+ctx.actor.id:'guest','cart.created',stamp)])
 return (await cartRead(env,ctx,id))!
}
async function save(env:Bindings,ctx:CartContext,p:any) {
 if(Object.keys(p).some(k=>!['cartId','revision','lines','customerEmail','shopper','shipping','promotionCode'].includes(k)))fail('INPUT','Use the supported cart fields only.',400)
 const previous=p.cartId?await cartRead(env,ctx,text(p.cartId,'Cart ID',100)):null
 if(previous&&(previous.revision!==p.revision||previous.checkout_key))fail('CART_LOCKED','Cart changed or checkout already started. Review or copy it before changing it.')
 const address=ctx.actor?ctx.actor.email.toLowerCase():p.customerEmail?email(p.customerEmail):''
 if(ctx.actor&&p.customerEmail&&email(p.customerEmail)!==address)fail('CUSTOMER_AUTH','An account checkout uses only its verified mailbox.',403)
 const value={lines:selection(p.lines??[]),customerEmail:address,...(p.shopper!==undefined?{shopper:p.shopper}:{}),...(p.shipping!==undefined?{shipping:p.shipping}:{}),...(p.promotionCode!==undefined?{promotionCode:promotionCode(p.promotionCode)}:{})}
 if(!previous)return cartPublic(await cartCreate(env,ctx,value))
 const own=ownership(ctx)
 await cartWrite(env,ctx,[env.DB.prepare(`UPDATE st_shop_carts SET value_json=?,revision=?,updated_at=?,review_digest=NULL WHERE id=? AND revision=? AND checkout_key IS NULL AND ${own.sql}`).bind(JSON.stringify(value),crypto.randomUUID(),new Date().toISOString(),previous.id,previous.revision,own.value),changed(env.DB)])
 return cartPublic((await cartRead(env,ctx,previous.id))!)
}
export async function cartQuote(env:Bindings,ctx:CartContext,row:NativeCart) {
 const value=JSON.parse(row.value_json),selected=selectLines(value.lines),customerEmail=ctx.actor?.email.toLowerCase()??email(value.customerEmail),details=await shopperDetails(env.DB,value.shopper)
 if(!details?.address)fail('ADDRESS_REQUIRED','Choose a native delivery address before checkout review.',400)
 if(details.address.country!=='US')fail('DESTINATION_UNAVAILABLE','This shop’s current checkout serves US delivery only. Your Canadian address and basket are preserved.',400)
 const shipping={...(value.shipping??{}),postalCode:details.address.postal_code},priced=await priceSelection(env,selected,undefined,shipping)
 const promotion=value.promotionCode?requireQualified(await qualification(env,value.promotionCode,customerEmail,priced.totalCents-priced.shippingCents,priced.shippingCents,priced.shipping.service.kind)):null
 const totalCents=priced.totalCents-(promotion?.discountCents??0),shopper={...value.shopper,fieldsRevision:details.fieldsRevision},review={cartId:row.id,revision:row.revision,customerEmail,lines:priced.lines,shipping:priced.shipping,subtotalCents:priced.totalCents-priced.shippingCents,discountCents:promotion?.discountCents??0,giftCardCents:0,giftCardsStatus:'not_available',shippingCents:priced.shippingCents,taxStatus:'no_tax_recorded',taxCents:0,totalCents,payableCents:totalCents,shopper:details,promotion:promotion?.snapshot??null}
 return {review,digest:await digest(JSON.stringify(review)),intent:{customerEmail,lines:selected,shipping:{service:priced.shipping.service.code,postalCode:details.address.postal_code,quote:priced.shipping.quote},shopper,...(value.promotionCode?{promotionCode:value.promotionCode}:{})}}
}
async function review(env:Bindings,ctx:CartContext,p:any) {
 const row=(await cartRead(env,ctx,text(p.cartId,'Cart ID',100)))!
 if(row.revision!==p.revision||row.checkout_key)fail('CART_LOCKED','Review the current cart before payment.')
 const quoted=await cartQuote(env,ctx,row),own=ownership(ctx)
 await cartWrite(env,ctx,[env.DB.prepare(`UPDATE st_shop_carts SET review_digest=? WHERE id=? AND revision=? AND checkout_key IS NULL AND ${own.sql}`).bind(quoted.digest,row.id,row.revision,own.value),changed(env.DB)])
 return {...cartPublic(row),review:quoted.review,reviewToken:quoted.digest}
}
async function buy(env:Bindings,ctx:CartContext,p:any) {
 const row=(await cartRead(env,ctx,text(p.cartId,'Cart ID',100)))!,own=ownership(ctx)
 if(row.revision!==p.revision||row.review_digest!==p.reviewToken)fail('REVIEW_CHANGED','Review this exact current cart before payment.')
 if(row.checkout_key?.startsWith('restored:'))fail('RESTORED_CART','This restored cart has no spending authority. Copy its lines and review a new cart.')
 let intent:any
 if(!row.checkout_key) {
  const quoted=await cartQuote(env,ctx,row)
  if(quoted.digest!==p.reviewToken)fail('REVIEW_CHANGED','Products, stock, shipping, questions or totals changed. Your basket is preserved; review again.')
  const key=crypto.randomUUID();intent={...quoted.intent,expectedTotalCents:quoted.review.totalCents,idempotencyKey:key}
  await cartWrite(env,ctx,[env.DB.prepare(`UPDATE st_shop_carts SET checkout_key=?,checkout_intent=? WHERE id=? AND revision=? AND review_digest=? AND checkout_key IS NULL AND ${own.sql}`).bind(key,JSON.stringify(intent),row.id,row.revision,quoted.digest,own.value),changed(env.DB)])
 } else {if(!row.checkout_intent)fail('CART_LOCKED','Recover the existing checkout before continuing.');intent=JSON.parse(row.checkout_intent)}
 const locked=(await cartRead(env,ctx,row.id))!
 const guard=()=>env.DB.prepare(`INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_shop_carts WHERE id=? AND revision=? AND checkout_key=? AND ${own.sql}) THEN 1 ELSE 0 END`).bind(row.id,row.revision,locked.checkout_key,own.value)
 const result=await checkout(env,intent,{check:async()=>{await cartRead(env,ctx,row.id)},statements:()=>[guard(),...(ctx.actor?[env.DB.prepare(`INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND o.id=? AND o.version=? AND s.operator_version=o.version AND o.status='active' AND lower(o.email)=? AND s.revoked_at IS NULL AND s.expires_at>?) THEN 1 ELSE 0 END`).bind(ctx.actor.sessionId!,ctx.actor.id,ctx.actor.version,ctx.actor.email.toLowerCase(),Date.now())]:[])]},ctx.actor?undefined:ctx.client)
 await cartWrite(env,ctx,[env.DB.prepare(`UPDATE st_shop_carts SET order_id=? WHERE id=? AND checkout_key=? AND ${own.sql}`).bind(result.orderId,row.id,locked.checkout_key,own.value)])
 return result
}
async function claim(env:Bindings,ctx:CartContext,p:any) {
 if(!ctx.actor||p.confirm!==true)fail('CUSTOMER_AUTH','Sign in and explicitly confirm this guest cart handoff.',403)
 const row=await env.DB.prepare('SELECT * FROM st_shop_carts WHERE id=? AND guest_hash=? AND owner_email IS NULL').bind(text(p.cartId,'Cart ID',100),ctx.guestHash).first<NativeCart>()
 if(!row||row.revision!==p.revision||row.checkout_key)fail('NOT_FOUND','A current uncommitted guest cart was not found.',404)
 const value=JSON.parse(row.value_json),address=ctx.actor.email.toLowerCase()
 if(value.customerEmail&&value.customerEmail!==address)fail('CUSTOMER_AUTH','The guest cart belongs to a different mailbox. Start a new cart.',403)
 value.customerEmail=address
 await customerCommit(env,ctx.actor,[env.DB.prepare('UPDATE st_shop_carts SET owner_email=?,guest_hash=NULL,value_json=?,revision=?,review_digest=NULL,updated_at=? WHERE id=? AND owner_email IS NULL AND guest_hash=? AND revision=? AND checkout_key IS NULL').bind(address,JSON.stringify(value),crypto.randomUUID(),new Date().toISOString(),row.id,ctx.guestHash,row.revision),changed(env.DB),audit(env.DB,ctx.actor,row.id,'cart.claimed')]);return cartPublic((await cartRead(env,ctx,row.id))!)
}
export async function cartResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname
 if(path==='/api/stall/checkout-fields') {
  if(request.method==='GET')return json(await checkoutFields(env.DB))
  if(request.method!=='POST')fail('METHOD','Use GET or POST.',405)
  const a=await current(request,env);if(request.headers.get('origin')!==env.AUTH_ORIGIN)fail('ORIGIN','Use this shop’s settings.',403);return json(await fieldSave(env,a,await input(request)))
 }
 if(path==='/api/stall/checkout-fields/report'&&request.method==='GET') {const a=await current(request,env);requireOwner(a);await live(env,a);return json(await fieldReport(env.DB,text(url.searchParams.get('field'),'Field',40)))}
 if(!['/api/stall/cart','/api/stall/cart/review','/api/stall/cart/checkout','/api/stall/cart/claim','/api/stall/cart/copy','/api/stall/cart/reorder'].includes(path))return null
 const ctx=await cartContext(request,env)
 await rate(env,'native-cart:'+ctx.guestHash,120)
 if(path==='/api/stall/cart'&&request.method==='GET')return json({cart:await cartRead(env,ctx,url.searchParams.get('cartId')??undefined).then(r=>r?cartPublic(r):null)},ctx)
 const p=await input(request)
 if(path==='/api/stall/cart/reorder'&&request.method==='POST')return json(await reorder(env,ctx,p),ctx)
 if(path==='/api/stall/cart'&&request.method==='POST')return json({cart:await save(env,ctx,p)},ctx)
 if(path==='/api/stall/cart/review'&&request.method==='POST')return json(await review(env,ctx,p),ctx)
 if(path==='/api/stall/cart/checkout'&&request.method==='POST')return json(await buy(env,ctx,p),ctx)
 if(path==='/api/stall/cart/claim'&&request.method==='POST')return json({cart:await claim(env,ctx,p)},ctx)
 if(path==='/api/stall/cart/copy'&&request.method==='POST') {const row=(await cartRead(env,ctx,text(p.cartId,'Cart ID',100)))!;return json({cart:cartPublic(await cartCreate(env,ctx,JSON.parse(row.value_json)))},ctx)}
 return fail('NOT_FOUND','Unknown cart operation.',404)
}
function requireOwner(a:Actor) {if(a.agent||!['owner','admin'].includes(a.role))fail('FORBIDDEN','Use the owner or administrator’s native session.',403)}
export function cartErasureStatements(db:D1Database,address:string) {return [db.prepare("DELETE FROM st_shop_carts WHERE owner_email=? OR lower(json_extract(value_json,'$.customerEmail'))=?").bind(address,address)]}
export async function cartBusinessRecords(db:D1Database) {
 const carts=await db.prepare('SELECT id,owner_email AS ownerEmail,revision,value_json,updated_at AS updatedAt,order_id AS orderId FROM st_shop_carts ORDER BY id').all<any>()
 return {carts:carts.results.map(({value_json,...r})=>({...r,value:JSON.parse(value_json)})),fields:await checkoutFields(db)}
}
