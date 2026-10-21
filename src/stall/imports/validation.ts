import { productDetails, type ProductDetails } from '../product-details';
export type ProductValue = { details?: ProductDetails; sku: string; name: string; description: string; unitCents: number; active: boolean };
export function importError(code: string, message: string): never {
  throw Object.assign(new Error(message), { code, status: code === 'FORBIDDEN' ? 403 : code === 'IMPORT_JOB_NOT_FOUND' ? 404 : 409 });
}
export function boundedText(value: unknown, field: string, max = 160): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value))
    importError('PRODUCT_FIELD', `${field} must be nonempty, trimmed text of at most ${max} characters.`);
  return value;
}
export function stableId(value: unknown, field = 'sku'): string {
  const result = boundedText(value, field, 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result))
    importError('PRODUCT_ID', `${field} must use letters, digits, dot, underscore, colon or dash.`);
  return result;
}
export function validateProductValue(input: unknown, allowDetails = false): ProductValue {
  if (!input || typeof input !== 'object' || Array.isArray(input)) importError('PRODUCT_VALUE', 'Supply a product object.');
  const value = input as Record<string, unknown>;
  const keys = ['sku', 'name', 'description', 'unitCents', 'active'];
  if (Object.keys(value).some(key => !keys.includes(key) && !(allowDetails && key === 'details')) || keys.some(key => !(key in value))) importError('PRODUCT_VALUE', 'Use exactly the documented product fields.');
  const sku = stableId(value.sku), name = boundedText(value.name, 'name');
  if (typeof value.description !== 'string' || value.description.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.description)) importError('PRODUCT_DESCRIPTION', 'Description must contain at most 4000 characters of text.');
  if (typeof value.unitCents !== 'number' || !Number.isSafeInteger(value.unitCents) || value.unitCents < 1 || value.unitCents > 100000000) importError('PRODUCT_PRICE', 'Price must be an integer from 1 through 100000000 cents.');
  if (value.active !== false) importError('PRODUCT_PUBLICATION', 'Imports must stage unpublished products. Approve publication separately after Pier validation.');
  let details: ProductDetails | undefined;
  if ('details' in value) {
    try { details = productDetails(value.details); }
    catch (error) { importError('PRODUCT_DETAILS', error instanceof Error ? error.message : 'Invalid product details.'); }
  }
  return { ...(details && Object.keys(details).length ? { details } : {}), sku, name, description: value.description, unitCents: value.unitCents, active: false };
}
