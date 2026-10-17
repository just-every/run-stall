import {
  applyD1ImportBatches, canonicalJson, createD1ImportJob, planD1Import, readD1ImportJob,
  readD1ImportOriginals, readD1ImportUndoReport, resumeD1Import, sha256, undoD1Import,
  type D1Database, type ImportPlan, type Json,
} from '../../modules/import-kit/src/d1/index';
import { productImportContext, productImportPrincipal, authorizeProductImport } from './context';
import type { Actor } from '../model';
import { productImportDestination, productImportMappingVersion, productImportSource } from './csv';
import { importError, stableId, validateProductValue } from './validation';
import { productTargets, orderDependencySQL } from './targets';
import { stored } from '../../modules/import-kit/src/d1/jobs';

export type ProductImportInput = { csv: string; namespace?: string; fingerprint?: string };

async function preparePlan(db: D1Database, actor: Actor, input: ProductImportInput) {
  await authorizeProductImport(db, actor);
  const source = productImportSource(input.csv, input.namespace);
  // A source identity names one immutable export. Product target IDs remain the
  // caller's stable, non-email IDs, permitting later exports to supersede them.
  const namespace = `${source.records[0].namespace}:${source.artifacts[0].sha256}`;
  const context = productImportContext(db, actor, namespace);
  const native = await context.storage.targets.list(db, context.destination);
  const existing = new Map(native.map(row => [row.targetId, row]));
  for (const record of source.records) {
    record.namespace = namespace;
    const product = validateProductValue(record.payload);
    const previous = existing.get(record.sourceId);
    if (previous && (previous.value as Record<string, Json>).active !== false)
      importError('IMPORT_PUBLISHED_PRODUCT', 'Unpublish this product through the native workflow before importing it.');
    const dependency = await db.prepare(`SELECT 1 AS found WHERE ${orderDependencySQL}`).bind(record.sourceId).first();
    if (dependency) importError('IMPORT_ORDER_DEPENDENCY', 'An order refers to this SKU. Preserve its catalog reference.');
    // Bind the complete before-image into the reviewed fingerprint, including
    // edits whose writer failed to change revision. The kit fences it on apply.
    record.payload = { product, previous: (existing.get(record.sourceId) ?? null) as unknown as Json };
    record.payloadHash = sha256(canonicalJson(record.payload));
  }
  const plan = await planD1Import(source, {
    version: productImportMappingVersion,
    map(record) {
      const payload = record.payload as { product: Json; previous: { revision: string } | null };
      return { effects: [{ targetKind: 'product', targetId: record.sourceId, value: payload.product,
        ...(payload.previous ? { expectedRevision: payload.previous.revision } : {}) }] };
    },
  }, context);
  return { plan, context };
}

export async function dryRunProductImport(db: D1Database, actor: Actor, input: ProductImportInput) {
  const { plan } = await preparePlan(db, actor, input);
  return { plan, fingerprint: plan.fingerprint, counts: plan.counts, diagnostics: plan.diagnostics };
}

export async function applyProductImport(db: D1Database, actor: Actor, input: ProductImportInput & { fingerprint: string }) {
  await authorizeProductImport(db, actor, true);
  if (typeof input.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(input.fingerprint)) importError('IMPORT_APPROVAL', 'Supply the exact fingerprint approved after dry-run.');
  const source = productImportSource(input.csv, input.namespace);
  const namespace = `${source.records[0].namespace}:${source.artifacts[0].sha256}`;
  const context = productImportContext(db, actor, namespace);
  context.reviewedFingerprint = input.fingerprint;
  context.operationKey = `stall-product-import:${input.fingerprint}`;
  const prior = await db.prepare('SELECT id FROM ik_jobs WHERE destination=? AND principal_id=? AND operation_key=?')
    .bind(context.destination, productImportPrincipal, context.operationKey).first<{ id: string }>();
  if (prior) {
    const retained = await stored(prior.id, context, 'apply');
    context.storage.targets = productTargets(false, { plan: retained.plan, jobId: prior.id });
    return resumeD1Import(prior.id, context);
  }
  const prepared = await preparePlan(db, actor, input);
  if (prepared.plan.fingerprint !== input.fingerprint) importError('IMPORT_REVIEW_CHANGED', 'The source or product state changed. Dry-run and approve the new fingerprint.');
  if (prepared.plan.diagnostics.some(diagnostic => diagnostic.severity === 'error')) importError('IMPORT_DIAGNOSTICS', 'Resolve all dry-run errors before applying.');
  // Recheck the reviewed before-images immediately before creating custody.
  // Batch publication additionally fences each complete native snapshot.
  const job = await createD1ImportJob(prepared.plan, context);
  context.storage.targets = productTargets(false, { plan: prepared.plan, jobId: job.id });
  return applyD1ImportBatches(job.id, context);
}

async function jobContext(db: D1Database, actor: Actor, id: string, reversing = false) {
  await authorizeProductImport(db, actor, reversing);
  stableId(id, 'jobId');
  const row = await db.prepare('SELECT namespace FROM ik_jobs WHERE id=? AND destination=? AND mapping_version=? AND principal_id=?')
    .bind(id, productImportDestination, productImportMappingVersion, productImportPrincipal).first<{ namespace: string }>();
  if (!row) importError('IMPORT_JOB_NOT_FOUND', 'Import journal was not found or has been retired.');
  return productImportContext(db, actor, row.namespace, reversing);
}

export async function listProductImports(db: D1Database, actor: Actor, limit = 50) {
  await authorizeProductImport(db, actor);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) importError('IMPORT_LIMIT', 'Journal limit must be from 1 through 100.');
  const rows = await db.prepare('SELECT id,namespace FROM ik_jobs WHERE destination=? AND mapping_version=? AND principal_id=? ORDER BY rowid DESC LIMIT ?')
    .bind(productImportDestination, productImportMappingVersion, productImportPrincipal, limit).all<{ id: string; namespace: string }>();
  const jobs = [];
  for (const row of rows.results) jobs.push(await readD1ImportJob(row.id, productImportContext(db, actor, row.namespace)));
  await authorizeProductImport(db, actor);
  return jobs;
}

export async function getProductImport(db: D1Database, actor: Actor, id: string) {
  const context = await jobContext(db, actor, id);
  const job = await readD1ImportJob(id, context);
  const originals = await readD1ImportOriginals(id, context);
  const undoReport = await readD1ImportUndoReport(id, context);
  return { job, originals, undoReport };
}

export async function undoProductImport(db: D1Database, actor: Actor, id: string) {
  const context = await jobContext(db, actor, id, true);
  const dependency = await db.prepare(`SELECT 1 AS found FROM ik_provenance p WHERE p.job_id=? AND p.target_kind='product' AND p.reversed=0 AND EXISTS(SELECT 1 FROM st_orders o,json_each(o.value_json,'$.lines') l WHERE json_extract(l.value,'$.sku')=p.target_id) LIMIT 1`)
    .bind(id).first();
  if (dependency) importError('IMPORT_ORDER_DEPENDENCY', 'An order refers to an imported SKU. Preserve that catalog reference and order history.');
  return undoD1Import(id, context);
}

export type { ImportPlan };
