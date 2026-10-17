// Run the pinned real Pier implementation. Only Stripe/mail are faked by tests.
import { access, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { installation } from './harness.mjs'
export const pierCommit = '28000f30f84309ef7536ed5b0eaf206b35f60f43'
export async function pierInstallation() {
 const source=resolve('.cache/pier-source')
 try { await access(join(source,'.git')) }
 catch {
  await mkdir('.cache',{recursive:true})
  execFileSync('git',['clone','--no-checkout','https://github.com/just-every/run-pier.git',source],{stdio:'pipe'})
 }
 execFileSync('git',['checkout','--detach',pierCommit],{cwd:source,stdio:'pipe'})
 const entry=resolve('.cache/pier-api-worker.ts')
 await writeFile(entry,`import {pierResponse} from ${JSON.stringify(join(source,'src/pier/api'))}; import {authResponse} from ${JSON.stringify(join(source,'src/auth.server'))}; export default {async fetch(r,e){return await pierResponse(r,e)??await authResponse(r,e)??new Response('Not found',{status:404})}}`)
 const h=await installation({source,entry,base:'/api/pier'})
 const location=await h.command('location.save',{name:'Shelf A1',warehouse:'Brisbane',kind:'bin'})
 const supplier=await h.command('party.save',{name:'Clay and Cotton Supply',kind:'supplier'})
 const customer=await h.command('party.save',{name:'Online shop',kind:'customer'})
 const items=[]
 for(const [sku,name,price] of [['MUG-BLUE','Blue ceramic mug','24.50'],['TOWEL-NAT','Natural linen towel','18.00']]) {
  const item=await h.command('item.save',{sku,name,unit:'each',packSize:'1'})
  const po=await h.command('po.draft',{supplierId:supplier.id,promiseDate:'2026-10-20',reason:'Opening stock',lines:[{itemId:item.id,quantity:'20',price}]})
  await h.command('po.approve',{poId:po.id,version:po.version})
  await h.command('po.commit',{poId:po.id,version:po.version})
  await h.command('receipt.create',{poId:po.id,supplierReference:'Initial delivery '+sku,lines:[{poLineId:po.lines[0].id,locationId:location.id,quantity:'20',cost:price}]})
  items.push(item)
 }
 return Object.assign(h,{customer,items,location,bindings:{PIER_ORIGIN:h.origin,PIER_SESSION:h.cookie,PIER_CUSTOMER_ID:customer.id}})
}
