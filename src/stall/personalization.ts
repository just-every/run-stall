import type { Bindings } from '../auth.server'
import { decode, encode, fileHeaders, rawBytes, safeName, sniff } from './files'
import { fail, type Personalized } from './model'
import { fileKinds, listingState, sellables, type PersonalizationField } from './listing'
import { products } from './store'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const day = 86400000

/** Shopper upload for a file field of a published product; held privately until an order claims it. */
export async function uploadPersonalization(env: Bindings, request: Request) {
 if (request.headers.get('origin') !== env.AUTH_ORIGIN) fail('ORIGIN', 'Use this shop’s own product page.', 403)
 const url = new URL(request.url), sku = url.searchParams.get('sku') ?? '', key = url.searchParams.get('field') ?? ''
 const product = (await products(env.DB)).find(item => listingState(item.value) === 'published' && sellables(item.value).some(entry => entry.sku === sku))
 const field = product?.value.details?.personalization?.find(entry => entry.key === key)
 if (field?.type !== 'file') fail('PERSONALIZATION', 'This product does not take a file upload here.', 404)
 const bytes = await rawBytes(request, field.maxBytes), mime = sniff(bytes), declared = request.headers.get('content-type')?.split(';')[0].trim()
 if (!mime || mime !== declared || !field.fileTypes.some(type => fileKinds[type] === mime)) fail('FILE_TYPE', `This file must be one of: ${field.fileTypes.join(', ')}.`, 415)
 await env.DB.prepare('DELETE FROM st_uploads WHERE order_id IS NULL AND created_at<?').bind(new Date(Date.now() - day).toISOString()).run()
 if (((await env.DB.prepare('SELECT COUNT(*) AS n FROM st_uploads WHERE order_id IS NULL').first<{ n: number }>())?.n ?? 0) >= 300) fail('UPLOADS_BUSY', 'Too many files are waiting. Try again later.', 429)
 const id = crypto.randomUUID(), name = safeName(url.searchParams.get('name'))
 await env.DB.prepare('INSERT INTO st_uploads VALUES(?,?,?,?,?,?,?,?,NULL)').bind(id, sku, key, name, mime, bytes.length, encode(bytes), new Date().toISOString()).run()
 return { fileId: id, name, size: bytes.length }
}
/** Check a shopper's answers against the product's reviewed fields; the add-on prices come only from them. */
export async function personalize(env: Bindings, fields: PersonalizationField[] | undefined, sku: string, input: unknown): Promise<Personalized[]> {
 const given = input === undefined ? {} : input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : fail('PERSONALIZATION', 'Personalization is a set of answers.', 400)
 const known = fields ?? []
 if (Object.keys(given).some(key => !known.some(field => field.key === key))) fail('PERSONALIZATION', 'This product does not ask for that personalization.', 400)
 const result: Personalized[] = []
 for (const field of known) {
  const raw = given[field.key]
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) { if (field.required) fail('PERSONALIZATION', `${field.label} is required.`, 400); continue }
  if (typeof raw !== 'string') fail('PERSONALIZATION', `${field.label} must be text.`, 400)
  const base = { key: field.key, label: field.label, type: field.type, addOnCents: field.addOnCents ?? 0 }
  if (field.type === 'text') {
   const value = raw.trim()
   if ([...value].length > field.maxLength) fail('PERSONALIZATION', `${field.label} may be at most ${field.maxLength} characters.`, 400)
   if (/[\u0000-\u001f\u007f]/.test(value)) fail('PERSONALIZATION', `${field.label} may not contain control characters.`, 400)
   result.push({ ...base, value })
  } else if (field.type === 'choice') {
   if (!field.choices.includes(raw)) fail('PERSONALIZATION', `Choose one of the listed ${field.label} options.`, 400)
   result.push({ ...base, value: raw })
  } else {
   const row = uuid.test(raw) ? await env.DB.prepare('SELECT name,mime,size FROM st_uploads WHERE id=? AND sku=? AND field=? AND order_id IS NULL').bind(raw, sku, field.key).first<{ name: string; mime: string; size: number }>() : null
   if (!row) fail('PERSONALIZATION', `Upload the ${field.label} file again.`, 400)
   if (!field.fileTypes.some(type => fileKinds[type] === row.mime) || row.size > field.maxBytes) fail('FILE_TYPE', `${field.label} must be one of: ${field.fileTypes.join(', ')}.`, 415)
   result.push({ ...base, value: row.name, fileId: raw, fileName: row.name })
  }
 }
 return result
}
/** Staff download of a customer's private file. */
export async function uploadResponse(env: Bindings, id: string): Promise<Response> {
 const row = await env.DB.prepare('SELECT name,mime,data FROM st_uploads WHERE id=? AND order_id IS NOT NULL').bind(id).first<{ name: string; mime: string; data: string }>()
 if (!row) fail('NOT_FOUND', 'No such file.', 404)
 return new Response(decode(row.data), { headers: fileHeaders(row.mime, { 'cache-control': 'private, no-store', 'content-disposition': `attachment; filename="${row.name}"` }) })
}
