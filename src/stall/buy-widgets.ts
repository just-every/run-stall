import type { Bindings } from '../auth.server'
import { catalogue } from './pier'
import { collections } from './collections'
import { merchandising } from './merchandising'
import { collectionMembers } from './discover'
import { fail,integer,text } from './model'

export function allowedOrigins(input:unknown):string[] {
 if(!Array.isArray(input)||!input.length||input.length>20)fail('INPUT','Each embed needs between one and 20 allowed HTTPS origins.',400)
 return [...new Set(input.map(value=>{
  const origin=text(value,'Allowed origin',300)
  let url:URL;try{url=new URL(origin)}catch{return fail('INPUT','Use a complete HTTPS origin without a path.',400)}
  if(url.protocol!=='https:'||url.origin!==origin||url.username||url.password)fail('INPUT','Use an exact HTTPS origin, without a path, credentials or wildcard.',400)
  return origin
 }))]
}
/** Widget data always comes from the same published catalog and collection rules as the shop. */
export async function widgetChoices(env:Bindings,value:any) {
 const stock=await catalogue(env)
 let candidates=stock.items
 if(value.kind==='collection') {
  const saved=await collections(env.DB)
  if(!saved.some(c=>c.id===value.collection&&c.value.published))fail('BUY_LINK_UNAVAILABLE','This collection is no longer published.',404)
  const config=await merchandising(env.DB),found=collectionMembers({products:stock.products,items:stock.items,collections:saved,config:config.value},value.collection)
  const skus=new Set(found.flatMap(product=>product.skus))
  candidates=candidates.filter(item=>skus.has(item.sku))
 }else if(value.kind==='product_card') {
  const product=stock.products.find(p=>p.sku===value.productSku)
  candidates=candidates.filter(item=>product?.skus.includes(item.sku))
 }else candidates=candidates.filter(item=>value.lines?.some((line:any)=>line.sku===item.sku))
 return candidates.map(item=>({sku:item.sku,name:item.name,unitCents:item.unitCents,available:item.available,quantity:value.lines?.find((line:any)=>line.sku===item.sku)?.quantity??1}))
}
export async function widgetSelection(env:Bindings,value:any,sku:unknown,quantity:unknown) {
 const choices=await widgetChoices(env,value),selected=text(sku,'Variant SKU',100),item=choices.find(item=>item.sku===selected)
 if(!item)fail('PRODUCT','Choose a currently published variant in this widget.')
 return [{sku:selected,quantity:integer(quantity??item.quantity,'Quantity',1,1000)}]
}
/** No credentials, storage, tracking or remote scripts; only approved-origin public data and native checkout navigation. */
export function widgetScript(origin:string,id:string) {
 return `(()=>{const script=document.currentScript,host=document.createElement('div');script.after(host);const root=host.attachShadow({mode:'open'}),style=document.createElement('style');style.textContent=':host{display:block;font:16px system-ui,sans-serif;color:#25251f}section{display:grid;gap:12px;padding:16px;border:1px solid #d8d6cb;border-radius:12px}article{display:grid;gap:8px}button,input{font:inherit;padding:8px}input{width:72px}';root.append(style);const panel=document.createElement('section');panel.setAttribute('aria-label','Stall buy widget');root.append(panel);const load=async()=>{try{const response=await fetch(${JSON.stringify(origin+'/api/stall/buy-links/'+id+'/widget')},{credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});if(!response.ok)throw Error();const data=await response.json();panel.replaceChildren();const title=document.createElement('h2');title.textContent=data.label;panel.append(title);if(!data.items.length){const empty=document.createElement('p');empty.textContent='No published products available.';panel.append(empty)}for(const item of data.items){const row=document.createElement('article'),name=document.createElement('strong'),price=document.createElement('span'),label=document.createElement('label'),qty=document.createElement('input'),buy=document.createElement('button');name.textContent=item.name;price.textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(item.unitCents / 100)+' · '+(Number(item.available)>0?item.available+' available':'Sold out');label.textContent='Quantity for '+item.name+' ';qty.type='number';qty.min='1';qty.max=String(Math.min(1000,Math.floor(Number(item.available))));qty.value=String(item.quantity);label.append(qty);buy.type='button';buy.textContent='Buy in Stall';buy.disabled=Number(item.available)<item.quantity;qty.addEventListener('input',()=>{const n=Number(qty.value);buy.disabled=!Number.isSafeInteger(n)||n<1||n>Math.min(1000,Number(item.available))});buy.addEventListener('click',()=>{const url=new URL(data.url);url.searchParams.set('sku',item.sku);url.searchParams.set('quantity',qty.value);window.location.assign(url.href)});row.append(name,price,label,buy);panel.append(row)}const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh availability';refresh.addEventListener('click',load);panel.append(refresh)}catch{panel.textContent='This embed is unavailable or is not allowed on this website.'}};void load();})();`
}
