import { plainDescription } from './description';
import { Buffer } from 'node:buffer';
import { canonicalJson, sha256, type SourceBundle } from '../../modules/import-kit/src/d1/index';
import { boundedText, importError, stableId, validateProductValue } from './validation';
export const productCSVHeaders = ['Handle', 'Title', 'Body (HTML)', 'Variant SKU', 'Variant Price', 'Published'] as const;
export const defaultProductNamespace = 'shopify-products';
export const productImportMappingVersion = 'stall-shopify-products-v1';
export const productImportDestination = 'stall-products';
function parseCSV(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  const finishCell = () => { row.push(cell); cell = ''; closed = false; };
  const finishRow = () => { finishCell(); if (row.some(Boolean)) rows.push(row); row = []; if (rows.length > 201) importError('CSV_ROWS', 'Supply at most 200 products.'); };
  for (let n = input.startsWith('\uFEFF') ? 1 : 0; n < input.length; n++) {
    const ch = input[n];
    if (quoted) {
      if (ch === '"' && input[n + 1] === '"') { cell += '"'; n++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (ch === ',') finishCell();
    else if (ch === '\r' || ch === '\n') { if (ch === '\r' && input[n + 1] === '\n') n++; finishRow(); }
    else if (ch === '"' && !cell && !closed) quoted = true;
    else if (ch === '"' || closed) importError('CSV_QUOTES', 'A quoted field must end at a separator or line ending.');
    else cell += ch;
  }
  if (quoted) importError('CSV_QUOTES', 'Unclosed quoted CSV field.');
  if (cell || row.length || closed) finishRow();
  return rows;
}
function priceCents(value: string): number {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(value)) importError('CSV_PRICE', 'Variant Price must be a positive decimal with at most two decimal places and no currency symbol.');
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 1) importError('CSV_PRICE', 'Variant Price must be positive and fit safely in cents.');
  return cents;
}
export function productImportSource(csv: string, namespace = defaultProductNamespace): SourceBundle {
  stableId(namespace, 'namespace');
  if (typeof csv !== 'string' || csv.length > 256 * 1024) importError('CSV_SIZE', 'CSV must be UTF-8 text of at most 256 KiB.');
  const bytes = Buffer.from(csv, 'utf8');
  if (bytes.length > 256 * 1024 || bytes.toString('utf8') !== csv) importError('CSV_SIZE', 'CSV must be valid UTF-8 text of at most 256 KiB.');
  const rows = parseCSV(csv);
  const headers = rows.shift();
  if (headers?.length !== productCSVHeaders.length || productCSVHeaders.some((header, i) => header !== headers[i])) importError('CSV_HEADERS', `Use these exact headers in order: ${productCSVHeaders.join(',')}`);
  if (!rows.length) importError('CSV_EMPTY', 'Supply at least one product.');
  const skus = new Set<string>(), handles = new Set<string>();
  const hash = sha256(bytes), artifact = 'shopify-products.csv';
  const records = rows.map((cells, index) => {
    if (cells.length !== productCSVHeaders.length) importError('CSV_COLUMNS', `CSV row ${index + 2} must have six columns.`);
    const [handle, title, description, skuCell, price, published] = cells;
    boundedText(handle, 'Handle', 160);
    if (!/^[A-Za-z0-9-]+$/.test(handle)) importError('CSV_HANDLE', 'Handle must contain only letters, digits and dashes.');
    const sku = stableId(skuCell);
    if (skus.has(sku) || handles.has(handle)) importError('CSV_VARIANTS', 'Use one row per unique Handle and SKU. Multi-variant and image continuation rows are not supported.');
    if (!/^(true|false)$/i.test(published)) importError('CSV_PUBLISHED', 'Published must be TRUE or FALSE; both import as unpublished drafts.');
    skus.add(sku); handles.add(handle);
    const value = validateProductValue({ sku, name: title, description: plainDescription(description), unitCents: priceCents(price), active: false });
    return { namespace, kind: 'shopify-product', sourceId: sku, payload: value, payloadHash: sha256(canonicalJson(value)), artifactHash: hash, location: { artifact, row: index + 2 } };
  });
  return { records, diagnostics: [{ severity: 'warning', code: 'IMPORT_DRAFTS_ONLY', message: 'All imported products remain unpublished. A human must approve each product after Pier SKU validation.' }], artifacts: [{ name: artifact, sha256: hash, size: bytes.length, original: { status: 'available', base64: bytes.toString('base64') } }] };
}
