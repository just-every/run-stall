import { createAgentDoor, operatorAuthPeople, type Trust } from '../../modules/agent-door/index.ts'
import { createBusinessSettings } from '../../modules/business-settings/index.ts'
import { operatorAuth, runtimeBindings, authConfig, type Bindings } from '../../auth.server'
import { withConnections } from '../connections'
import { digest } from '../access'
import { draftTools } from './draft-tools'
import { readTools } from './read-tools'
import { agentDocs } from './docs'

export const capabilities = ['tools','policy','pause','audit','idempotency'] as const
const scopes = ['catalog:read','catalog:write','orders:read','orders:write','audit:read']
const notTools = [
 {clauses:['MOBILE-001'],reason:'screen'}, {clauses:['MOBILE-002'],reason:'device'},
 {clauses:['BOUNDARY-001'],reason:'connector'}, {clauses:['MIGRATE-001'],reason:'import-door'},
 {clauses:['OPS-001','OPS-002'],reason:'installation'},
] as const
function trust(env: Bindings): Trust | null {
 const issuer=env.RER_OWNER_CLAIM_ISSUER, installationId=env.RER_OWNER_CLAIM_INSTALLATION_ID, publicKeys=env.RER_OWNER_CLAIM_PUBLIC_KEYS
 if (![issuer,installationId,publicKeys].some(Boolean)) return null
 if (!issuer || !installationId || !publicKeys) throw new Error('Incomplete agent door trust configuration')
 return {issuer,installationId,appOrigin:env.AUTH_ORIGIN,publicKeys:JSON.parse(publicKeys)}
}

export async function stallAgentDoor(original: Bindings) {
 const env=await withConnections(runtimeBindings(original)), auth=operatorAuth(env)
 const pairing=trust(env)
 const people=operatorAuthPeople({db:env.DB,allowList:authConfig(env).allowList,session:request=>auth.getSession(request)})
 // The synchronous page-role hook uses this request's signed roster snapshot.
 // Native promotion alone must never turn into a Business editor role.
 const roles=new Map<string,'owner'|'editor'>()
 if (pairing) {
  const owner=await env.DB.prepare(`SELECT o.id FROM oa_operators o LEFT JOIN oa_bootstrap b ON b.claim_id=o.id
   WHERE o.role='owner' ORDER BY b.claim_id IS NULL,o.created_at,o.id LIMIT 1`).first<{id:string}>()
  const settings=await env.DB.prepare('SELECT owner_id FROM bs_settings WHERE singleton=1 AND stopped=0').first<{owner_id:string|null}>()
  if (owner && settings?.owner_id) roles.set(owner.id,'owner')
  const team=await env.DB.prepare("SELECT operator_id,business_role FROM bs_team WHERE business_id IS NOT NULL AND state<>'conflict'").all<{operator_id:string;business_role:string}>()
  for (const row of team.results) if (row.business_role==='admin') roles.set(row.operator_id,'editor')
 }
 const eligible = async (id: string) => {
  const person=await people.person(id)
  return person?.active && ['owner','admin'].includes(person.role) ? person : null
 }
 return createAgentDoor({
  seed:'stall',name:'Stall',specialist:'shop operator',db:env.DB,origin:env.AUTH_ORIGIN,trust:pairing,capabilities,
  tools:[...draftTools(env),...readTools(env)],resources:[],notTools:notTools.map(item=>({...item,clauses:[...item.clauses]})),
  people:{...people,person:eligible,businessRole:person=>pairing?roles.get(person.id)??null:person.role==='owner'?'owner':person.role==='admin'?'editor':null,
   async sponsor(claims){const person=await people.sponsor(claims);return person?eligible(person.id):null}},
  async localCredentials(request) {
   const token=request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1]
   if (!token) return null
   const grant=await env.DB.prepare(`SELECT t.id,o.id AS sponsor FROM st_agent_tokens t JOIN oa_operators o ON o.id=t.actor_id
    WHERE t.digest=? AND t.expires_at>? AND o.version=t.actor_version AND o.status='active' AND o.role IN ('owner','admin')`)
    .bind(await digest(token),Date.now()).first<{id:string;sponsor:string}>()
   return grant?{sponsor:{id:grant.sponsor},agent:{id:`stall-local:${grant.id}`,name:'Stall personal agent',specialist:'shop operator'},scopes:[...scopes]}:null
  },
 })
}

export async function agentResponse(request: Request, env: Bindings) {
 const path=new URL(request.url).pathname
 if (path==='/docs/agents') return request.method==='GET'?agentDocs([...draftTools(env),...readTools(env)]):new Response(null,{status:405})
 if (!['/mcp','/api/rer/agent-policy','/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp','/agents'].includes(path) && !path.startsWith('/agents/')) return null
 return (await stallAgentDoor(env)).handle(request)
}

export function stallBusinessSettings(original: Bindings) {
 const env=runtimeBindings(original)
 return createBusinessSettings({db:env.DB,trust:env.RER_BUSINESS_TRUST,
  business:{settings:1,values:[],team:{roles:{admin:'admin',member:'member'}}},team:operatorAuth(env).businessTeam})
}
