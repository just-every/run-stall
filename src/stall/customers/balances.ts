import type { Bindings } from '../../auth.server'
import { audit,changed,commit,current,digest,live } from '../access'
import { email,fail,integer,Problem,text,type Actor } from '../model'
import { rawBody } from '../stripe'
import { customerActor,customerCommit,requireProvenEmail } from './account'
import { directoryAuthority } from './directory'

type BalanceAccount={id:string;email:string|null;revision:string;erased_at:string|null}
type BalanceCommand={commandId:string;type:'issue'|'adjust';email:string;kind:'gift'|'credit';amountCents:number;currency:'usd';revision:string;reason:string;confirmed:true}
const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}})
const accountFor=(db:D1Database,address:string)=>db.prepare('SELECT id,email,revision,erased_at FROM st_customer_balance_accounts WHERE email=?').bind(address).first<BalanceAccount>()

async function balances(db:D1Database,address:string) {
 const account=await accountFor(db,address)
 const ledger=account?(await db.prepare(`SELECT l.id,l.command_id AS commandId,l.kind,l.action,l.amount_cents AS amountCents,l.currency,l.created_at AS createdAt,d.reason FROM st_customer_balance_ledger l LEFT JOIN st_customer_balance_details d ON d.entry_id=l.id WHERE l.account_id=? ORDER BY l.created_at,l.id`).bind(account.id).all<{id:string;commandId:string;kind:'gift'|'credit';action:'issue'|'adjust';amountCents:number;currency:string;createdAt:string;reason:string|null}>()).results:[]
 return {email:address,currency:'usd' as const,revision:account?.revision??'initial',giftCents:ledger.filter(r=>r.kind==='gift').reduce((n,r)=>n+r.amountCents,0),creditCents:ledger.filter(r=>r.kind==='credit').reduce((n,r)=>n+r.amountCents,0),ledger,redemption:'not_available' as const}
}

/** Only a separately proven native mailbox may read its balance journal. */
export async function ownBalances(env:Bindings,a:Actor) {
 if(a.agent||!a.sessionId)fail('CUSTOMER_AUTH','Use your independently verified native customer session.',401)
 await requireProvenEmail(env,a.sessionId,a.id)
 const value=await balances(env.DB,email(a.email))
 await customerCommit(env,a)
 return value
}

function command(p:any):BalanceCommand {
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['commandId','type','email','kind','amountCents','currency','revision','reason','confirmed'].includes(k)))fail('INPUT','Supply only the reviewed balance command.',400)
 if(!['issue','adjust'].includes(p.type)||!['gift','credit'].includes(p.kind)||p.currency!=='usd')fail('INPUT','Choose an issue or adjustment for a USD gift balance or goodwill credit.',400)
 if(p.confirmed!==true)fail('CONFIRM','Explicitly approve the reviewed mailbox, exact cents and reason.',400)
 const commandId=text(p.commandId,'Original command ID',100)
 if(!/^[a-zA-Z0-9_-]{8,100}$/.test(commandId))fail('INPUT','Use a durable original command ID.',400)
 return {commandId,type:p.type,email:email(p.email),kind:p.kind,amountCents:integer(p.amountCents,'Amount cents',p.type==='issue'?1:-100000000,p.type==='issue'?100000000:-1),currency:'usd',revision:text(p.revision,'Reviewed balance revision',100),reason:text(p.reason,'Customer-visible reason',1000),confirmed:true}
}

async function receipt(db:D1Database,p:BalanceCommand,hash:string) {
 const found=await db.prepare(`SELECT l.id,d.request_hash AS requestHash,a.email,a.erased_at AS erasedAt FROM st_customer_balance_ledger l JOIN st_customer_balance_accounts a ON a.id=l.account_id LEFT JOIN st_customer_balance_details d ON d.entry_id=l.id WHERE l.command_id=?`).bind(p.commandId).first<{id:string;requestHash:string|null;email:string|null;erasedAt:string|null}>()
 if(!found)return null
 if(found.erasedAt||found.email!==p.email||found.requestHash!==hash)fail('COMMAND_REUSED','This original command was already used for different or erased balance records. No value was issued.')
 return {commandId:p.commandId,entryId:found.id,replayed:true}
}

/** Native owner approval is fenced again with the ledger write transaction. */
export async function balanceCommand(env:Bindings,a:Actor,payload:unknown) {
 directoryAuthority(a,true)
 const p=command(payload),hash=await digest(JSON.stringify(p)),prior=await receipt(env.DB,p,hash)
 if(prior){await live(env,a);return {...await balances(env.DB,p.email),receipt:prior}}
 const before=await balances(env.DB,p.email)
 if(before.revision!==p.revision)fail('BALANCE_CHANGED','The balance changed. Refresh and review the exact amount again.')
 const total=(p.kind==='gift'?before.giftCents:before.creditCents)+p.amountCents
 if(total<0||total>100000000)fail('BALANCE_AMOUNT','An adjustment must leave a nonnegative balance within the supported cents range.',400)
 const existing=await accountFor(env.DB,p.email),accountId=existing?.id??crypto.randomUUID(),entryId=crypto.randomUUID(),revision=crypto.randomUUID(),at=new Date().toISOString()
 const statements:D1PreparedStatement[]=[]
 if(!existing)statements.push(env.DB.prepare("INSERT INTO st_customer_balance_accounts(id,email,revision,created_at,erased_at) VALUES(?,?,'initial',?,NULL)").bind(accountId,p.email,at))
 statements.push(
  env.DB.prepare('UPDATE st_customer_balance_accounts SET revision=? WHERE id=? AND email=? AND revision=? AND erased_at IS NULL').bind(revision,accountId,p.email,p.revision),changed(env.DB),
  env.DB.prepare('INSERT INTO st_customer_balance_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(entryId,accountId,p.commandId,p.kind,p.type,p.amountCents,'usd',p.revision,revision,a.id,at),
  env.DB.prepare('INSERT INTO st_customer_balance_details VALUES(?,?,?)').bind(entryId,hash,p.reason),
  audit(env.DB,a,entryId,p.type==='issue'?'customer.balance-issued':'customer.balance-adjusted')
 )
 try{await commit(env.DB,a,statements)}catch(error){
  // A racing replay is harmless; a racing revision must return for review.
  await live(env,a)
  const replay=await receipt(env.DB,p,hash)
  if(replay)return {...await balances(env.DB,p.email),receipt:replay}
  if(((await accountFor(env.DB,p.email))?.revision??'initial')!==p.revision)fail('BALANCE_CHANGED','The balance changed. Refresh and review the exact amount again.')
  throw error
 }
 return {...await balances(env.DB,p.email),receipt:{commandId:p.commandId,entryId,replayed:false}}
}

async function input(request:Request) {
 try{const p=JSON.parse(await rawBody(request,12000));if(!p||typeof p!=='object'||Array.isArray(p))fail('INPUT','Supply a JSON object.',400);return p}catch(error){if(error instanceof Problem)throw error;return fail('INPUT','Supply a valid JSON object.',400)}
}

/** Run before the general account handler. No route accepts bearer authority. */
export async function balanceResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),own=url.pathname==='/api/stall/account/balances'
 if(!own&&url.pathname!=='/api/stall/customer-balances')return null
 const origin=request.headers.get('origin')
 if((origin&&origin!==env.AUTH_ORIGIN)||(request.method!=='GET'&&origin!==env.AUTH_ORIGIN))fail('ORIGIN','Use this shop’s balance controls.',403)
 if(own){const a=await customerActor(request,env);if(request.method!=='GET')fail('METHOD','Balances are read-only in the customer account.',405);if(url.search)fail('INPUT','Your verified mailbox determines balance access.',400);return json(await ownBalances(env,a))}
 const a=await current(request,env);directoryAuthority(a,true)
 if(request.method==='GET'){
  if([...url.searchParams.keys()].some(k=>k!=='email')||url.searchParams.getAll('email').length!==1)fail('INPUT','Choose one exact customer mailbox.',400)
  const value=await balances(env.DB,email(url.searchParams.get('email')));await live(env,a);return json(value)
 }
 if(request.method==='POST')return json(await balanceCommand(env,a,await input(request)))
 return fail('METHOD','Use the supported balance controls.',405)
}

/** Retain opaque financial history; remove mailbox and customer-visible reasons.
 * Rotating custody fences an already-reviewed command racing with erasure. */
export function balanceErasureStatements(db:D1Database,address:string):D1PreparedStatement[] {
 const normalized=email(address)
 return [db.prepare('DELETE FROM st_customer_balance_details WHERE entry_id IN(SELECT l.id FROM st_customer_balance_ledger l JOIN st_customer_balance_accounts a ON a.id=l.account_id WHERE a.email=?)').bind(normalized),db.prepare('UPDATE st_customer_balance_accounts SET email=NULL,erased_at=?,revision=? WHERE email=?').bind(new Date().toISOString(),crypto.randomUUID(),normalized)]
}

export async function balanceBusinessRecords(db:D1Database) {
 const [accounts,ledger,details]=await Promise.all([db.prepare('SELECT * FROM st_customer_balance_accounts ORDER BY id').all(),db.prepare('SELECT * FROM st_customer_balance_ledger ORDER BY created_at,id').all(),db.prepare('SELECT * FROM st_customer_balance_details ORDER BY entry_id').all()])
 return {accounts:accounts.results,ledger:ledger.results,details:details.results,currency:'usd',redemption:'not_available'}
}
