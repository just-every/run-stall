import { canonicalJson, sha256, type D1Database, type D1Sql, type D1TargetAdapter, type ImportPlan, type TargetRow } from '../../modules/import-kit/src/d1/index';
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
export function productTargets(reversing = false, review?: { plan: ImportPlan; jobId: string }): D1TargetAdapter {
  const beforeImages = new Map(review?.plan.entries.filter(entry => !entry.erased).map(entry => [entry.source.sourceId,
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
      // Both directions fence publication and orders in the same batch as writes.
      // Strict kit undo additionally verifies the complete attributed after-image.
      return sql(`(${snapshot.sql}) AND NOT EXISTS(SELECT 1 FROM st_products WHERE id=? AND json_extract(value_json,'$.active') IS NOT 0) AND NOT ${orderDependencySQL}`, ...(snapshot.params ?? []), id, id);
    },
    write(row) {
      checkScope(row.destination, row.targetKind);
      // Reversal restores the complete original draft, including native fields.
      // Forward writes use the import's deliberately narrow product schema.
      if (!reversing) validateProductValue(row.value);
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
  };
}
