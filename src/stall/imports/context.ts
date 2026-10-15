import type { D1Database, D1ImportContext, D1Sql } from '../../modules/import-kit/src/d1/index';
import type { Actor } from '../model';
import { productImportDestination, productImportMappingVersion, defaultProductNamespace } from './csv';
import { productTargets } from './targets';
import { importError } from './validation';
export const productImportPrincipal = 'grant:stall-product-administration';
export function importAuthority(actor: Actor, human = false): D1Sql {
  if (!actor || !['owner', 'admin'].includes(actor.role) || (human && actor.agent)) importError('FORBIDDEN', 'Only a current human owner or admin can apply or undo product imports.');
  if (actor.agent) return {
    sql: "EXISTS(SELECT 1 FROM st_agent_tokens t JOIN oa_operators o ON o.id=t.actor_id WHERE t.id=? AND o.id=? AND o.version=? AND o.role=? AND t.actor_version=o.version AND o.status='active' AND o.role IN ('owner','admin') AND t.expires_at>?)",
    params: [actor.grantId ?? '', actor.id, actor.version, actor.role, Date.now()],
  };
  return {
    sql: "EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_operators o ON o.id=s.operator_id WHERE s.id=? AND o.id=? AND o.version=? AND s.operator_version=o.version AND o.role=? AND o.role IN ('owner','admin') AND o.status='active' AND s.revoked_at IS NULL AND s.expires_at>?)",
    params: [actor.sessionId ?? '', actor.id, actor.version, actor.role, Date.now()],
  };
}
export async function authorizeProductImport(db: D1Database, actor: Actor, human = false): Promise<void> {
  const authority = importAuthority(actor, human);
  const row = await db.prepare(`SELECT CASE WHEN (${authority.sql}) THEN 1 ELSE 0 END AS allowed`).bind(...authority.params!).first<{ allowed: number }>();
  if (row?.allowed !== 1) importError('FORBIDDEN', 'A current owner or admin session or preview credential is required.');
}
export function productImportContext(db: D1Database, actor: Actor, namespace = defaultProductNamespace, reversing = false): D1ImportContext {
  importAuthority(actor);
  return {
    destination: productImportDestination, namespace, mappingVersion: productImportMappingVersion,
    batchSize: 10, maxBatches: 1,
    storage: { database: db, targets: productTargets(reversing) },
    authorization: { principalId: productImportPrincipal, predicate: action => importAuthority(actor, !['read', 'plan'].includes(action)) },
  };
}
