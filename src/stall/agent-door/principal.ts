import type { Bindings } from '../../auth.server'
import type { ToolContext } from '../../modules/agent-door/index.ts'
import { ToolRefusal } from '../../modules/agent-door/index.ts'
import { Problem, type Actor } from '../model'

/** A door principal is still a native operator, never a fabricated session. */
export async function nativeActor(env: Bindings, ctx: ToolContext, effect = false): Promise<Actor> {
 const row = await env.DB.prepare(`SELECT o.id,o.email,o.role,o.version,g.staff_role AS staffRole,
  g.revision AS scopeRevision,g.refund_limit_cents AS refundLimitCents,g.separate_approval AS separateApproval
  FROM oa_operators o LEFT JOIN st_staff g ON g.actor_id=o.id WHERE o.id=? AND o.status='active'
  AND o.role IN ('owner','admin')`).bind(ctx.person.id).first<any>()
 if (!row) throw new ToolRefusal('unauthenticated')
 const state = await env.DB.prepare('SELECT envelope,local_document,local_revision,local_paused FROM agent_door_state WHERE id=1').first<any>()
 const paired = !!env.RER_OWNER_CLAIM_PUBLIC_KEYS
 const envelope = paired && state?.envelope ? JSON.parse(state.envelope) : null
 // Classification and target resolution remain read-only under unset policy
 // and Pause, so refusal audits keep the native facts and target.
 if (effect) {
  if (!state || !(paired ? envelope?.document : state.local_document)) throw new ToolRefusal('policy_unset')
  if (state.local_paused || envelope?.paused) throw new ToolRefusal('agents_paused')
  if (envelope && envelope.exp * 1000 <= Date.now()) throw new ToolRefusal('policy_unavailable')
  if (envelope?.revoked?.agents?.includes(ctx.agent.id) || ctx.consent && envelope?.revoked?.consents?.includes(ctx.consent)) throw new ToolRefusal('consent_revoked')
  const decision = await env.DB.prepare("SELECT json_extract(row,'$.revision') AS revision FROM agent_door_audit WHERE id=?").bind(ctx.operationId).first<{revision:number}>()
  if (!decision || decision.revision !== (paired ? envelope?.revision : state.local_revision)) throw new ToolRefusal('revision_conflict')
 }
 return { ...row, separateApproval: !!row.separateApproval, agent: true,
  grantId: ctx.agent.id.startsWith('stall-local:') ? ctx.agent.id.slice('stall-local:'.length) : undefined,
  door: { agentId: ctx.agent.id, label: ctx.actor.label, consent: ctx.consent ?? null,
   envelope: state?.envelope ?? null, localDocument: state?.local_document ?? null, localRevision: state?.local_revision ?? 0 } }
}

export async function nativeCall<T>(run: () => Promise<T>): Promise<T> {
 try { return await run() }
 catch (error) {
  if (error instanceof Problem) throw new ToolRefusal(error.code)
  throw error
 }
}
