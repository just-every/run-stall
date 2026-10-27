import type { Bindings } from '../../auth.server'
import { current,live } from '../access'
import { fail,Problem,type Actor } from '../model'
import { rawBody } from '../stripe'
import { buildAnalyticsReport } from './report'
import { costState,recordCosts } from './costs'
import { applyHistory,historyState,previewHistory } from './historical'
import type { AnalyticsReport } from './report-model'

const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers})
export function analyticsManager(actor:Actor) {
 if(actor.agent||!['owner','admin'].includes(actor.role)||actor.staffRole)fail('FORBIDDEN','Only a signed-in owner or administrator may inspect analytics.',403)
}
async function input(request:Request) {
 try {const value=JSON.parse(await rawBody(request,2*1024*1024));if(value&&typeof value==='object'&&!Array.isArray(value))return value}catch(error){if(error instanceof Problem)throw error}
 return fail('INPUT','Supply a JSON object.',400)
}
export function analyticsCsvCell(value:unknown):string {
 let text=value===null||value===undefined?'Unknown — not recorded':typeof value==='object'?JSON.stringify(value):String(value)
 if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text))text="'"+text
 return '"'+text.replaceAll('"','""')+'"'
}
export function analyticsCsv(report:AnalyticsReport) {
 const records:Record<string,unknown>[]=[]
 records.push({record:'period',from:report.period.from,to:report.period.to,timeZone:report.period.timeZone,start:report.period.start,endExclusive:report.period.endExclusive,currency:report.currency})
 records.push({record:'totals',...report.totals},{record:'funnel',...report.funnel})
 for(const row of report.channels)records.push({record:'channel',...row})
 for(const row of report.dates)records.push({record:'date',...row})
 for(const [key,value] of Object.entries(report.policy))records.push({record:'policy',dimension:key,value})
 for(const [dimension,rows] of Object.entries(report.traffic))for(const row of rows)records.push({record:'traffic',dimension,...row})
 for(const [dimension,rows] of Object.entries(report.bestSellers))for(const row of rows)records.push({record:'bestseller',dimension,...row})
 for(const row of report.excludedTestOrders)records.push({record:'excluded_test_order',...row})
 for(const row of report.orders) {
  const {lines,...order}=row
  records.push({record:'order',...order})
  for(const line of lines)records.push({record:'line',orderId:order.id,...line})
 }
 const columns=[...new Set(records.flatMap(row=>Object.keys(row)))]
 const body=[columns.map(analyticsCsvCell).join(','),...records.map(row=>columns.map(key=>analyticsCsvCell(row[key])).join(','))].join('\r\n')+'\r\n'
 return new Response(body,{headers:{...headers,'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="stall-analytics.csv"'}})
}
export async function analyticsReportResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname,base='/api/stall/analytics/'
 if(!['report','report.csv','costs','history','history'+'/apply'].some(suffix=>path===base+suffix))return null
 try {
  const actor=await current(request,env);analyticsManager(actor)
  const origin=request.headers.get('origin')
  if((origin&&origin!==env.AUTH_ORIGIN)||request.headers.get('sec-fetch-site')==='cross-site'||(request.method!=='GET'&&origin!==env.AUTH_ORIGIN))fail('ORIGIN','Use this shop’s analytics desk.',403)
  await live(env,actor)
  if((path===base+'report'||path===base+'report.csv')&&request.method==='GET') {
   const report=await buildAnalyticsReport(env.DB,url.searchParams)
   return path.endsWith('.csv')?analyticsCsv(report):json(report)
  }
  if(path===base+'costs'&&request.method==='GET')return json(await costState(env.DB))
  if(path===base+'costs'&&request.method==='POST')return json(await recordCosts(env,actor,await input(request)))
  if(path.startsWith(base+'history')&&actor.role!=='owner')fail('FORBIDDEN','Only the owner may review or import historical sales.',403)
  if(path===base+'history'&&request.method==='GET')return json(await historyState(env.DB))
  if(path===base+'history'&&request.method==='POST')return json(await previewHistory(env,actor,await input(request)))
  if(path===base+'history'+'/apply'&&request.method==='POST')return json(await applyHistory(env,actor,await input(request)))
  return json({error:{code:'METHOD',message:'This analytics endpoint does not accept that method.'}},405)
 }catch(error:any) {
  if(typeof error.status==='number'&&typeof error.code==='string')return json({error:{code:error.code,message:error.message}},error.status)
  return json({error:{code:'ANALYTICS_CONFLICT',message:'Analytics records changed or are unavailable. Refresh the report or review a new historical preview.'}},409)
 }
}
