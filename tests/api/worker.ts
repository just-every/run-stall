import { stallResponse } from '../../src/stall/api'
import { toolsResponse } from '../../src/stall/tools'
import { authResponse } from '../../src/auth.server'
export default {async fetch(request:Request,env:any){return await toolsResponse(request,env) ?? await stallResponse(request,env) ?? await authResponse(request,env) ?? new Response('Not found',{status:404})}}
