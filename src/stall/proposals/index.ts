import type { Bindings } from '../../auth.server'
import { audit, changed, commit } from '../access'
import { approval, actorLabel, fail, requirePerson, text, type Actor } from '../model'
import { checkListing } from '../listing-checks'
import { products } from '../store'
import { proposalSources } from './sources'
import { proposalChanges, proposalPreview } from './changes'
import { validateFeedInventory } from './feed'
import type { Proposal } from './model'

/** Native merchandising visibility is narrower than general catalogue access. */
export function authorizeMerchandising(actor: Actor) {
 if (!['owner', 'admin'].includes(actor.role) || actor.staffRole) fail('FORBIDDEN', 'Only the owner or administrator may manage merchandising proposals.', 403)
}

export async function merchandisingProposals(db: D1Database, sku?: string): Promise<Proposal[]> {
 const rows = sku ? await db.prepare('SELECT value_json FROM st_merch_proposals WHERE sku=? ORDER BY rowid DESC').bind(sku).all<{ value_json: string }>() : await db.prepare('SELECT value_json FROM st_merch_proposals ORDER BY rowid').all<{ value_json: string }>()
 return rows.results.map(row => JSON.parse(row.value_json))
}
export async function proposalBundle(db: D1Database, sku: string) {
 const source = await proposalSources(db, sku)
 return { sku, revision: source.product.revision, sources: source.sources, questions: source.questions, proposals: await merchandisingProposals(db, sku) }
}
export async function currentProposal(db: D1Database, p: any) {
 const row = await db.prepare('SELECT value_json FROM st_merch_proposals WHERE id=?').bind(text(p.id, 'Proposal ID')).first<{ value_json: string }>()
 const proposal: Proposal = row ? JSON.parse(row.value_json) : fail('NOT_FOUND', 'No such proposal.', 404)
 if (p.revision !== proposal.revision || proposal.status !== 'draft') fail('CHANGED', 'Review the exact current proposal. Restored proposals require fresh agent preparation.')
 const source = await proposalSources(db, proposal.sku)
 if (source.product.revision !== proposal.sourceRevision || source.sourceDigest !== proposal.sourceDigest) fail('SOURCE_CHANGED', 'A cited source changed. Ask the agent to prepare a fresh proposal before publishing.')
 return { proposal, source }
}
export async function previewProposal(env: Bindings, p: any) {
 const { proposal, source } = await currentProposal(env.DB, p)
 const preview = proposalPreview(source.product.value, proposal.changes, p.selected, env.AUTH_ORIGIN)
 if (proposal.changes.some(change => change.field === 'channel' && p.selected.includes(change.id))) preview.feed = await validateFeedInventory(env, preview.feed)
 return preview
}
export async function proposalCommand(env: Bindings, actor: Actor, type: string, p: any) {
 authorizeMerchandising(actor)
 if (type === 'merch.prepare') {
  if (!actor.agent) fail('AGENT_REQUIRED', 'Prepare this proposal through a personal agent credential.', 403)
  const sku = text(p.sku, 'Product SKU', 100), source = await proposalSources(env.DB, sku)
  if (p.revision !== source.product.revision) fail('SOURCE_CHANGED', 'Read the current approved source bundle before preparing a proposal.')
  if (p.requests !== undefined && (!Array.isArray(p.requests) || p.requests.length > 3 || p.requests.some((request: unknown) => !['inventory', 'certification', 'reviews'].includes(request as string)))) fail('INPUT', 'Unsupported requests name inventory, certification or reviews.', 400)
  const id = crypto.randomUUID(), revision = crypto.randomUUID()
  const proposal: Proposal = { id, revision, sku, sourceRevision: source.product.revision, sourceDigest: source.sourceDigest, sources: source.sources, changes: proposalChanges(p.changes, source.sources), questions: source.questions, unsupported: (p.requests ?? []).map((request: string) => `${request}: not inferred; no supporting merchant evidence or authority.`), preparedBy: actorLabel(actor), createdAt: new Date().toISOString(), status: 'draft' }
  await commit(env.DB, actor, [sourceFence(env.DB, source), env.DB.prepare('INSERT INTO st_merch_proposals VALUES(?,?,?,?)').bind(id, sku, revision, JSON.stringify(proposal)), audit(env.DB, actor, id, 'merch.prepared')])
  return proposal
 }
 requirePerson(actor)
 const { proposal, source } = await currentProposal(env.DB, p), preview = proposalPreview(source.product.value, proposal.changes, p.selected, env.AUTH_ORIGIN)
 if (proposal.changes.some(change => change.field === 'channel' && p.selected.includes(change.id))) preview.feed = await validateFeedInventory(env, preview.feed)
 await checkListing(env.DB, preview.product, await products(env.DB))
 const next: Proposal = { ...proposal, revision: crypto.randomUUID(), status: 'published', selected: p.selected, approval: approval(actor, proposal.revision), ...(proposal.changes.some(change => change.field === 'channel' && p.selected.includes(change.id)) ? { feed: preview.feed } : {}) }
 const writes = [sourceFence(env.DB, source), env.DB.prepare("UPDATE st_merch_proposals SET revision=?,value_json=? WHERE id=? AND revision=? AND json_extract(value_json,'$.status')='draft'").bind(next.revision, JSON.stringify(next), proposal.id, proposal.revision), changed(env.DB), env.DB.prepare('UPDATE st_products SET revision=?,value_json=? WHERE id=? AND revision=?').bind(crypto.randomUUID(), JSON.stringify({ ...preview.product, approval: approval(actor, proposal.revision) }), proposal.sku, source.product.revision), changed(env.DB)]
 for (const handle of preview.collections) {
  const group = source.groups.find(entry => entry.id === handle) ?? fail('SOURCE_CHANGED', 'A proposed collection is missing.')
  const value = { ...group.value, skus: [...new Set([...(group.value.skus ?? []), proposal.sku])] }
  writes.push(env.DB.prepare('UPDATE st_collections SET value_json=?,revision=? WHERE id=? AND revision=?').bind(JSON.stringify(value), crypto.randomUUID(), handle, group.revision), changed(env.DB))
 }
 await commit(env.DB, actor, [...writes, audit(env.DB, actor, proposal.id, 'merch.published'), audit(env.DB, actor, proposal.sku, 'product.published')])
 return next
}
/** Fence source checks inside the same batch as effects, including concurrent edits. */
function sourceFence(db: D1Database, source: Awaited<ReturnType<typeof proposalSources>>) {
 return db.prepare(`INSERT INTO st_guard(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_products WHERE id=? AND revision=?) AND (SELECT json_group_array(id||':'||revision) FROM (SELECT id,revision FROM st_collections ORDER BY id))=? THEN 1 ELSE 0 END`).bind(source.product.id, source.product.revision, JSON.stringify(source.groups.map(group => `${group.id}:${group.revision}`)))
}
