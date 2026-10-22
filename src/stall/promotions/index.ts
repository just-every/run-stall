import type { Bindings } from '../../auth.server'
import { current } from '../access'
import { fail } from '../model'
import { body,json } from '../headless/common'
import { promotionList,revokePromotion,savePromotion } from './management'
import { promotionQuote } from './eligibility'

export async function promotionRoutes(request:Request,env:Bindings,path=new URL(request.url).pathname):Promise<Response|null> {
 if(!['/api/stall/promotions','/api/stall/promotions/revoke','/api/stall/promotions/quote'].includes(path)) return null
 if(request.headers.get('origin')!==env.AUTH_ORIGIN) fail('ORIGIN','Use this installation’s own page for promotions.',403)
 if(path==='/api/stall/promotions/quote'&&request.method==='POST') return json(await promotionQuote(env,await body(request)))
 const actor=await current(request,env)
 if(path==='/api/stall/promotions'&&request.method==='GET') return json(await promotionList(env,actor))
 if(path==='/api/stall/promotions'&&request.method==='POST') return json(await savePromotion(env,actor,await body(request)))
 if(path==='/api/stall/promotions/revoke'&&request.method==='POST') return json(await revokePromotion(env,actor,await body(request)))
 fail('NOT_FOUND','Unknown promotion endpoint.',404)
}
