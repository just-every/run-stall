import type { Bindings } from '../auth.server'
import { audit,changed,commit } from './access'
import { products } from './store'
import { productDetails } from './product-details'
import { pierState } from './pier'
import { approval,fail,integer,requirePerson,text,type Actor,type ProductValue } from './model'
export async function productCommand(env:Bindings,actor:Actor,type:string,p:any) {
 const sku=text(p.sku,'SKU',100)
 const prior=(await products(env.DB)).find(p=>p.id===sku)
 let value:ProductValue
 if(type==='product.prepare') {
  if(prior&&p.revision!==prior.revision) fail('CHANGED','Refresh this product before preparing a new version.')
  const details=p.details===undefined?(prior?.value.draft??prior?.value)?.details:productDetails(p.details)
  const draft={...(details?{details}:{}),sku,name:text(p.name,'Product name'),description:typeof p.description==='string'&&p.description.length<=4000?p.description:fail('INPUT','Description must be at most 4000 characters.',400),unitCents:integer(p.unitCents,'Unit cents',1),active:p.active===true}
  value=prior?{...prior.value,draft}:{...draft,active:false,draft}
 } else {
  requirePerson(actor)
  if(!prior?.value.draft||p.revision!==prior.revision) fail('CHANGED','Approve the exact prepared product revision.')
  if(prior.value.draft.active) {
   const stock=await pierState(env)
   if(!Array.isArray(stock.items)||!stock.items.some((item:any)=>item.sku===sku&&!item.archived)) fail('PIER_SKU','This SKU must exist and be active in Pier before publication.')
  }
  value={...prior.value.draft,approval:approval(actor,prior.revision)}
 }
 const revision=crypto.randomUUID()
 const statement=prior?env.DB.prepare('UPDATE st_products SET value_json=?,revision=? WHERE id=? AND revision=?').bind(JSON.stringify(value),revision,sku,prior.revision):env.DB.prepare('INSERT INTO st_products VALUES(?,?,?)').bind(sku,JSON.stringify(value),revision)
 await commit(env.DB,actor,[statement,changed(env.DB),audit(env.DB,actor,sku,type==='product.prepare'?'product.prepared':'product.published')])
 return {id:sku,value,revision}
}
