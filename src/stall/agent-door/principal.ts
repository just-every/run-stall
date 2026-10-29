import type { Bindings } from '../../auth.server'
import type { ToolContext } from '../../modules/agent-door/index.ts'
import { ToolRefusal } from '../../modules/agent-door/index.ts'
import { Problem, type Actor } from '../model'

/** A door principal is still a native operator, never a fabricated session. */
export async function nativeActor(env: Bindings, ctx: ToolContext): Promise<Actor> {
 const row = await env.DB.prepare(`SELECT o.id,o.email,o.role,o.version,g.staff_role AS staffRole,
  g.revision AS scopeRevision,g.refund_limit_cents AS refundLimitCents,g.separate_approval AS separateApproval
  FROM oa_operators o LEFT JOIN st_staff g ON g.actor_id=o.id WHERE o.id=? AND o.status='active'
  AND o.role IN ('owner','admin')`).bind(ctx.person.id).first<any>()
 if (!row) throw new ToolRefusal('unauthenticated')
 const state = await env.DB.prepare('SELECT envelope,local_document,local_revision,local_paused FROM agent_door_state WHERE id=1').first<any>()
 const envelope = state?.envelope ? JSON.parse(state.envelope) : null
 if (!state || state.local_paused || envelope?.paused || envelope && envelope.exp * 1000 <= Date.now()) throw new ToolRefusal('agents_paused')
 if (envelope?.revoked?.agents?.includes(ctx.agent.id) || ctx.consent && envelope?.revoked?.consents?.includes(ctx.consent)) throw new ToolRefusal('consent_revoked')
 return { ...row, separateApproval: !!row.separateApproval, agent: true,
  grantId: ctx.agent.id.startsWith('stall-local:') ? ctx.agent.id.slice('stall-local:'.length) : undefined,
  door: { agentId: ctx.agent.id, label: ctx.actor.label, consent: ctx.consent ?? null,
   envelope: state.envelope, localDocument: state.local_document, localRevision: state.local_revision } }
}

export async function nativeCall<T>(run: () => Promise<T>): Promise<T> {
 try { return await run() }
 catch (error) {
  if (error instanceof Problem) throw new ToolRefusal(error.code)
  throw error
 }
}
