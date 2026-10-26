import { allowedOrigins,widgetChoices,widgetSelection,widgetScript } from './buy-widgets'
import type { Bindings } from '../auth.server'
import { audit,changed,commit,current,live } from './access'
import { fail,requirePerson,requireSupplier,text } from './model'
import { rawBody } from './stripe'
import { priceLines,selectLines } from './order-selection'
import { promotionCode } from './promotions/model'
import { cartContext,cartCreate,cartPublic } from './customers/cart'
import { rate } from './headless/auth'

type BuyLink={id:string;revision:string;value_json:string;revoked_at:string|null;restored:number}
const base='/api/stall/buy-links'
const json=(value:unknown,headers:Record<string,string>={})=>Response.json(value,{headers:{'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff',...headers}})
async function input(request:Request) {try {const p=JSON.parse(await rawBody(request,20000));if(p&&typeof p==='object'&&!Array.isArray(p))return p}catch{}return fail('INPUT','Supply a JSON object.',400)}
export async function activeBuyLink(env:Bindings,id:string) {
 const row=await env.DB.prepare('SELECT * FROM st_buy_links WHERE id=?').bind(id).first<BuyLink>()
 if(!row||row.revoked_at||row.restored)fail('BUY_LINK_UNAVAILABLE','This checkout link is no longer available.',404)
 return {...row,value:JSON.parse(row.value_json)}
}
export async function buyLinkResponse(request:Request,env:Bindings):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(path!==base&&!path.startsWith(base+'/'))return null
 const script=path.slice(base.length+1).match(/^([a-f0-9-]{36})\.js$/)
 if(script&&request.method==='GET')return new Response(widgetScript(env.AUTH_ORIGIN,script[1]),{headers:{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}})
 if(path===base||path.endsWith('/revoke')) {
  const actor=await current(request,env);requireSupplier(actor);requirePerson(actor)
  if(actor.staffRole)fail('FORBIDDEN','Use the owner or administrator’s native session.',403)
  await live(env,actor)
  if(request.method==='GET'&&path===base) {
   const [rows,count]=await Promise.all([env.DB.prepare('SELECT * FROM st_buy_links ORDER BY rowid DESC LIMIT 100').all<BuyLink>(),env.DB.prepare('SELECT COUNT(*) AS total FROM st_buy_links').first<{total:number}>()])
   return json({links:rows.results.map(({value_json,...row})=>({...row,value:JSON.parse(value_json)})),total:count!.total,truncated:count!.total>rows.results.length})
  }
  if(request.method!=='POST')fail('METHOD','Use POST to change checkout links.',405)
  if(request.headers.get('origin')!==env.AUTH_ORIGIN)fail('ORIGIN','Use this shop’s settings.',403)
  const p=await input(request)
  if(path.endsWith('/revoke')) {
   const id=path.slice(base.length+1,-7),revision=text(p.revision,'Revision',100),prior=await activeBuyLink(env,id)
   if(prior.revision!==revision)fail('CHANGED','Refresh this checkout link before revoking it.')
   await commit(env.DB,actor,[env.DB.prepare('UPDATE st_buy_links SET revoked_at=?,revision=? WHERE id=? AND revision=?').bind(new Date().toISOString(),crypto.randomUUID(),id,revision),changed(env.DB),audit(env.DB,actor,id,'buy-link.revoked')])
   return json({revoked:true})
  }
  if(Object.keys(p).some(key=>!['label','lines','promotionCode','kind','allowedOrigins','collection','productSku'].includes(key)))fail('INPUT','Use label, lines and an optional promotion code.',400)
  if(Array.isArray(p.lines)&&p.lines.some((line:any)=>!line||Object.keys(line).some(key=>!['sku','quantity'].includes(key))))fail('INPUT','Checkout links preload only variant SKUs and quantities.',400)
  const kind=p.kind??'link'
  if(!['link','buy_button','product_card','collection'].includes(kind))fail('INPUT','Choose a checkout link, Buy Button, product card or collection widget.',400)
  const lines=['link','buy_button'].includes(kind)?selectLines(p.lines):undefined
  if(kind==='buy_button'&&lines!.length!==1)fail('INPUT','A Buy Button selects one variant; use a collection for multiple products.',400)
  if(lines)await priceLines(env,lines)
  const value={label:text(p.label,'Label',120),...(kind!=='link'?{kind,allowedOrigins:allowedOrigins(p.allowedOrigins)}:{}),...(lines?{lines}:{}),...(kind==='collection'?{collection:text(p.collection,'Collection handle',80)}:{}),...(kind==='product_card'?{productSku:text(p.productSku,'Product SKU',100)}:{}),...(p.promotionCode!==undefined?{promotionCode:promotionCode(p.promotionCode)}:{})},id=crypto.randomUUID(),revision=crypto.randomUUID()
  if(kind!=='link'&&!(await widgetChoices(env,value)).length)fail('PRODUCT','Choose a published product or nonempty collection.',400)
  await commit(env.DB,actor,[env.DB.prepare('INSERT INTO st_buy_links VALUES(?,?,?,NULL,0)').bind(id,revision,JSON.stringify(value)),audit(env.DB,actor,id,'buy-link.created')])
  return json({id,revision,value,url:env.AUTH_ORIGIN+'/shop?buy='+id,...(kind!=='link'?{embed:'<script src="'+env.AUTH_ORIGIN+base+'/'+id+'.js" defer></script>'}:{})})
 }
 const match=path.slice(base.length+1).match(/^([a-f0-9-]{36})(\/cart|\/widget)?$/)
 if(!match)fail('NOT_FOUND','Checkout link not found.',404)
 const link=await activeBuyLink(env,match[1])
 if(match[2]==='/widget'&&request.method==='GET') {
  const origin=request.headers.get('origin')
  if(!origin||!link.value.allowedOrigins?.includes(origin))fail('ORIGIN','This website is not allowed to use this embed.',403)
  return json({label:link.value.label,items:await widgetChoices(env,link.value),url:env.AUTH_ORIGIN+'/shop?buy='+link.id},{'access-control-allow-origin':origin,'vary':'Origin'})
 }
 const params=new URL(request.url).searchParams
 const selection=link.value.kind?await widgetSelection(env,link.value,params.get('sku'),params.has('quantity')?Number(params.get('quantity')):undefined):link.value.lines
 const lines=await priceLines(env,selection)
 if(!match[2]&&request.method==='GET')return json({id:link.id,label:link.value.label,lines:lines.map(({sku,name,quantity,unitCents})=>({sku,name,quantity,unitCents})),promotionCode:link.value.promotionCode??null})
 if(match[2]==='/cart'&&request.method==='POST') {
  const ctx=await cartContext(request,env);await rate(env,'buy-link:'+ctx.client,30)
  const cart=await cartCreate(env,ctx,{lines:selection,customerEmail:ctx.actor?.email??'',...(link.value.promotionCode?{promotionCode:link.value.promotionCode}:{}),source:{channel:link.value.kind?'buy_button':'checkout_link',id:link.id}},[env.DB.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_buy_links WHERE id=? AND revision=? AND revoked_at IS NULL AND restored=0) THEN 1 ELSE 0 END').bind(link.id,link.revision)])
  return json({cart:cartPublic(cart)},{'set-cookie':ctx.cookie})
 }
 return fail('METHOD','Use GET to preview or POST to start a native cart.',405)
}
