import { fail, text } from './model'
import { costCents, countryOfOrigin, dimensionsMm, hsCode, strictObject, weightGrams } from './facts'
import { listingFields, listingKeys, type Listing } from './listing'

export type CustomField = { key: string; label: string } & (
 { type: 'text'; value: string } | { type: 'number'; value: number } | { type: 'boolean'; value: boolean }
)
export type ProductDetails = Listing & {
 costCents?: number
 weightGrams?: number
 dimensionsMm?: { length: number; width: number; height: number }
 taxCategory?: string
 hsCode?: string
 countryOfOrigin?: string
 customFields?: CustomField[]
}
/** Merchant facts only: syntax checks do not establish a tax or customs ruling. */
export function productDetails(input: unknown): ProductDetails {
 const value = strictObject(input, ['costCents', 'weightGrams', 'dimensionsMm', 'taxCategory', 'hsCode', 'countryOfOrigin', 'customFields', ...listingKeys], 'Product details')
 const result: ProductDetails = listingFields(value)
 if (value.costCents !== undefined) result.costCents = costCents(value.costCents)
 if (value.weightGrams !== undefined) result.weightGrams = weightGrams(value.weightGrams)
 if (value.dimensionsMm !== undefined) result.dimensionsMm = dimensionsMm(value.dimensionsMm)
 if (value.taxCategory !== undefined) result.taxCategory = text(value.taxCategory, 'Tax category', 100)
 if (value.hsCode !== undefined) result.hsCode = hsCode(value.hsCode)
 if (value.countryOfOrigin !== undefined) result.countryOfOrigin = countryOfOrigin(value.countryOfOrigin)
 if (value.customFields !== undefined) {
  if (!Array.isArray(value.customFields) || value.customFields.length > 20) fail('PRODUCT_DETAILS', 'Use at most 20 custom fields.', 400)
  const seen = new Set<string>()
  const fields = value.customFields.map((input): CustomField => {
   const field = strictObject(input, ['key', 'label', 'type', 'value'], 'Custom field')
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
