import type { Actor } from '../model'

/** The existing native commit repeats identity, policy and local grant checks. */
export function doorAuthority(actor: Actor) {
 const door = actor.door!
 const sql = `EXISTS(SELECT 1 FROM oa_operators o WHERE o.id=? AND o.version=? AND o.role=?
  AND o.status='active' AND o.role IN ('owner','admin') AND
  COALESCE((SELECT revision FROM st_staff WHERE actor_id=o.id),'')=?)
  AND EXISTS(SELECT 1 FROM agent_door_state WHERE id=1 AND local_paused=0
   AND envelope IS ? AND local_document IS ? AND local_revision=?)
  AND NOT EXISTS(SELECT 1 FROM agent_door_agents WHERE id=? AND (revoked=1 OR sponsor<>?))`
 const params: unknown[] = [actor.id,actor.version,actor.role,actor.scopeRevision ?? '',door.envelope,door.localDocument,door.localRevision,door.agentId,actor.id]
 if (actor.grantId) return { sql: `${sql} AND EXISTS(SELECT 1 FROM st_agent_tokens WHERE id=? AND actor_id=? AND actor_version=? AND expires_at>?)`, params: [...params,actor.grantId,actor.id,actor.version,Date.now()] }
 return { sql: `${sql} AND EXISTS(SELECT 1 FROM bs_settings s WHERE singleton=1 AND stopped=0 AND
  ((owner_id IS NOT NULL AND ?=(SELECT o.id FROM oa_operators o LEFT JOIN oa_bootstrap b ON b.claim_id=o.id
   WHERE o.role='owner' ORDER BY b.claim_id IS NULL,o.created_at,o.id LIMIT 1))
   OR EXISTS(SELECT 1 FROM bs_team WHERE operator_id=? AND business_id IS NOT NULL AND state<>'conflict')))`, params: [...params,actor.id,actor.id] }
}
