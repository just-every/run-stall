import { generateCodes,promotionCodes } from './codes'
import { campaignReport } from './report'
import type { Bindings } from '../../auth.server'
import { operatorAuth } from '../../auth.server'
import { current } from '../access'
import { fail } from '../model'
import { body,json } from '../headless/common'
import { promotionList,revokePromotion,savePromotion } from './management'
import { promotionReport } from './report'
import { promotionQuote } from './eligibility'

export async function promotionRoutes(request:Request,env:Bindings,path=new URL(request.url).pathname):Promise<Response|null> {
 if(!['/api/stall/promotions','/api/stall/promotions/revoke','/api/stall/promotions/quote','/api/stall/promotions/report','/api/stall/promotions/campaign-report','/api/stall/promotions/codes'].includes(path)) return null
 if((request.method!=='GET'||request.headers.has('origin'))&&request.headers.get('origin')!==env.AUTH_ORIGIN) fail('ORIGIN','Use this installation’s own page for promotions.',403)
 if(path==='/api/stall/promotions/quote'&&request.method==='POST') return json(await promotionQuote(env,await body(request),(await operatorAuth(env).getSession(request))?.operator.email.toLowerCase()))
 const actor=await current(request,env)
 if(path==='/api/stall/promotions/codes')return json(request.method==='GET'?await promotionCodes(env,actor,new URL(request.url).searchParams):await generateCodes(env,actor,await body(request)))
 if(path==='/api/stall/promotions/campaign-report'&&request.method==='GET')return json(await campaignReport(env,actor))
 if(path==='/api/stall/promotions/report'&&request.method==='GET') return json(await promotionReport(env,actor,new URL(request.url).searchParams))
 if(path==='/api/stall/promotions'&&request.method==='GET') return json(await promotionList(env,actor))
 if(path==='/api/stall/promotions'&&request.method==='POST') return json(await savePromotion(env,actor,await body(request)))
 if(path==='/api/stall/promotions/revoke'&&request.method==='POST') return json(await revokePromotion(env,actor,await body(request)))
 fail('NOT_FOUND','Unknown promotion endpoint.',404)
}
