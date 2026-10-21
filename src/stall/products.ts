import type { Bindings } from '../auth.server'
import { audit,changed,commit } from './access'
import { products } from './store'
import { productDetails } from './product-details'
import { pierState } from './pier'
import { checkListing,liveSkus } from './listing-checks'
import { approval,fail,integer,requirePerson,text,type Actor,type ProductValue } from './model'
export async function productCommand(env:Bindings,actor:Actor,type:string,p:any) {
 const sku=text(p.sku,'SKU',100)
 const prior=(await products(env.DB)).find(p=>p.id===sku)
 let value:ProductValue
 if(type==='product.prepare') {
  if(prior&&p.revision!==prior.revision) fail('CHANGED','Refresh this product before preparing a new version.')
  const details=p.details===undefined?(prior?.value.draft??prior?.value)?.details:productDetails(p.details)
  const before=prior?.value.draft??prior?.value
  const archived=p.archived===undefined?before?.archived===true:p.archived===true
  let publishAt=p.publishAt===undefined?before?.publishAt:undefined
  if(p.publishAt!==undefined&&p.publishAt!==null) { const time=Date.parse(typeof p.publishAt==='string'?p.publishAt:''); if(!Number.isFinite(time)) fail('INPUT','Scheduled publication needs a valid date and time.',400);publishAt=new Date(time).toISOString() }
  if(archived) publishAt=undefined
  const draft:Omit<ProductValue,'draft'>={...(details&&Object.keys(details).length?{details}:{}),...(publishAt?{publishAt}:{}),...(archived?{archived:true as const}:{}),sku,name:text(p.name,'Product name'),description:typeof p.description==='string'&&p.description.length<=4000?p.description:fail('INPUT','Description must be at most 4000 characters.',400),unitCents:integer(p.unitCents,'Unit cents',1),active:archived?false:p.active===true}
  await checkListing(env.DB,draft,await products(env.DB))
  const {publishAt:_when,archived:_gone,...unlisted}=draft
  value=prior?{...prior.value,draft}:{...unlisted,active:false,draft}
 } else {
  requirePerson(actor)
  if(!prior?.value.draft||p.revision!==prior.revision) fail('CHANGED','Approve the exact prepared product revision.')
  await checkListing(env.DB,prior.value.draft,await products(env.DB))
  if(prior.value.draft.active) {
   const stock=await pierState(env),needed=liveSkus(prior.value.draft)
   if(!needed.length) fail('LISTING_VARIANTS','Keep at least one variant that is not archived.',400)
   const missing=needed.find(need=>!Array.isArray(stock.items)||!stock.items.some((item:any)=>item.sku===need&&!item.archived))
   if(missing) fail('PIER_SKU',`${missing} must exist and be active in Pier before publication.`)
  }
  value={...prior.value.draft,approval:approval(actor,prior.revision)}
 }
 const revision=crypto.randomUUID()
 const statement=prior?env.DB.prepare('UPDATE st_products SET value_json=?,revision=? WHERE id=? AND revision=?').bind(JSON.stringify(value),revision,sku,prior.revision):env.DB.prepare('INSERT INTO st_products VALUES(?,?,?)').bind(sku,JSON.stringify(value),revision)
 await commit(env.DB,actor,[statement,changed(env.DB),audit(env.DB,actor,sku,type==='product.prepare'?'product.prepared':'product.published')])
 return {id:sku,value,revision}
}
