import { authority } from '../access';
import { permits } from '../permissions';
import type { D1Database, D1ImportContext, D1Sql } from '../../modules/import-kit/src/d1/index';
import type { Actor } from '../model';
import { productImportDestination, productImportMappingVersion, defaultProductNamespace, legacyProductMappingVersion } from './csv';
import { productTargets } from './targets';
import { importError } from './validation';
export const productImportPrincipal = 'grant:stall-product-administration';
export function importAuthority(actor: Actor, human = false): D1Sql {
  if (!actor || !permits(actor,'bulk') || (human && actor.agent)) importError('FORBIDDEN', 'Current catalog bulk authority is required.');
  return authority(actor);
}
export async function authorizeProductImport(db: D1Database, actor: Actor, human = false): Promise<void> {
  const authority = importAuthority(actor, human);
  const row = await db.prepare(`SELECT CASE WHEN (${authority.sql}) THEN 1 ELSE 0 END AS allowed`).bind(...authority.params!).first<{ allowed: number }>();
  if (row?.allowed !== 1) importError('FORBIDDEN', 'A current owner or admin session or preview credential is required.');
}
export function productImportContext(db: D1Database, actor: Actor, namespace = defaultProductNamespace, reversing = false, mappingVersion = productImportMappingVersion): D1ImportContext {
  importAuthority(actor);
  return {
    destination: productImportDestination, namespace, mappingVersion,
    ...(mappingVersion !== legacyProductMappingVersion ? { reversalPolicy: 'preserve-conflicts' as const } : {}),
    batchSize: 10, maxBatches: 1,
    storage: { database: db, targets: productTargets(reversing, undefined, reversing && mappingVersion !== legacyProductMappingVersion, mappingVersion === productImportMappingVersion) },
    authorization: { principalId: productImportPrincipal, predicate: action => importAuthority(actor, !['read', 'plan'].includes(action)) },
  };
}
