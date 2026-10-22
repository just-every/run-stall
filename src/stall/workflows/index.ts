import type { Bindings } from '../../auth.server'
import { current } from '../access'
import { Problem } from '../model'
import { body,json } from '../headless/common'
import { workflowCommand } from './commands'
import { customerRequest } from './requests'
import { workflowSnapshot } from './snapshot'
export { workflowCommand } from './commands'
export { workflowSnapshot } from './snapshot'
export { runWorkflows } from './engine'
export { workflowErasureStatements } from './erasure'

export async function workflowResponse(request:Request,env:Bindings):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(path!=='/api/stall/workflows'&&path!=='/api/stall/customer-requests') return null
 try {
  if(path==='/api/stall/customer-requests') {
   if(request.method!=='POST') return json({error:{code:'METHOD',message:'Use POST to request staff review.'}},405)
   return json(await customerRequest(request,env,await body(request)))
  }
  if(!['GET','POST'].includes(request.method)) return json({error:{code:'METHOD',message:'Use GET or POST.'}},405)
  if(request.method==='POST'&&request.headers.get('origin')!==env.AUTH_ORIGIN) return json({error:{code:'ORIGIN',message:'Use this installation’s staff page.'}},403)
  const actor=await current(request,env)
  if(request.method==='GET') return json(await workflowSnapshot(env,actor))
  const p=await body(request)
  return json({result:await workflowCommand(env,actor,p.type,p.payload)})
 } catch(error) {
  if(error instanceof Problem) return json({error:{code:error.code,message:error.message}},error.status)
  return json({error:{code:'CONFLICT',message:'Workflow authority or state changed. Refresh and review the current work.'}},409)
 }
}
