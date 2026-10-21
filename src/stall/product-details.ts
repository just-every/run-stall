import { fail, integer, text } from './model'

export type CustomField = { key: string; label: string } & (
 { type: 'text'; value: string } | { type: 'number'; value: number } | { type: 'boolean'; value: boolean }
)
export type ProductDetails = {
 costCents?: number
 weightGrams?: number
 dimensionsMm?: { length: number; width: number; height: number }
 taxCategory?: string
 hsCode?: string
 countryOfOrigin?: string
 customFields?: CustomField[]
}
function object(value: unknown, keys: string[], name: string): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
  fail('PRODUCT_DETAILS', `${name} must use only its documented fields.`, 400)
 return value as Record<string, unknown>
}
/** Merchant facts only: syntax checks do not establish a tax or customs ruling. */
export function productDetails(input: unknown): ProductDetails {
 const value = object(input, ['costCents', 'weightGrams', 'dimensionsMm', 'taxCategory', 'hsCode', 'countryOfOrigin', 'customFields'], 'Product details')
 const result: ProductDetails = {}
 if (value.costCents !== undefined) result.costCents = integer(value.costCents, 'Cost cents')
 if (value.weightGrams !== undefined) result.weightGrams = integer(value.weightGrams, 'Weight in grams', 1)
 if (value.dimensionsMm !== undefined) {
  const dimensions = object(value.dimensionsMm, ['length', 'width', 'height'], 'Dimensions')
  result.dimensionsMm = { length: integer(dimensions.length, 'Length in millimeters', 1), width: integer(dimensions.width, 'Width in millimeters', 1), height: integer(dimensions.height, 'Height in millimeters', 1) }
 }
 if (value.taxCategory !== undefined) result.taxCategory = text(value.taxCategory, 'Tax category', 100)
 if (value.hsCode !== undefined) {
  const hsCode = text(value.hsCode, 'HS code', 10)
  if (!/^(?:\d{6}|\d{8}|\d{10})$/.test(hsCode)) fail('PRODUCT_DETAILS', 'HS code must contain 6, 8 or 10 digits.', 400)
  result.hsCode = hsCode
 }
 if (value.countryOfOrigin !== undefined) {
  const country = text(value.countryOfOrigin, 'Country of origin', 2)
  if (!/^[A-Z]{2}$/.test(country)) fail('PRODUCT_DETAILS', 'Country of origin must use two uppercase letters, such as US.', 400)
  result.countryOfOrigin = country
 }
 if (value.customFields !== undefined) {
  if (!Array.isArray(value.customFields) || value.customFields.length > 20) fail('PRODUCT_DETAILS', 'Use at most 20 custom fields.', 400)
  const seen = new Set<string>()
  const fields = value.customFields.map((input): CustomField => {
   const field = object(input, ['key', 'label', 'type', 'value'], 'Custom field')
   const key = text(field.key, 'Field key', 40), label = text(field.label, 'Field label', 80)
   if (!/^[a-z][a-z0-9_]*$/.test(key) || seen.has(key)) fail('PRODUCT_DETAILS', 'Field keys must be unique lowercase names using letters, digits and underscores.', 400)
   seen.add(key)
   if (field.type === 'text' && typeof field.value === 'string' && field.value.length <= 4000) return { key, label, type: 'text', value: field.value }
   if (field.type === 'number' && typeof field.value === 'number' && Number.isFinite(field.value)) return { key, label, type: 'number', value: field.value }
   if (field.type === 'boolean' && typeof field.value === 'boolean') return { key, label, type: 'boolean', value: field.value }
   return fail('PRODUCT_DETAILS', 'A custom field needs a text, finite number or boolean value matching its type.', 400)
  })
  if (fields.length) result.customFields = fields
 }
 return result
}
