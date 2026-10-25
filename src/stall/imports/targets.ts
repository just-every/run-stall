import { canonicalJson, sha256, type D1Database, type D1Sql, type D1TargetAdapter, type D1UndoEffect, type D1UndoSnapshot, type ImportPlan, type TargetRow } from '../../modules/import-kit/src/d1/index';
import { productImportDestination } from './csv';
import { importError, validateProductValue } from './validation';
const sql = (sql: string, ...params: unknown[]): D1Sql => ({ sql, params });
export const orderDependencySQL = "EXISTS(SELECT 1 FROM st_orders o,json_each(o.value_json,'$.lines') l WHERE json_extract(l.value,'$.sku')=?)";
function checkScope(destination: string, kind = 'product') {
  if (destination !== productImportDestination || kind !== 'product') importError('IMPORT_SCOPE', 'Unsupported import destination or target kind.');
}
function decode(row: { id: string; value_json: string; revision: string }): TargetRow {
  return { destination: productImportDestination, targetKind: 'product', targetId: row.id, revision: row.revision, value: JSON.parse(row.value_json) };
}
// The ordered JSON includes every matching order line, even repeated SKUs in
// one order. Comparing the entire set also fences incoming/removed references.
const orderReferencesSQL = `SELECT json_group_array(json_array(order_id,line_key,sku)) AS edges_json FROM (
  SELECT o.id AS order_id,l.key AS line_key,json_extract(l.value,'$.sku') AS sku
  FROM st_orders o,json_each(o.value_json,'$.lines') l
  WHERE json_extract(l.value,'$.sku') IN (SELECT value FROM json_each(?))
  ORDER BY o.id,l.key
)`;
async function preparePreservedUndo(db: D1Database, destination: string, effects: D1UndoEffect[]): Promise<D1UndoSnapshot> {
  checkScope(destination);
  for (const effect of effects) checkScope(effect.expected.destination, effect.expected.targetKind);
  const ids = JSON.stringify([...new Set(effects.map(effect => effect.expected.targetId))]);
  const { results } = await db.prepare("SELECT id,value_json,revision,json_extract(value_json,'$.active') IS NOT 0 AS publication FROM st_products WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id")
    .bind(ids).all<{ id: string; value_json: string; revision: string; publication: number }>();
  const current = new Map(results.map(row => [row.id, decode(row)]));
  const published = new Set(results.filter(row => row.publication).map(row => row.id));
  const references = await db.prepare(orderReferencesSQL).bind(ids).first<{ edges_json: string }>();
  if (!references) throw new Error('IMPORT_UNDO_SNAPSHOT_REQUIRED');
  const edges = JSON.parse(references.edges_json) as [string, string | number, string][];
  const dependencies: D1UndoSnapshot['dependencies'] = [];
  const observations = effects.map(effect => {
    const id = effect.expected.targetId, row = current.get(id) ?? null;
    for (const [orderId, line, sku] of edges) {
      if (sku !== id) continue;
      dependencies.push({
        requiredEffectId: effect.provenance.id,
        cause: { table: 'st_orders', recordId: orderId, field: `lines[${JSON.stringify(line)}].sku`, targetId: id },
        evidence: { rule: 'Existing order lines protect their referenced product during undo.', orderId, line, sku },
      });
    }
    // Use the same publication predicate as forward imports and strict undo.
    if (published.has(id)) dependencies.push({
      requiredEffectId: effect.provenance.id,
      cause: { table: 'st_products', recordId: id, field: 'active', targetId: id },
      evidence: { rule: 'Publication protects this product during undo.', sku: id, field: 'active' },
    });
    return {
      effectId: effect.provenance.id,
      current: row,
      entity: { table: 'st_products', recordId: id, targetId: id },
      evidence: { rule: 'The complete product value and revision belong to this import effect.' },
    };
  });
  return {
    observations,
    dependencies,
    // Kit adds exact product matches for every observation, including absence
    // and publication state. This guard closes the outside dependency set.
    guards: [sql(`(${orderReferencesSQL})=?`, ids, references.edges_json)],
  };
}
export function productTargets(reversing = false, review?: { plan: ImportPlan; jobId: string }, preserveUndo = false): D1TargetAdapter {
  const beforeImages = new Map(review?.plan.entries.filter(entry => !entry.erased && entry.effects.some(effect => effect.targetKind === 'product')).map(entry => [entry.source.sourceId,
    (entry.source.payload as unknown as { previous: TargetRow | null }).previous]) ?? []);
  return {
    async read(db, destination, kind, id) {
      checkScope(destination, kind);
      const row = await db.prepare('SELECT id,value_json,revision FROM st_products WHERE id=?').bind(id).first<{ id: string; value_json: string; revision: string }>();
      const target = row ? decode(row) : undefined;
      if (review && beforeImages.has(id) && canonicalJson(target ?? null) !== canonicalJson(beforeImages.get(id))) {
        // Resume may see this job's exact attributed after-image, never a native edit.
        const owned = await db.prepare("SELECT record_json FROM ik_provenance WHERE job_id=? AND target_kind='product' AND target_id=? AND destination=? AND reversed=0")
          .bind(review.jobId, id, destination).first<{ record_json: string }>();
        const provenance = owned ? JSON.parse(owned.record_json) : null;
        if (!target || provenance?.appliedRevision !== target.revision || provenance?.valueHash !== sha256(canonicalJson(target.value))) importError('IMPORT_REVIEW_CHANGED', 'A product changed after review. Preserve that edit and create a fresh dry-run.');
      }
      return target;
    },
    matches(row, destination, kind, id) {
      checkScope(destination, kind);
      const snapshot = row
        ? sql('EXISTS(SELECT 1 FROM st_products WHERE id=? AND revision=? AND json(value_json)=json(?))', id, row.revision, JSON.stringify(row.value))
        : sql('NOT EXISTS(SELECT 1 FROM st_products WHERE id=?)', id);
      // Preserved undo classifies publication and orders as named dependencies;
      // exact matches must also succeed for retained rows and restored drafts.
      if (reversing && preserveUndo) return snapshot;
      // Forward imports and legacy strict undo retain their existing safeguards.
      return sql(`(${snapshot.sql}) AND NOT EXISTS(SELECT 1 FROM st_products WHERE id=? AND json_extract(value_json,'$.active') IS NOT 0) AND NOT ${orderDependencySQL}`, ...(snapshot.params ?? []), id, id);
    },
    write(row) {
      checkScope(row.destination, row.targetKind);
      // Reversal restores the complete original draft, including native fields.
      // Forward writes accept only the supported, validated catalog facts.
      if (!reversing) validateProductValue(row.value, true);
      return [sql('INSERT INTO st_products(id,value_json,revision) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision', row.targetId, JSON.stringify(row.value), row.revision)];
    },
    remove(destination, kind, id) {
      checkScope(destination, kind);
      return [sql('DELETE FROM st_products WHERE id=?', id)];
    },
    async list(db: D1Database, destination) {
      checkScope(destination);
      const rows = await db.prepare('SELECT id,value_json,revision FROM st_products ORDER BY id').all<{ id: string; value_json: string; revision: string }>();
      return rows.results.map(decode);
    },
    matchesCount(count, destination) { checkScope(destination); return sql('(SELECT COUNT(*) FROM st_products)=?', count); },
    // Base admits conflict-preserving undo before forward publication too.
    preparePreservedUndo,
  };
}
