import { historyBusinessRecords } from './order-history'
import type { Bindings } from '../../auth.server'
import { audit,changed,commit,digest,live } from '../access'
import { authorize } from '../permissions'
import { email,fail,integer,requirePerson,text,type Actor } from '../model'
import { orders } from '../store'
export type Profile={name:string;tags:string[];notes:{id:string;text:string;by:string;at:string}[]}
const optional=(value:unknown,label:string,max:number)=>value===undefined||value===''?'':text(value,label,max)
function tags(value:any) {if(!Array.isArray(value)||value.length>50)fail('INPUT','Use at most 50 customer tags.',400);return [...new Set(value.map(v=>text(v,'Tag',40)))]}
export function directoryAuthority(a:Actor,owner=false) {requirePerson(a);authorize(a,'support');if(owner&&!['owner','admin'].includes(a.role))fail('FORBIDDEN','Only an owner or administrator may import, merge or manage customer addresses.',403)}
async function profile(env:Bindings,id:string) {
 const r=await env.DB.prepare('SELECT * FROM st_customers WHERE id=?').bind(id).first<any>()
 if(!r)fail('NOT_FOUND','Customer not found.',404)
 return {...r,value:JSON.parse(r.value_json) as Profile}
}
export async function directory(env:Bindings,a:Actor) {
 directoryAuthority(a)
 const result=await directoryRecords(env,['owner','admin'].includes(a.role));await live(env,a);return result
}
async function directoryRecords(env:Bindings,includeAddresses=false) {
 const [profiles,emails,history,addresses,segments]=await Promise.all([env.DB.prepare('SELECT * FROM st_customers ORDER BY created_at,id').all<any>(),env.DB.prepare('SELECT email,customer_id FROM st_customer_emails ORDER BY email').all<any>(),orders(env.DB),env.DB.prepare('SELECT id,email,revision,value_json FROM st_customer_addresses ORDER BY id').all<any>(),env.DB.prepare('SELECT id,revision,value_json FROM st_customer_segments ORDER BY id').all<any>()])
 const imported=await historyBusinessRecords(env.DB)
 const customers=profiles.results.map(r=>{
  const value=JSON.parse(r.value_json) as Profile,mailboxes=emails.results.filter(e=>e.customer_id===r.id).map(e=>e.email),purchases=history.filter(o=>!o.erasedAt&&o.customerEmail&&mailboxes.includes(o.customerEmail.toLowerCase())&&o.payment)
  const past=imported.filter(row=>row.email&&mailboxes.includes(row.email)&&row.value.paid).map(row=>row.value)
  const allPaid=[...purchases,...past]
  const paidCents=allPaid.reduce((sum,o)=>sum+o.totalCents,0),refundedCents=allPaid.reduce((sum,o)=>sum+o.refunds.filter(f=>f.status==='succeeded').reduce((n,f)=>n+f.amountCents,0),0)
  const states=[...new Set([...allPaid.map(o=>o.shippingDetails?.address.state),...addresses.results.filter(a=>mailboxes.includes(a.email)).map(a=>JSON.parse(a.value_json).state)].filter(Boolean))]
  const book=addresses.results.filter(address=>mailboxes.includes(address.email)).map(({value_json,...address})=>({...address,address:JSON.parse(value_json)}))
  return {id:r.id,revision:r.revision,...value,emails:mailboxes,orderCount:allPaid.length,paidCents,refundedCents,lifetimeValueCents:paidCents-refundedCents,states,...(includeAddresses?{addresses:book}:{})}
 })
 const saved=segments.results.map(({value_json,...s})=>{const value=JSON.parse(value_json);return {...s,value,members:customers.filter(c=>(!value.tag||c.tags.includes(value.tag))&&c.lifetimeValueCents>=value.minimumSpentCents&&c.orderCount>=value.minimumOrders&&(!value.state||c.states.includes(value.state))).map(c=>c.id)}})
 return {customers,segments:saved,currency:'usd',orderCountBasis:'paid_orders',lifetimeValueBasis:'paid_total_less_succeeded_refunds',ownership:'Only the independently verified mailbox grants customer order access; directory merges grant none.'}
}
function importRows(p:any) {
 if(!Array.isArray(p.rows)||!p.rows.length||p.rows.length>200)fail('INPUT','Import 1 to 200 customer rows.',400)
 return p.rows.map((r:any)=>({email:email(r.email),name:optional(r.name,'Name',200),tags:tags(r.tags??[])})) as {email:string;name:string;tags:string[]}[]
}
export async function preview(env:Bindings,a:Actor,p:any) {
 directoryAuthority(a,true)
 const rows=importRows(p),existing=(await env.DB.prepare('SELECT email,customer_id FROM st_customer_emails ORDER BY email').all<any>()).results
 const revisions=(await env.DB.prepare('SELECT id,revision FROM st_customers ORDER BY id').all()).results
 const seen=new Set<string>(),result=rows.map((row,index)=>{const known=existing.find(e=>e.email===row.email);const duplicate=seen.has(row.email)||!!known;seen.add(row.email);return {row:index,...row,status:duplicate?'duplicate':'new',...(known?{customerId:known.customer_id}:{})}})
 await live(env,a)
 return {rows:result,fingerprint:await digest(JSON.stringify({rows,existing,revisions})),newCount:result.filter(r=>r.status==='new').length,duplicateCount:result.filter(r=>r.status==='duplicate').length}
}
export async function importCustomers(env:Bindings,a:Actor,p:any) {
 const checked=await preview(env,a,p)
 if(p.fingerprint!==checked.fingerprint)fail('REVIEW_CHANGED','Customer import changed. Preview it again; nothing was imported.')
 const stamp=new Date().toISOString(),statements:D1PreparedStatement[]=[]
 // Preview state is transaction-fenced. Concurrent imports cannot silently
 // overwrite a reviewed duplicate or attach an email to another profile.
 statements.push(env.DB.prepare('INSERT INTO st_guard(value) SELECT CASE WHEN (SELECT COUNT(*) FROM st_customer_emails)=? THEN 1 ELSE 0 END').bind((await env.DB.prepare('SELECT COUNT(*) AS n FROM st_customer_emails').first<{n:number}>())!.n))
 for(const r of checked.rows.filter(r=>r.status==='new')) {
  const id=crypto.randomUUID()
  statements.push(env.DB.prepare('INSERT INTO st_customers VALUES(?,?,?,?)').bind(id,crypto.randomUUID(),JSON.stringify({name:r.name,tags:r.tags,notes:[]}),stamp),env.DB.prepare('INSERT INTO st_customer_emails VALUES(?,?)').bind(r.email,id),audit(env.DB,a,id,'customer.imported'))
 }
 await commit(env.DB,a,statements)
 return {imported:checked.newCount,duplicates:checked.duplicateCount,...await directory(env,a)}
}
export async function customerCommand(env:Bindings,a:Actor,p:any) {
 directoryAuthority(a)
 const type=text(p.type,'Customer action',40)
 if(type==='segment.save') {
  const v=p.segment??{},value={name:text(v.name,'Segment name',100),tag:optional(v.tag,'Tag',40),minimumSpentCents:integer(v.minimumSpentCents??0,'Minimum spent cents',0),minimumOrders:integer(v.minimumOrders??0,'Minimum orders',0,1000000),state:optional(v.state,'State',2).toUpperCase()},id=p.id?text(p.id,'Segment ID',100):crypto.randomUUID(),revision=crypto.randomUUID()
  if(value.state&&!/^[A-Z]{2}$/.test(value.state))fail('INPUT','Use a two-letter state/province.',400)
  const statement=p.id?env.DB.prepare('UPDATE st_customer_segments SET value_json=?,revision=? WHERE id=? AND revision=?').bind(JSON.stringify(value),revision,id,p.revision??''):env.DB.prepare('INSERT INTO st_customer_segments VALUES(?,?,?)').bind(id,revision,JSON.stringify(value))
  await commit(env.DB,a,[statement,changed(env.DB),audit(env.DB,a,id,'customer.segment-saved')]);return directory(env,a)
 }
 const id=text(p.id,'Customer ID',100),row=await profile(env,id)
 if(row.revision!==p.revision)fail('REVIEW_CHANGED','Customer changed. Refresh before saving.')
 if(type==='merge') {
  directoryAuthority(a,true)
  const target=await profile(env,text(p.targetId,'Target customer ID',100))
  if(target.id===id||target.revision!==p.targetRevision)fail('REVIEW_CHANGED','Choose two current distinct customer records.')
  const value={...target.value,tags:[...new Set([...target.value.tags,...row.value.tags])],notes:[...target.value.notes,...row.value.notes]}
  if(value.tags.length>50||value.notes.length>200)fail('INPUT','Resolve excess tags/notes before merging.',400)
  await commit(env.DB,a,[env.DB.prepare('UPDATE st_customers SET value_json=?,revision=? WHERE id=? AND revision=?').bind(JSON.stringify(value),crypto.randomUUID(),target.id,target.revision),changed(env.DB),env.DB.prepare('UPDATE st_customer_emails SET customer_id=? WHERE customer_id=?').bind(target.id,id),env.DB.prepare('DELETE FROM st_customers WHERE id=? AND revision=?').bind(id,row.revision),changed(env.DB),audit(env.DB,a,target.id,'customer.directory-merged')]);return directory(env,a)
 }
 const value={...row.value}
 if(type==='profile.save') {value.name=optional(p.name,'Name',200);value.tags=tags(p.tags??[])}
 else if(type==='note.add') {if(value.notes.length>=200)fail('LIMIT','This customer has 200 retained notes.');value.notes=[...value.notes,{id:crypto.randomUUID(),text:text(p.text,'Note',2000),by:a.id,at:new Date().toISOString()}]}
 else fail('INPUT','Choose profile.save, note.add, merge or segment.save.',400)
 await commit(env.DB,a,[env.DB.prepare('UPDATE st_customers SET value_json=?,revision=? WHERE id=? AND revision=?').bind(JSON.stringify(value),crypto.randomUUID(),id,row.revision),changed(env.DB),audit(env.DB,a,id,'customer.'+type)])
 return directory(env,a)
}

/** Internal eligibility data; public callers still pass the directory authority gate. */
export async function inPromotionSegment(env:Bindings,address:string,ids:string[]) {
 const data=await directoryRecords(env),customer=data.customers.find(c=>c.emails.includes(address))
 return !!customer&&data.segments.some(s=>ids.includes(s.id)&&s.members.includes(customer.id))
}
