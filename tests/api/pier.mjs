// Run real Pier with a real scoped Stall key; replace external network edges only.
import { access, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { installation } from './harness.mjs'
export const pierCommit = '7e60271bb15a905ff07acc56ff99f2a18c1c3ae0'
export async function pierInstallation() {
 const source=resolve(process.env.PIER_SOURCE??'.cache/pier-source')
 if(!process.env.PIER_SOURCE) {
  try { await access(join(source,'.git')) }
  catch {
   await mkdir('.cache',{recursive:true})
   execFileSync('git',['clone','--no-checkout','https://github.com/just-every/run-pier.git',source],{stdio:'pipe'})
  }
  execFileSync('git',['checkout','--detach',pierCommit],{cwd:source,stdio:'pipe'})
 }
 await mkdir('.cache',{recursive:true})
 const entry=resolve('.cache/pier-api-worker.ts')
 await writeFile(entry,`import {pierResponse} from ${JSON.stringify(join(source,'src/pier/api'))}; import {authResponse} from ${JSON.stringify(join(source,'src/auth.server'))}; export default {async fetch(r,e){return await pierResponse(r,e)??await authResponse(r,e)??new Response('Not found',{status:404})}}`)
 // The shop is not started yet. Its outbound connector names that network
 // unavailability; all inbound stock/dispatch/payment calls use the real Pier.
 const h=await installation({source,entry,base:'/api/pier',outboundService:async()=>new Response('Shop not connected yet',{status:503})})
 try {
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
 const channel=await h.command('channel.save',{name:'Online shop',provider:'stall',baseUrl:'https://shop.example.test',warehouse:'Brisbane',buffer:'0',credentials:{token:'test-shop-network-edge'}})
 const current=(await h.api('/api/pier/state')).channels.find(ch=>ch.id===channel.id)
 const link=await h.command('channel.stallKey',{channelId:current.id,version:current.version,customerId:customer.id})
 return Object.assign(h,{customer,items,location,channelId:channel.id,bindings:{PIER_ORIGIN:h.origin,PIER_SESSION:`pier_channel=${link.key}`,PIER_CUSTOMER_ID:customer.id}})
 }catch(error){await h.close();throw error}
}
