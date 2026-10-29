import { object, string } from './schemas'

const words = (maxLength: number) => ({ ...string, maxLength })
const integer = (minimum = 0, maximum = 100000000) => ({ type: 'integer', minimum, maximum })
const list = (items: unknown, maxItems: number) => ({ type: 'array', items, maxItems })
const dimensions = object({ length: integer(1), width: integer(1), height: integer(1) })
const facts = {
 costCents: integer(), weightGrams: integer(1), dimensionsMm: dimensions,
 hsCode: { type: 'string', pattern: '^(?:\\d{6}|\\d{8}|\\d{10})$' },
 countryOfOrigin: { type: 'string', pattern: '^[A-Z]{2}$' },
}
const personalization = object({
 key: { ...words(40), pattern: '^[a-z][a-z0-9_]*$' }, label: words(80),
 type: { type: 'string', enum: ['text', 'choice', 'file'] }, required: { type: 'boolean' },
 addOnCents: integer(0, 1000000), maxLength: integer(1, 500),
 choices: { ...list(words(80), 20), minItems: 2, uniqueItems: true },
 fileTypes: { ...list({ type: 'string', enum: ['png', 'jpg', 'pdf'] }, 3), minItems: 1, uniqueItems: true },
 maxBytes: integer(1, 700000),
}, ['key', 'label', 'type'])

/** Every native product.prepare details field; native validation also checks cross-field facts. */
export const productDetailsSchema = object({
 ...facts, taxCategory: words(100),
 customFields: list(object({
  key: { ...words(40), pattern: '^[a-z][a-z0-9_]*$' }, label: words(80),
  type: { type: 'string', enum: ['text', 'number', 'boolean'] },
  value: { anyOf: [{ type: 'string', maxLength: 4000 }, { type: 'number' }, { type: 'boolean' }] },
 }), 20),
 seo: object({ title: words(160), description: words(400) }, []),
 handle: { ...words(80), pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
 categories: { ...list(words(60), 10), uniqueItems: true }, tags: { ...list(words(40), 30), uniqueItems: true },
 attributes: list(object({ name: words(60), value: words(120) }), 30),
 compareAtCents: integer(1), customsDescription: words(200),
 media: list(object({ id: words(40), kind: { type: 'string', enum: ['image', 'video'] }, alt: words(300) }), 20),
 options: list(object({ name: words(40), values: { ...list(words(40), 30), minItems: 1, uniqueItems: true } }), 3),
 variants: list(object({
  sku: words(100), options: { type: 'object', additionalProperties: words(40) },
  unitCents: integer(1), compareAtCents: integer(1), ...facts,
  customsDescription: words(200), mediaId: words(40), archived: { type: 'boolean' },
 }, ['sku', 'options']), 100),
 personalization: list(personalization, 5),
}, [])

export const productDraftInput = object({
 sku: words(100), revision: string, name: string, description: { type: 'string', maxLength: 4000 },
 unitCents: integer(1), active: { type: 'boolean' }, details: productDetailsSchema,
 archived: { type: 'boolean' }, publishAt: { anyOf: [{ type: 'string' }, { type: 'null' }] },
}, ['sku', 'name', 'description', 'unitCents'])
