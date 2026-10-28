import {
  applyD1ImportBatches, canonicalJson, createD1ImportJob, planD1Import, readD1ImportJob,
  readD1ImportOriginals, readD1ImportUndoReport, resumeD1Import, sha256, undoD1Import,
  type D1Database, type ImportPlan, type Json,
} from '../../modules/import-kit/src/d1/index';
import { productImportContext, productImportPrincipal, authorizeProductImport } from './context';
import type { Actor } from '../model';
import { productImportDestination, productImportMappingVersion, productImportSource, supportedProductMappings, legacyProductMappingVersion } from './csv';
import { importError, stableId, validateProductValue } from './validation';
import { productTargets, orderDependencySQL } from './targets';
import { catalogMapping, catalogContext } from './native-catalog';
import { stored } from '../../modules/import-kit/src/d1/jobs';

export type ProductImportInput = { csv: string; namespace?: string; fingerprint?: string; excludedRows?: number[] };

function namespaceFor(source: ReturnType<typeof productImportSource>, mapping = productImportMappingVersion) {
  const name = source.records[0].namespace, hash = source.artifacts[0].sha256;
  return mapping === legacyProductMappingVersion ? `${name}:${hash}` : `${mapping}:${name}:${hash}`;
}

function rejectedRows(plan: ImportPlan) {
  return plan.entries.filter(entry => entry.rejection).map(entry => ({ row: entry.source.location.row!, sourceId: entry.source.sourceId, reason: entry.rejection! }));
}
function reviewedExclusions(input: ProductImportInput, plan: ImportPlan) {
  const expected = rejectedRows(plan).map(entry => entry.row).sort((a, b) => a - b);
  const selected = input.excludedRows ?? [];
  if (!Array.isArray(selected) || selected.some(row => !Number.isSafeInteger(row)) || canonicalJson([...selected].sort((a, b) => a - b)) !== canonicalJson(expected))
    importError('IMPORT_EXCLUSIONS', 'Explicitly exclude exactly the rejected CSV rows shown in this reviewed preview.');
  if (!plan.counts.mapped) importError('IMPORT_NO_ROWS', 'There are no valid product rows to apply. Correct the rejected rows and run a new dry run.');
  if (plan.diagnostics.some(diagnostic => diagnostic.severity === 'error' && diagnostic.code !== 'REJECTED'))
    importError('IMPORT_DIAGNOSTICS', 'Resolve all blocking dry-run errors before applying.');
}

async function preparePlan(db: D1Database, actor: Actor, input: ProductImportInput) {
  await authorizeProductImport(db, actor);
  const source = productImportSource(input.csv, input.namespace);
  // A source identity names one immutable export. Product target IDs remain the
  // caller's stable, non-email IDs, permitting later exports to supersede them.
  const namespace = namespaceFor(source);
  const context = productImportContext(db, actor, namespace);
  const native = await context.storage.targets.list(db, context.destination);
  const existing = new Map(native.map(row => [row.targetId, row]));
  for (const record of source.records) {
    record.namespace = namespace;
    if (record.kind === 'shopify-product-rejected') continue;
    const product = validateProductValue(record.payload, true);
    const previous = existing.get(record.sourceId);
    if (previous && (previous.value as Record<string, Json>).active !== false)
      importError('IMPORT_PUBLISHED_PRODUCT', 'Unpublish this product through the native workflow before importing it.');
    const priorValue = previous?.value as Record<string, Json> | undefined;
    const pending = priorValue?.draft as Record<string, Json> | undefined;
    if ((priorValue?.details || pending?.details) && !source.diagnostics.some(diagnostic => diagnostic.code === 'IMPORT_DETAILS_REPLACEMENT'))
      importError('IMPORT_PRODUCT_DETAILS', 'This SKU has native product details that the six-column CSV cannot carry. Edit it in Products; this import would discard those details.');
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
      if (record.kind === 'shopify-product-rejected') return { effects: [], rejection: (record.payload as { rejection: string }).rejection };
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
  const operationKey = `stall-product-import:${input.fingerprint}`;
  const prior = await db.prepare('SELECT id,namespace,mapping_version FROM ik_jobs WHERE destination=? AND principal_id=? AND operation_key=?')
    .bind(productImportDestination, productImportPrincipal, operationKey).first<{ id: string; namespace: string; mapping_version: string }>();
  const mapping = prior?.mapping_version ?? productImportMappingVersion;
  if (!(supportedProductMappings as readonly string[]).includes(mapping)) importError('IMPORT_MAPPING', 'This import mapping is not supported.');
  const source = productImportSource(input.csv, input.namespace, mapping);
  const namespace = namespaceFor(source, mapping);
  if (prior && prior.namespace !== namespace) importError('IMPORT_REVIEW_CHANGED', 'Resume with the exact retained source and namespace.');
  const context = productImportContext(db, actor, namespace, false, mapping);
  context.reviewedFingerprint = input.fingerprint;
  context.operationKey = operationKey;
  if (prior) {
    const retained = await stored(prior.id, context, 'apply');
    reviewedExclusions(input, retained.plan);
    context.storage.targets = productTargets(false, { plan: retained.plan, jobId: prior.id });
    return resumeD1Import(prior.id, context);
  }
  const prepared = await preparePlan(db, actor, input);
  if (prepared.plan.fingerprint !== input.fingerprint) importError('IMPORT_REVIEW_CHANGED', 'The source or product state changed. Dry-run and approve the new fingerprint.');
  reviewedExclusions(input, prepared.plan);
  // Recheck the reviewed before-images immediately before creating custody.
  // Batch publication additionally fences each complete native snapshot.
  const job = await createD1ImportJob(prepared.plan, context);
  context.storage.targets = productTargets(false, { plan: prepared.plan, jobId: job.id });
  return applyD1ImportBatches(job.id, context);
}

async function jobContext(db: D1Database, actor: Actor, id: string, reversing = false) {
  await authorizeProductImport(db, actor, reversing);
  stableId(id, 'jobId');
  const row = await db.prepare(`SELECT namespace,mapping_version FROM ik_jobs WHERE id=? AND destination=? AND mapping_version IN (${[...supportedProductMappings, catalogMapping].map(() => '?').join(',')}) AND principal_id=?`)
    .bind(id, productImportDestination, ...supportedProductMappings, catalogMapping, productImportPrincipal).first<{ namespace: string; mapping_version: string }>();
  if (!row) importError('IMPORT_JOB_NOT_FOUND', 'Import journal was not found or has been retired.');
  return row.mapping_version === catalogMapping ? catalogContext(db, actor, row.namespace, reversing) : productImportContext(db, actor, row.namespace, reversing, row.mapping_version);
}

export async function listProductImports(db: D1Database, actor: Actor, limit = 50) {
  await authorizeProductImport(db, actor);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) importError('IMPORT_LIMIT', 'Journal limit must be from 1 through 100.');
  const rows = await db.prepare(`SELECT id,namespace,mapping_version FROM ik_jobs WHERE destination=? AND mapping_version IN (${[...supportedProductMappings, catalogMapping].map(() => '?').join(',')}) AND principal_id=? ORDER BY rowid DESC LIMIT ?`)
    .bind(productImportDestination, ...supportedProductMappings, catalogMapping, productImportPrincipal, limit).all<{ id: string; namespace: string; mapping_version: string }>();
  const jobs = [];
  for (const row of rows.results) jobs.push(await readD1ImportJob(row.id, row.mapping_version === catalogMapping ? catalogContext(db, actor, row.namespace) : productImportContext(db, actor, row.namespace, false, row.mapping_version)));
  await authorizeProductImport(db, actor);
  return jobs;
}

export async function getProductImport(db: D1Database, actor: Actor, id: string) {
  const context = await jobContext(db, actor, id);
  const job = await readD1ImportJob(id, context);
  const originals = await readD1ImportOriginals(id, context);
  const undoReport = await readD1ImportUndoReport(id, context, { limit: 200 });
  const retained = await stored(id, context);
  await authorizeProductImport(db, actor);
  return { job, originals, undoReport, rejectedRows: rejectedRows(retained.plan) };
}

export async function undoProductImport(db: D1Database, actor: Actor, id: string) {
  const context = await jobContext(db, actor, id, true);
  const dependency = await db.prepare(`SELECT 1 AS found FROM ik_provenance p WHERE p.job_id=? AND p.target_kind='product' AND p.reversed=0 AND EXISTS(SELECT 1 FROM st_orders o,json_each(o.value_json,'$.lines') l WHERE json_extract(l.value,'$.sku')=p.target_id) LIMIT 1`)
    .bind(id).first();
  if (dependency && context.mappingVersion === legacyProductMappingVersion) importError('IMPORT_ORDER_DEPENDENCY', 'An order refers to an imported SKU. Preserve that catalog reference and order history.');
  return undoD1Import(id, context);
}

export type { ImportPlan };
