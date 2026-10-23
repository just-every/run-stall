import type { Bindings } from '../../auth.server'
import { current,live } from '../access'
import { fail,Problem } from '../model'
import { rawBody } from '../stripe'
import { account,customerActor,customerOrder,ownOrder,saveAddress } from './account'
import { directory,importCustomers,preview,customerCommand,directoryAuthority } from './directory'
const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}})
async function input(request:Request) {try{const p=JSON.parse(await rawBody(request,100000));if(!p||typeof p!=='object'||Array.isArray(p))fail('INPUT','Supply a JSON object.',400);return p}catch(error){if(error instanceof Problem)throw error;return fail('INPUT','Invalid JSON.',400)}}
export async function customerResponse(request:Request,env:Bindings):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(path==='/api/stall/account'||path.startsWith('/api/stall/account/')) {
  const actor=await customerActor(request,env)
  if(path==='/api/stall/account'&&request.method==='GET')return json(await account(env,actor))
  if(path.startsWith('/api/stall/account/orders/')&&request.method==='GET')return json({order:customerOrder(await ownOrder(env,actor,decodeURIComponent(path.slice('/api/stall/account/orders/'.length))))})
  if(path==='/api/stall/account/addresses'&&['POST','DELETE'].includes(request.method))return json(await saveAddress(env,actor,await input(request),request.method==='DELETE'))
  return fail('NOT_FOUND','Unknown customer account door.',404)
 }
 if(path==='/api/stall/customers'||path.startsWith('/api/stall/customers/')) {
  const actor=await current(request,env);directoryAuthority(actor)
  if(request.method!=='GET'&&request.headers.get('origin')!==env.AUTH_ORIGIN)fail('ORIGIN','Use this installation’s customer desk.',403)
  await live(env,actor)
  if(path==='/api/stall/customers'&&request.method==='GET')return json(await directory(env,actor))
  if(path==='/api/stall/customers/import/preview'&&request.method==='POST')return json(await preview(env,actor,await input(request)))
  if(path==='/api/stall/customers/import/apply'&&request.method==='POST')return json(await importCustomers(env,actor,await input(request)))
  if(path==='/api/stall/customers'&&request.method==='POST')return json(await customerCommand(env,actor,await input(request)))
  return fail('NOT_FOUND','Unknown customer directory door.',404)
 }
 return null
}
export function customerErasureStatements(db:D1Database,email:string) {
 return [
  db.prepare('DELETE FROM st_customer_addresses WHERE email=?').bind(email),
  db.prepare(`UPDATE st_customers SET value_json='{"name":"","tags":[],"notes":[]}',revision=lower(hex(randomblob(16))) WHERE id IN(SELECT customer_id FROM st_customer_emails WHERE email=?)`).bind(email),
  db.prepare('DELETE FROM st_customer_emails WHERE email=?').bind(email),
  db.prepare('DELETE FROM st_customers WHERE NOT EXISTS(SELECT 1 FROM st_customer_emails e WHERE e.customer_id=st_customers.id)'),
 ]
}
export async function customerBusinessRecords(db:D1Database) {
 const [profiles,emails,addresses,segments]=await Promise.all([db.prepare('SELECT id,revision,value_json,created_at AS createdAt FROM st_customers ORDER BY id').all<any>(),db.prepare('SELECT email,customer_id AS customerId FROM st_customer_emails ORDER BY email').all(),db.prepare('SELECT id,email,revision,value_json,created_at AS createdAt FROM st_customer_addresses ORDER BY id').all<any>(),db.prepare('SELECT id,revision,value_json FROM st_customer_segments ORDER BY id').all<any>()])
 const records=(rows:any[])=>rows.map(({value_json,...r})=>({...r,value:JSON.parse(value_json)}))
 return {profiles:records(profiles.results),emails:emails.results,addresses:records(addresses.results),segments:records(segments.results)}
}
