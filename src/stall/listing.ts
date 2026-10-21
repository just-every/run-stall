import { fail, integer, text } from './model'
import { costCents, countryOfOrigin, dimensionsMm, hsCode, strictObject, weightGrams } from './facts'

export type Media = { id: string; kind: 'image' | 'video'; alt: string }
export type Option = { name: string; values: string[] }
export type Variant = {
 sku: string; options: Record<string, string>; unitCents?: number; compareAtCents?: number; costCents?: number; weightGrams?: number
 dimensionsMm?: { length: number; width: number; height: number }; hsCode?: string; countryOfOrigin?: string; customsDescription?: string; mediaId?: string; archived?: boolean
}
export const fileKinds = { png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf' } as const
export type FileKind = keyof typeof fileKinds
export type PersonalizationField = { key: string; label: string; required?: boolean; addOnCents?: number } & (
 { type: 'text'; maxLength: number } | { type: 'choice'; choices: string[] } | { type: 'file'; fileTypes: FileKind[]; maxBytes: number }
)
export type Listing = {
 handle?: string; categories?: string[]; tags?: string[]; attributes?: { name: string; value: string }[]; compareAtCents?: number; customsDescription?: string
 media?: Media[]; options?: Option[]; variants?: Variant[]; personalization?: PersonalizationField[]
}
export const listingKeys = ['handle', 'categories', 'tags', 'attributes', 'compareAtCents', 'customsDescription', 'media', 'options', 'variants', 'personalization']
export const maxUploadBytes = 700000
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const list = (value: unknown, name: string, max: number) => Array.isArray(value) && value.length <= max ? value : fail('PRODUCT_DETAILS', `${name} may hold at most ${max} entries.`, 400)
const words = (value: unknown, name: string, max: number, each: number) => {
 const items = list(value, name, max).map(item => text(item, name, each))
 if (new Set(items.map(item => item.toLowerCase())).size !== items.length) fail('PRODUCT_DETAILS', `${name} must not repeat an entry.`, 400)
 return items
}

/** Merchant-authored public listing facts; the shop shows only what an approved revision carries. */
export function listingFields(value: Record<string, unknown>): Listing {
 const result: Listing = {}
 if (value.handle !== undefined) {
  const handle = text(value.handle, 'Handle', 80)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(handle)) fail('PRODUCT_DETAILS', 'A handle uses lowercase letters, digits and single hyphens, such as linen-tee.', 400)
  result.handle = handle
 }
 if (value.categories !== undefined) { const items = words(value.categories, 'Categories', 10, 60); if (items.length) result.categories = items }
 if (value.tags !== undefined) { const items = words(value.tags, 'Tags', 30, 40); if (items.length) result.tags = items }
 if (value.attributes !== undefined) {
  const seen = new Set<string>()
  const items = list(value.attributes, 'Attributes', 30).map(input => {
   const attribute = strictObject(input, ['name', 'value'], 'Attribute'), name = text(attribute.name, 'Attribute name', 60), key = name.toLowerCase()
   if (seen.has(key)) fail('PRODUCT_DETAILS', 'Attribute names must be unique.', 400)
   seen.add(key)
   return { name, value: text(attribute.value, 'Attribute value', 120) }
  })
  if (items.length) result.attributes = items
 }
 if (value.compareAtCents !== undefined) result.compareAtCents = integer(value.compareAtCents, 'Compare-at cents', 1)
 if (value.customsDescription !== undefined) result.customsDescription = text(value.customsDescription, 'Customs description', 200)
 if (value.media !== undefined) {
  const seen = new Set<string>()
  const items = list(value.media, 'Media', 20).map((input): Media => {
   const item = strictObject(input, ['id', 'kind', 'alt'], 'Media'), id = text(item.id, 'Media ID', 40)
   if (!uuid.test(id) || seen.has(id)) fail('PRODUCT_DETAILS', 'Media must reference each uploaded file once.', 400)
   seen.add(id)
   if (item.kind !== 'image' && item.kind !== 'video') fail('PRODUCT_DETAILS', 'Media is an image or a video.', 400)
   return { id, kind: item.kind, alt: text(item.alt, 'Alt text', 300) }
  })
  if (items.length) result.media = items
 }
 if (value.options !== undefined) {
  const names = new Set<string>()
  const items = list(value.options, 'Options', 3).map((input): Option => {
   const option = strictObject(input, ['name', 'values'], 'Option'), name = text(option.name, 'Option name', 40)
   if (names.has(name.toLowerCase())) fail('PRODUCT_DETAILS', 'Option names must be unique.', 400)
   names.add(name.toLowerCase())
   const values = words(option.values, `${name} values`, 30, 40)
   if (!values.length) fail('PRODUCT_DETAILS', `${name} needs at least one value.`, 400)
   return { name, values }
  })
  if (items.length) result.options = items
 }
 if (value.variants !== undefined) {
  const options = result.options ?? [], skus = new Set<string>(), combinations = new Set<string>()
  const items = list(value.variants, 'Variants', 100).map((input): Variant => {
   const entry = strictObject(input, ['sku', 'options', 'unitCents', 'compareAtCents', 'costCents', 'weightGrams', 'dimensionsMm', 'hsCode', 'countryOfOrigin', 'customsDescription', 'mediaId', 'archived'], 'Variant')
   const sku = text(entry.sku, 'Variant SKU', 100), chosen = strictObject(entry.options, options.map(option => option.name), 'Variant options')
   if (skus.has(sku)) fail('PRODUCT_DETAILS', 'Variant SKUs must be unique.', 400)
   skus.add(sku)
   const picked: Record<string, string> = {}
   for (const option of options) {
    const choice = chosen[option.name]
    if (typeof choice !== 'string' || !option.values.includes(choice)) fail('PRODUCT_DETAILS', `Variant ${sku} needs one declared ${option.name} value.`, 400)
    picked[option.name] = choice
   }
   const combination = JSON.stringify(options.map(option => picked[option.name]))
   if (combinations.has(combination)) fail('PRODUCT_DETAILS', 'Each option combination may have only one variant.', 400)
   combinations.add(combination)
   const variant: Variant = { sku, options: picked }
   if (entry.unitCents !== undefined) variant.unitCents = integer(entry.unitCents, 'Variant unit cents', 1)
   if (entry.compareAtCents !== undefined) variant.compareAtCents = integer(entry.compareAtCents, 'Variant compare-at cents', 1)
   if (entry.costCents !== undefined) variant.costCents = costCents(entry.costCents)
   if (entry.weightGrams !== undefined) variant.weightGrams = weightGrams(entry.weightGrams)
   if (entry.dimensionsMm !== undefined) variant.dimensionsMm = dimensionsMm(entry.dimensionsMm)
   if (entry.hsCode !== undefined) variant.hsCode = hsCode(entry.hsCode)
   if (entry.countryOfOrigin !== undefined) variant.countryOfOrigin = countryOfOrigin(entry.countryOfOrigin)
   if (entry.customsDescription !== undefined) variant.customsDescription = text(entry.customsDescription, 'Customs description', 200)
   if (entry.mediaId !== undefined) {
    variant.mediaId = text(entry.mediaId, 'Variant media', 40)
    if (!result.media?.some(media => media.id === variant.mediaId && media.kind === 'image')) fail('PRODUCT_DETAILS', `Variant ${sku} must show one of this product's images.`, 400)
   }
   if (entry.archived !== undefined) { if (typeof entry.archived !== 'boolean') fail('PRODUCT_DETAILS', 'Archived is true or false.', 400); if (entry.archived) variant.archived = true }
   return variant
  })
  if (items.length && !options.length) fail('PRODUCT_DETAILS', 'Define options before variants.', 400)
  if (items.length) result.variants = items
 }
 if (result.options?.length && !result.variants?.length) fail('PRODUCT_DETAILS', 'Options need at least one variant.', 400)
 if (value.personalization !== undefined) {
  const keys = new Set<string>()
  const items = list(value.personalization, 'Personalization fields', 5).map((input): PersonalizationField => {
   const entry = strictObject(input, ['key', 'label', 'type', 'required', 'addOnCents', 'maxLength', 'choices', 'fileTypes', 'maxBytes'], 'Personalization field')
   const key = text(entry.key, 'Field key', 40), label = text(entry.label, 'Field label', 80)
   if (!/^[a-z][a-z0-9_]*$/.test(key) || keys.has(key)) fail('PRODUCT_DETAILS', 'Personalization keys must be unique lowercase names using letters, digits and underscores.', 400)
   keys.add(key)
   const base = { key, label, ...(entry.required === true ? { required: true as const } : {}), ...(entry.addOnCents !== undefined ? { addOnCents: integer(entry.addOnCents, 'Add-on cents', 0, 1000000) } : {}) }
   if (entry.required !== undefined && typeof entry.required !== 'boolean') fail('PRODUCT_DETAILS', 'Required is true or false.', 400)
   if (entry.type === 'text') return { ...base, type: 'text', maxLength: integer(entry.maxLength, 'Character limit', 1, 500) }
   if (entry.type === 'choice') { const choices = words(entry.choices, 'Choices', 20, 80); if (choices.length < 2) fail('PRODUCT_DETAILS', 'A choice list needs at least two choices.', 400); return { ...base, type: 'choice', choices } }
   if (entry.type === 'file') {
    const types = list(entry.fileTypes, 'File types', 3)
    if (!types.length || types.some(type => !(type in fileKinds)) || new Set(types).size !== types.length) fail('PRODUCT_DETAILS', 'Allowed file types are png, jpg and pdf.', 400)
    return { ...base, type: 'file', fileTypes: types as FileKind[], maxBytes: integer(entry.maxBytes, 'File size limit', 1, maxUploadBytes) }
   }
   return fail('PRODUCT_DETAILS', 'A personalization field is text, a choice list or a file upload.', 400)
  })
  if (items.length) result.personalization = items
 }
 return result
}

/** What a shopper can buy: the product itself, or each variant not archived. */
export type Sellable = { sku: string; variant?: Variant; label?: string; unitCents: number; compareAtCents?: number }
export const variantLabel = (variant: Variant, options: Option[]) => options.map(option => variant.options[option.name]).join(' / ')
export function sellables(product: { sku: string; unitCents: number; details?: Listing }): Sellable[] {
 const { variants, options = [], compareAtCents } = product.details ?? {}
 if (!variants?.length) return [{ sku: product.sku, unitCents: product.unitCents, ...(compareAtCents ? { compareAtCents } : {}) }]
 return variants.filter(variant => !variant.archived).map(variant => ({ sku: variant.sku, variant, label: variantLabel(variant, options), unitCents: variant.unitCents ?? product.unitCents, ...((variant.compareAtCents ?? compareAtCents) ? { compareAtCents: variant.compareAtCents ?? compareAtCents } : {}) }))
}
export type ListingState = 'draft' | 'scheduled' | 'published' | 'archived'
export function listingState(value: { active: boolean; archived?: boolean; publishAt?: string; approval?: unknown }, now = Date.now()): ListingState {
 if (value.archived) return 'archived'
 if (!value.approval || !value.active) return 'draft'
 return value.publishAt && Date.parse(value.publishAt) > now ? 'scheduled' : 'published'
}
