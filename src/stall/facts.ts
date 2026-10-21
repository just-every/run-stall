import { fail, integer, text } from './model'

export function strictObject(value: unknown, keys: string[], name: string): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
  fail('PRODUCT_DETAILS', `${name} must use only its documented fields.`, 400)
 return value as Record<string, unknown>
}
export const costCents = (value: unknown) => integer(value, 'Cost cents')
export const weightGrams = (value: unknown) => integer(value, 'Weight in grams', 1)
export function dimensionsMm(value: unknown) {
 const dimensions = strictObject(value, ['length', 'width', 'height'], 'Dimensions')
 return { length: integer(dimensions.length, 'Length in millimeters', 1), width: integer(dimensions.width, 'Width in millimeters', 1), height: integer(dimensions.height, 'Height in millimeters', 1) }
}
export function hsCode(value: unknown) {
 const code = text(value, 'HS code', 10)
 if (!/^(?:\d{6}|\d{8}|\d{10})$/.test(code)) fail('PRODUCT_DETAILS', 'HS code must contain 6, 8 or 10 digits.', 400)
 return code
}
export function countryOfOrigin(value: unknown) {
 const country = text(value, 'Country of origin', 2)
 if (!/^[A-Z]{2}$/.test(country)) fail('PRODUCT_DETAILS', 'Country of origin must use two uppercase letters, such as US.', 400)
 return country
}
