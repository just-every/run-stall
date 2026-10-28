import type { Bindings } from '../../auth.server'
import { canonicalJson, sha256, type D1Database, type D1Sql, type ImportPlan, type TargetRow } from '../../modules/import-kit/src/d1/index'
import type { ImportJob, RetainedOriginal } from '../../modules/import-kit/src/types'
import type { D1UndoEffect, D1UndoDisposition } from '../../modules/import-kit/src/d1/undo-types'
import { classifyUndo } from '../../modules/import-kit/src/d1/undo-snapshot'
import { guardPredicate } from '../../modules/import-kit/src/d1/guards'
import { admission, audit, commit } from '../access'
import type { Actor } from '../model'
import { authorizeProductImport, productImportPrincipal } from './context'
import { catalogContext, catalogMapping } from './native-catalog'
import { productImportDestination } from './csv'
import { catalogTargets } from './native-targets'
import { importError } from './validation'

type Raw = { id: string; fingerprint: string; namespace: string; plan_json: string; plan_sha: string; job_json: string; report_json: string; created_at: string }
export type CatalogJournal = { raw: Raw; job: ImportJob; plan: ImportPlan; report: D1UndoDisposition[] }
function decode(raw: Raw): CatalogJournal {
 const plan = JSON.parse(raw.plan_json) as ImportPlan, job = JSON.parse(raw.job_json) as ImportJob
 if (sha256(raw.plan_json) !== raw.plan_sha || plan.fingerprint !== raw.fingerprint || job.fingerprint !== plan.fingerprint ||
  plan.namespace !== raw.namespace || job.namespace !== plan.namespace || job.mappingVersion !== catalogMapping ||
  job.principalId !== productImportPrincipal || plan.principalId !== productImportPrincipal || plan.mappingVersion !== catalogMapping || plan.destination !== productImportDestination || job.destination !== productImportDestination || job.total !== plan.entries.length || job.id !== raw.id || !Number.isSafeInteger(job.checkpoint) || job.checkpoint < 0 || job.checkpoint > plan.entries.length)
  importError('IMPORT_CUSTODY', 'Catalog custody failed its integrity check.')
 return { raw, plan, job, report: JSON.parse(raw.report_json) }
}
export async function nativeCatalogJob(db: D1Database, id: string, byFingerprint = false) {
 const raw = await db.prepare(`SELECT * FROM st_catalog_jobs WHERE ${byFingerprint ? 'fingerprint' : 'id'}=?`).bind(id).first<Raw>()
 return raw ? decode(raw) : null
}
export async function nativeCatalogJobs(db: D1Database, limit: number) {
 const rows = await db.prepare('SELECT * FROM st_catalog_jobs ORDER BY created_at DESC,rowid DESC LIMIT ?').bind(limit).all<Raw>()
 return rows.results.map(raw => decode(raw).job)
}
const statement = (db: Bindings['DB'], value: D1Sql) => db.prepare(value.sql).bind(...value.params ?? [])
const predicate = (db: Bindings['DB'], value: D1Sql) => statement(db, { sql: 'INSERT INTO st_guard(value) SELECT CASE WHEN (' + value.sql + ') THEN 1 ELSE 0 END', params: value.params })
function fence(db: Bindings['DB'], journal: CatalogJournal) {
 return predicate(db, { sql: 'EXISTS(SELECT 1 FROM st_catalog_jobs WHERE id=? AND plan_sha=? AND job_json=? AND report_json=?)',
  params: [journal.job.id, journal.raw.plan_sha, journal.raw.job_json, journal.raw.report_json] })
}
function afterRow(job: ImportJob, ordinal: number, effect: ImportPlan['entries'][number]['effects'][number]): TargetRow {
 return { destination: productImportDestination, targetKind: effect.targetKind, targetId: effect.targetId, value: effect.value,
  revision: sha256(canonicalJson([job.id, ordinal, effect.targetKind, effect.targetId, effect.value])) }
}
export async function createNativeCatalogJob(env: Bindings, actor: Actor, plan: ImportPlan) {
 const id = crypto.randomUUID()
 const job: ImportJob = { id, fingerprint: plan.fingerprint, destination: productImportDestination, namespace: plan.namespace,
  mappingVersion: catalogMapping, principalId: productImportPrincipal, state: 'queued', checkpoint: 0, total: plan.entries.length, fence: 0, error: null }
 const body = canonicalJson(plan)
 await commit(env.DB, actor, [env.DB.prepare('INSERT INTO st_catalog_jobs VALUES(?,?,?,?,?,?,?,?)').bind(id, plan.fingerprint, plan.namespace, body, sha256(body), JSON.stringify(job), '[]', new Date().toISOString()), audit(env.DB, actor, id, 'catalog.reviewed')])
 return (await nativeCatalogJob(env.DB, id))!
}

/** Each bounded publication commits complete native before-images and the checkpoint together. */
export async function publishNativeCatalog(env: Bindings, actor: Actor, journal: CatalogJournal) {
 await authorizeProductImport(env.DB, actor, true)
 if (journal.job.state === 'completed') return journal.job
 if (!['queued', 'applying'].includes(journal.job.state)) importError('IMPORT_STATE', 'This job cannot resume after undo.')
 const { job, plan } = journal, targets = catalogTargets(), commands: D1PreparedStatement[] = [fence(env.DB, journal)]
 const end = Math.min(job.checkpoint + 10, job.total)
 for (let ordinal = job.checkpoint; ordinal < end; ordinal++) {
  const entry = plan.entries[ordinal]
  for (const effect of entry.effects) {
   const previous = (entry.source.payload as unknown as { previous: TargetRow | null }).previous
   const current = await targets.read(env.DB, productImportDestination, effect.targetKind, effect.targetId) ?? null
   if (canonicalJson(current) !== canonicalJson(previous)) importError('IMPORT_REVIEW_CHANGED', 'A catalog record changed after review. Preserve it and review again.')
   commands.push(predicate(env.DB, targets.matches(current, productImportDestination, effect.targetKind, effect.targetId)))
   const after = afterRow(job, ordinal, effect)
   commands.push(...targets.write(after).map(value => statement(env.DB, value)), predicate(env.DB, targets.matches(after, productImportDestination, effect.targetKind, effect.targetId)))
  }
 }
 const next: ImportJob = { ...job, checkpoint: end, fence: job.fence + 1, state: end === job.total ? 'completed' : 'applying' }
 commands.push(env.DB.prepare('UPDATE st_catalog_jobs SET job_json=? WHERE id=?').bind(JSON.stringify(next), job.id), audit(env.DB, actor, job.id, 'catalog.applied'), admission(env.DB, actor))
 await commit(env.DB, actor, commands)
 return next
}
function undoEffects(journal: CatalogJournal): D1UndoEffect[] {
 const done = new Set(journal.report.map(row => row.effectId))
 return journal.plan.entries.flatMap((entry, ordinal) => entry.effects.map(effect => {
  const after = afterRow(journal.job, ordinal, effect), id = sha256(canonicalJson([journal.job.id, ordinal, effect.targetKind, effect.targetId]))
  return { retained: false, expected: after, provenance: { id, jobId: journal.job.id, sourceIdentity: entry.identity, sourceKind: entry.source.kind,
   sourceId: entry.source.sourceId, sourceHash: entry.source.payloadHash, artifactHash: entry.source.artifactHash, location: entry.source.location,
   destination: productImportDestination, targetKind: effect.targetKind, targetId: effect.targetId, valueHash: sha256(canonicalJson(effect.value)), attachmentHash: null,
   appliedRevision: after.revision, before: (entry.source.payload as unknown as { previous: TargetRow | null }).previous, reversed: false } }
 })).filter(effect => !done.has(effect.provenance.id)).reverse()
}
export async function undoNativeCatalog(env: Bindings, actor: Actor, journal: CatalogJournal) {
 await authorizeProductImport(env.DB, actor, true)
 if (journal.job.state === 'undone') return journal.job
 if (!['completed', 'undoing'].includes(journal.job.state)) importError('IMPORT_STATE', 'Finish applying this catalog before undoing it.')
 const targets = catalogTargets(true), context = catalogContext(env.DB, actor, journal.job.namespace, true), effects = undoEffects(journal)
 const snapshot = await targets.preparePreservedUndo!(env.DB, productImportDestination, effects)
 const decision = classifyUndo(effects, snapshot, context), selected: D1UndoDisposition[] = []
 for (const group of decision.groups) { if (selected.length && selected.length + group.length > 10) break; selected.push(...group); if (selected.length >= 10) break }
 const commands: D1PreparedStatement[] = [fence(env.DB, journal)]
 for (const guard of decision.guards) {
  const scalar = guardPredicate(guard)
  if (!scalar) throw new Error('IMPORT_UNDO_GUARD_REQUIRED')
  commands.push(predicate(env.DB, scalar))
 }
 for (const disposition of selected) if (disposition.disposition === 'reversed') {
  const effect = effects.find(effect => effect.provenance.id === disposition.effectId)!, before = effect.provenance.before
  commands.push(...(before ? targets.write(before) : targets.remove(productImportDestination, effect.expected.targetKind, effect.expected.targetId)).map(value => statement(env.DB, value)),
   predicate(env.DB, targets.matches(before, productImportDestination, effect.expected.targetKind, effect.expected.targetId)))
 }
 const report = [...journal.report, ...selected], next: ImportJob = { ...journal.job, state: selected.length === effects.length ? 'undone' : 'undoing', fence: journal.job.fence + 1 }
 commands.push(env.DB.prepare('UPDATE st_catalog_jobs SET job_json=?,report_json=? WHERE id=?').bind(JSON.stringify(next), JSON.stringify(report), next.id), audit(env.DB, actor, next.id, 'catalog.undone'), admission(env.DB, actor))
 await commit(env.DB, actor, commands)
 return next
}
export function nativeJournalReceipt(journal: CatalogJournal) {
 const { plan, job, report } = journal
 const originals: RetainedOriginal[] = plan.source.artifacts.map(artifact => ({
  jobId: job.id, kind: 'artifact', key: artifact.sha256, name: artifact.name, sha256: artifact.sha256, size: artifact.size,
  original: artifact.original?.status === 'available' ? { status: 'retained', base64: artifact.original.base64 } : { status: 'unavailable', reason: 'not-supplied' },
 }))
 const rows = plan.entries.map((entry, ordinal) => {
  const payload = entry.source.payload as unknown as { kind: string; id: string; previous: TargetRow | null }
  const disposition = report.find(row => row.effectId === sha256(canonicalJson([job.id, ordinal, payload.kind, payload.id])))
  return { row: entry.source.location.row, kind: payload.kind, id: payload.id,
   outcome: entry.rejection ? ordinal < job.checkpoint ? 'excluded' : 'rejected' : disposition?.disposition ?? (ordinal < job.checkpoint ? 'applied' : 'pending'),
   before: payload.previous, changes: entry.effects, ...(entry.rejection ? { reason: entry.rejection } : {}) }
 })
 return { job, originals, rows, rejectedRows: plan.entries.filter(entry => entry.rejection).map(entry => ({ row: entry.source.location.row!, sourceId: entry.source.sourceId, reason: entry.rejection! })),
  undoReport: { job, policy: 'preserve-conflicts', cursor: report.length, total: plan.entries.reduce((sum, entry) => sum + entry.effects.length, 0), nextOffset: job.state === 'undone' ? null : report.length,
   dispositions: report, outcome: job.state !== 'undone' ? 'pending' : report.some(row => row.disposition === 'retained') ? 'compensated' : 'undone' } }
}
