import { permits } from './permissions'
import type { Bindings } from '../auth.server'
import { audit, commit, current } from './access'
import { decode, encode, fileHeaders, rawBytes, sniff } from './files'
import { fail, requirePerson, type Actor } from './model'
import { listingState, maxUploadBytes } from './listing'
import { products } from './store'

const types: Record<string, 'image' | 'video'> = { 'image/png': 'image', 'image/jpeg': 'image', 'image/gif': 'image', 'image/webp': 'image', 'video/mp4': 'video', 'video/webm': 'video' }

/** Staff upload: the file's own bytes decide its type, and a declared type must agree. */
export async function uploadMedia(env: Bindings, actor: Actor, request: Request) {
 requirePerson(actor)
 const bytes = await rawBytes(request, maxUploadBytes), mime = sniff(bytes), declared = request.headers.get('content-type')?.split(';')[0].trim()
 if (!mime || !types[mime] || declared !== mime) fail('FILE_TYPE', 'Upload a PNG, JPEG, GIF or WebP image, or an MP4 or WebM video, whose content matches its type.', 415)
 const id = crypto.randomUUID()
 await commit(env.DB, actor, [env.DB.prepare('INSERT INTO st_media VALUES(?,?,?,?,?,?)').bind(id, types[mime], mime, bytes.length, encode(bytes), new Date().toISOString()), audit(env.DB, actor, id, 'media.uploaded')])
 return { id, kind: types[mime], mime, size: bytes.length }
}
/** Public only while an approved, published listing shows the file; staff may preview any. */
export async function mediaResponse(env: Bindings, request: Request, id: string): Promise<Response> {
 const row = await env.DB.prepare('SELECT mime,data FROM st_media WHERE id=?').bind(id).first<{ mime: string; data: string }>()
 if (!row) fail('NOT_FOUND', 'No such file.', 404)
 const shown = (await products(env.DB)).some(product => listingState(product.value) === 'published' && product.value.details?.media?.some(media => media.id === id))
 if (!shown) {
  const actor = await current(request, env).catch(() => null)
  if (!actor || !permits(actor,'catalog')) fail('NOT_FOUND', 'No such file.', 404)
 }
 return new Response(decode(row.data), { headers: fileHeaders(row.mime, { 'cache-control': shown ? 'public, max-age=300' : 'private, no-store' }) })
}
