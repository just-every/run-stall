import { runtimeBindings, type Bindings } from '../auth.server'
import { createPortabilityHandler, boundedJson } from '@runeditrun/rer/modules/portability/http'
import { portabilityPolicy } from './portability-policy.mjs'
import { authorize } from './permissions'
import { audit, commit, current, live } from './access'
import { businessExport } from './exports'
import { Problem, fail, requirePerson, requireSupplier } from './model'
import { authorizeProductImport } from './imports/context'
import { nativeCatalogFile, previewCatalog, applyCatalog, exportCatalog } from './imports/native-catalog'
import { dryRunProductImport, applyProductImport, listProductImports, getProductImport, undoProductImport } from './imports'

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
export async function toolsResponse(request: Request, original: Bindings): Promise<Response | null> {
 const path = new URL(request.url).pathname
 if (!path.startsWith('/api/stall/imports') && !path.startsWith('/api/stall/portability/') && !path.startsWith('/api/stall/exports/')) return null
 try {
  const env = runtimeBindings(original), actor = await current(request, env)
  requireSupplier(actor)
  if (!['GET', 'HEAD'].includes(request.method) && !actor.agent && request.headers.get('origin') !== env.AUTH_ORIGIN) fail('ORIGIN', 'Use this installation’s own page.', 403)
  if (path.startsWith('/api/stall/exports/')) {
   requirePerson(actor)
   if (actor.role !== 'owner') fail('FORBIDDEN', 'Only the owner may export business records.', 403)
   if (request.method !== 'GET') return json({ error: { code: 'NOT_FOUND', message: 'Download business exports with GET.' } }, 404)
   await live(env, actor)
   const kind = path.slice('/api/stall/exports/'.length)
   const response = await businessExport(env.DB, kind)
   await commit(env.DB, actor, [audit(env.DB, actor, kind, 'business.exported')])
   return response
  }
  if (path.startsWith('/api/stall/portability/')) {
   requirePerson(actor)
   if (actor.role !== 'owner') fail('FORBIDDEN', 'Only the owner may export or restore the installation.', 403)
   const response = await (await createPortabilityHandler({ db: env.DB, policy: portabilityPolicy, appOrigin: env.AUTH_ORIGIN, basePath: '/api/stall/portability', authorize: async () => { await live(env, actor); return actor.id } }))(request)
   if (response?.ok && path.endsWith('/download')) {
    const headers = new Headers(response.headers)
    headers.set('content-disposition', 'attachment; filename="stall.rer"')
    headers.set('x-content-type-options', 'nosniff')
    return new Response(response.body, { status: response.status, headers })
   }
   return response
  }
  authorize(actor,'bulk')
  if (path === '/api/stall/imports' && request.method === 'GET') return json({ jobs: await listProductImports(env.DB, actor) })
  if (path === '/api/stall/imports/preview' && request.method === 'POST') { const input = await boundedJson(request, 1_000_000) as any; return json(await (nativeCatalogFile(input.csv) ? previewCatalog(env, actor, input) : dryRunProductImport(env.DB, actor, input))) }
  requirePerson(actor)
  if (path === '/api/stall/imports/apply' && request.method === 'POST') { const input = await boundedJson(request, 1_000_000) as any; return json(await (nativeCatalogFile(input.csv) ? applyCatalog(env, actor, input) : applyProductImport(env.DB, actor, input))) }
  if (path === '/api/stall/imports/catalog.csv' && request.method === 'GET') { await authorizeProductImport(env.DB, actor); const response = await exportCatalog(env.DB); await commit(env.DB, actor, [audit(env.DB, actor, 'catalog', 'catalog.exported')]); return response }
  const match = /^\/api\/stall\/imports\/([^/]+)(\/undo)?$/.exec(path)
  if (match && match[2] && request.method === 'POST') return json(await undoProductImport(env.DB, actor, match[1]))
  if (match && !match[2] && request.method === 'GET') return json(await getProductImport(env.DB, actor, match[1]))
  return json({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } }, 404)
 } catch (error: any) {
  if (error instanceof Problem) return json({ error: { code: error.code, message: error.message } }, error.status)
  if (typeof error?.code === 'string' && /^(CATALOG_|PRODUCT_|IMPORT_|CSV_|FORBIDDEN|NATIVE_EDIT_CONFLICT)/.test(error.code)) return json({ error: { code: error.code, message: error.message } }, error.code === 'FORBIDDEN' ? 403 : 409)
  return json({ error: { code: 'IMPORT_CONFLICT', message: 'The import could not finish. Preserve native edits, refresh the journal and review a new dry run.' } }, 409)
 }
}
