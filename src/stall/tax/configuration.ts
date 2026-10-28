import type { Bindings } from '../../auth.server'
import { audit,changed,commit,live } from '../access'
import { email,fail,integer,requirePerson,text,type Actor } from '../model'

export type TaxAddress={line1:string;line2?:string;city:string;state:string;postal_code:string;country:'US'}
export type TaxCategory={sku:string;taxCode:string}
export type TaxThreshold={state:string;salesCents:number;transactions:number;warningPercent:number}
export type TaxConfigurationValue={shipFrom:TaxAddress|null;categories:TaxCategory[];thresholds:TaxThreshold[]}
export type TaxConfiguration=TaxConfigurationValue&{revision:string|null}
export type TaxExemption={id:string;revision:string;customerEmail:string;state:string;evidenceReference:string;expiresOn:string;revoked:boolean;reviewedBy:string;reviewedAt:string;restored:boolean}
export type TaxExemptions={exemptions:TaxExemption[];total:number;limit:number;truncated:boolean}
export type SaveTaxConfiguration={revision:string|null;value:TaxConfigurationValue}
export type SaveTaxExemption={id?:string;revision?:string;customerEmail:string;state:string;evidenceReference:string;expiresOn:string;revoked?:boolean;reviewRestored?:boolean}
export const taxStates='AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ')

function owner(actor:Actor) {
 requirePerson(actor)
 if(actor.role!=='owner')fail('FORBIDDEN','Only the owner may configure tax settings and review exemption evidence.',403)
}
function state(value:unknown) {
 const result=text(value,'US state',2).toUpperCase()
 if(!taxStates.includes(result))fail('INPUT','Choose a US state or the District of Columbia.',400)
 return result
}
function address(value:any):TaxAddress|null {
 if(value===null)return null
 if(value?.country!=='US')fail('INPUT','Ship-from must be a US address.',400)
 const postal_code=text(value?.postal_code,'Ship-from ZIP code',10)
 if(!/^\d{5}(?:-\d{4})?$/.test(postal_code))fail('INPUT','Enter a full five-digit or ZIP+4 ship-from ZIP code.',400)
 return {line1:text(value.line1,'Ship-from street',200),...(value.line2?{line2:text(value.line2,'Ship-from address line 2',200)}:{}),city:text(value.city,'Ship-from city',100),state:state(value.state),postal_code,country:'US'}
}
export function configuration(value:any):TaxConfigurationValue {
 if(!Array.isArray(value?.categories)||value.categories.length>1000||!Array.isArray(value?.thresholds)||value.thresholds.length>taxStates.length)fail('INPUT','Provide up to 1,000 SKU tax codes and one threshold per US state.',400)
 const skus=new Set<string>(),states=new Set<string>()
 const categories=value.categories.map((entry:any):TaxCategory=>{
  const sku=text(entry?.sku,'SKU',100),taxCode=text(entry?.taxCode,'Stripe product tax code',20)
  if(skus.has(sku)||!/^txcd_\d{8}$/.test(taxCode))fail('INPUT','Use unique SKUs and an explicit txcd_ product tax code with eight digits.',400)
  skus.add(sku);return {sku,taxCode}
 })
 const thresholds=value.thresholds.map((entry:any):TaxThreshold=>{
  const jurisdiction=state(entry?.state),salesCents=integer(entry?.salesCents,'State sales threshold cents',0,Number.MAX_SAFE_INTEGER),transactions=integer(entry?.transactions,'State transaction threshold',0,100000000),warningPercent=integer(entry?.warningPercent,'Warning percent',1,100)
  if(states.has(jurisdiction)||(!salesCents&&!transactions))fail('INPUT','Use one threshold per state with a positive sales or transaction threshold. Zero disables that measure.',400)
  states.add(jurisdiction);return {state:jurisdiction,salesCents,transactions,warningPercent}
 })
 return {shipFrom:address(value.shipFrom),categories,thresholds}
}
export async function readTaxConfiguration(env:Bindings):Promise<TaxConfiguration> {
 const row=await env.DB.prepare('SELECT revision,value_json FROM st_tax_configuration WHERE id=1').first<{revision:string;value_json:string}>()
 return row?{...JSON.parse(row.value_json),revision:row.revision}:{revision:null,shipFrom:null,categories:[],thresholds:[]}
}
export async function saveTaxConfiguration(env:Bindings,actor:Actor,p:SaveTaxConfiguration):Promise<TaxConfiguration> {
 owner(actor);await live(env,actor)
 const previous=await readTaxConfiguration(env)
 if((p?.revision??null)!==previous.revision)fail('CHANGED','Tax settings changed elsewhere. Review the current settings before replacing them.')
 const value=configuration(p?.value),revision=crypto.randomUUID(),db=env.DB
 const write=previous.revision?db.prepare('UPDATE st_tax_configuration SET revision=?,value_json=? WHERE id=1 AND revision=?').bind(revision,JSON.stringify(value),previous.revision):db.prepare('INSERT OR IGNORE INTO st_tax_configuration(id,revision,value_json) VALUES(1,?,?)').bind(revision,JSON.stringify(value))
 await commit(db,actor,[write,changed(db),audit(db,actor,'shop','tax.configuration-saved')])
 return {...value,revision}
}
type ExemptionRow={id:string;revision:string;customer_email:string;state:string;evidence_reference:string;expires_on:string;revoked:number;reviewed_by:string;reviewed_at:string;restored:number}
const exemption=(row:ExemptionRow):TaxExemption=>({id:row.id,revision:row.revision,customerEmail:row.customer_email,state:row.state,evidenceReference:row.evidence_reference,expiresOn:row.expires_on,revoked:!!row.revoked,reviewedBy:row.reviewed_by,reviewedAt:row.reviewed_at,restored:!!row.restored})
export async function readTaxExemptions(env:Bindings):Promise<TaxExemptions> {
 const limit=200,[found,count]=await Promise.all([env.DB.prepare('SELECT * FROM st_tax_exemptions ORDER BY reviewed_at DESC,id LIMIT ?').bind(limit).all<ExemptionRow>(),env.DB.prepare('SELECT count(*) AS total FROM st_tax_exemptions').first<{total:number}>()])
 const total=count!.total
 return {exemptions:found.results.map(exemption),total,limit,truncated:total>limit}
}
export async function saveTaxExemption(env:Bindings,actor:Actor,p:SaveTaxExemption):Promise<TaxExemption> {
 owner(actor);await live(env,actor)
 if(!p||typeof p!=='object')fail('INPUT','Provide the customer, state, evidence reference and expiration date.',400)
 const id=p?.id===undefined?crypto.randomUUID():text(p.id,'Exemption evidence ID',100),db=env.DB
 const prior=await db.prepare('SELECT * FROM st_tax_exemptions WHERE id=?').bind(id).first<ExemptionRow>()
 if(p.id===undefined?p.revision!==undefined:!prior||p.revision!==prior.revision)fail('CHANGED','Exemption evidence changed or is missing. Review its current revision before updating it.')
 const expiresOn=text(p.expiresOn,'Evidence expiration date',10)
 if(!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)||!Number.isFinite(Date.parse(expiresOn))||new Date(expiresOn).toISOString().slice(0,10)!==expiresOn)fail('INPUT','Enter a real expiration date as YYYY-MM-DD.',400)
 if(p.revoked!==undefined&&typeof p.revoked!=='boolean')fail('INPUT','Revoked must be true or false.',400)
 if(p.reviewRestored!==undefined&&typeof p.reviewRestored!=='boolean')fail('INPUT','Restored evidence review must be true or false.',400)
 if(p.reviewRestored&&!prior?.restored)fail('CHANGED','Only a current restored record can receive a fresh local review. Review the current evidence revision.')
 const value:TaxExemption={id,revision:crypto.randomUUID(),customerEmail:email(p.customerEmail),state:state(p.state),evidenceReference:text(p.evidenceReference,'Evidence reference or document name',300),expiresOn,revoked:p.revoked??!!prior?.revoked,reviewedBy:actor.id,reviewedAt:new Date().toISOString(),restored:!!prior?.restored&&p.reviewRestored!==true}
 const params=[value.revision,value.customerEmail,value.state,value.evidenceReference,value.expiresOn,value.revoked?1:0,value.reviewedBy,value.reviewedAt,value.restored?1:0]
 const write=prior?db.prepare('UPDATE st_tax_exemptions SET revision=?,customer_email=?,state=?,evidence_reference=?,expires_on=?,revoked=?,reviewed_by=?,reviewed_at=?,restored=? WHERE id=? AND revision=?').bind(...params,id,prior.revision):db.prepare('INSERT INTO st_tax_exemptions(revision,customer_email,state,evidence_reference,expires_on,revoked,reviewed_by,reviewed_at,restored,id) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(...params,id)
 await commit(db,actor,[write,changed(db),audit(db,actor,id,prior?'tax.exemption-evidence-reviewed':'tax.exemption-evidence-recorded')])
 return value
}
