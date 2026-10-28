import { catalogSource } from './catalog';
import { plainDescription } from './description';
import { Buffer } from 'node:buffer';
import { canonicalJson, sha256, type SourceBundle } from '../../modules/import-kit/src/d1/index';
import { boundedText, importError, stableId, validateProductValue } from './validation';
export const productCSVHeaders = ['Handle', 'Title', 'Body (HTML)', 'Variant SKU', 'Variant Price', 'Published'] as const;
export const defaultProductNamespace = 'shopify-products';
export const legacyProductMappingVersion = 'stall-shopify-products-v1';
export const preservedProductMappingVersion = 'stall-shopify-products-v2';
export const rejectedProductMappingVersion = 'stall-shopify-products-v3';
export const metadataProductMappingVersion = 'stall-shopify-products-v4';
export const productImportMappingVersion = 'stall-catalog-v5';
export const productDetailsHeader = 'Stall Details';
export const supportedProductMappings = [legacyProductMappingVersion, preservedProductMappingVersion, rejectedProductMappingVersion, metadataProductMappingVersion, productImportMappingVersion] as const;
export const productImportDestination = 'stall-products';
type CSVRow = { cells: string[]; row: number };
export function parseCSV(input: string, preserveEmptyFields = false): CSVRow[] {
  const rows: CSVRow[] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  let line = 1, rowStart = 1;
  const finishCell = () => { row.push(cell); cell = ''; closed = false; };
  const finishRow = () => {
    const explicitFields = row.length > 0 || closed;
    finishCell();
    if (row.some(Boolean) || (preserveEmptyFields && explicitFields)) rows.push({ cells: row, row: rowStart });
    row = [];
    if (rows.length > 201) importError('CSV_ROWS', 'Supply at most 200 products.');
  };
  for (let n = input.startsWith('\uFEFF') ? 1 : 0; n < input.length; n++) {
    const ch = input[n];
    if (ch === '\r' || (ch === '\n' && input[n - 1] !== '\r')) line++;
    if (quoted) {
      if (ch === '"' && input[n + 1] === '"') { cell += '"'; n++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (ch === ',') finishCell();
    else if (ch === '\r' || ch === '\n') { if (ch === '\r' && input[n + 1] === '\n') n++; finishRow(); rowStart = line; }
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
// Ambiguous source identities refuse the entire file even when another value
// in one of those rows is invalid. Only syntactically valid identities count.
function checkSourceIdentities(rows: CSVRow[], columns: number) {
  const skus = new Set<string>(), handles = new Set<string>();
  for (const { cells, row } of rows) {
    if (cells.length !== columns) importError('CSV_COLUMNS', `CSV row ${row} must have ${columns} columns.`);
    const handle = cells[0], sku = cells[3];
    if ((/^[A-Za-z0-9-]{1,160}$/.test(handle) && handles.has(handle)) ||
        (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(sku) && skus.has(sku)))
      importError('CSV_VARIANTS', 'Use one row per unique Handle and SKU. Multi-variant and image continuation rows are not supported.');
    if (/^[A-Za-z0-9-]{1,160}$/.test(handle)) handles.add(handle);
    if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(sku)) skus.add(sku);
  }
}
const rowValueErrors = new Set(['PRODUCT_FIELD', 'PRODUCT_ID', 'PRODUCT_VALUE', 'PRODUCT_DESCRIPTION', 'PRODUCT_PRICE', 'PRODUCT_PUBLICATION', 'CSV_HANDLE', 'CSV_PRICE', 'CSV_PUBLISHED', 'PRODUCT_DETAILS']);
export function productImportSource(csv: string, namespace = defaultProductNamespace, mappingVersion: string = productImportMappingVersion): SourceBundle {
  stableId(namespace, 'namespace');
  if (!supportedProductMappings.some(version => version === mappingVersion)) importError('IMPORT_MAPPING', 'Unsupported product import mapping version.');
  const preserveRejected = [productImportMappingVersion, metadataProductMappingVersion, rejectedProductMappingVersion].includes(mappingVersion);
  if (typeof csv !== 'string' || csv.length > 256 * 1024) importError('CSV_SIZE', 'CSV must be UTF-8 text of at most 256 KiB.');
  const bytes = Buffer.from(csv, 'utf8');
  if (bytes.length > 256 * 1024 || bytes.toString('utf8') !== csv) importError('CSV_SIZE', 'CSV must be valid UTF-8 text of at most 256 KiB.');
  const rows = parseCSV(csv, preserveRejected);
  const headers = rows.shift()?.cells;
  if (mappingVersion === productImportMappingVersion && headers?.join(',') === 'Record Type,ID,Value') return catalogSource(csv, namespace, rows);
  const withDetails = [productImportMappingVersion, metadataProductMappingVersion].includes(mappingVersion) && headers?.length === 7 && headers[6] === productDetailsHeader;
  if (!headers || (headers.length !== productCSVHeaders.length && !withDetails) || productCSVHeaders.some((header, i) => header !== headers[i])) importError('CSV_HEADERS', `Use these exact headers in order: ${productCSVHeaders.join(',')}; optionally append ${productDetailsHeader}.`);
  if (!rows.length) importError('CSV_EMPTY', 'Supply at least one product.');
  if (preserveRejected) checkSourceIdentities(rows, headers.length);
  const skus = new Set<string>(), handles = new Set<string>();
  const hash = sha256(bytes), artifact = 'shopify-products.csv';
  const records: SourceBundle['records'] = rows.map(({ cells, row }, index) => {
    const sourceRow = preserveRejected ? row : index + 2;
    if (cells.length !== headers.length) importError('CSV_COLUMNS', `CSV row ${sourceRow} must have ${headers.length} columns.`);
    const [handle, title, description, skuCell, price, published] = cells;
    try {
      boundedText(handle, 'Handle', 160);
      if (!/^[A-Za-z0-9-]+$/.test(handle)) importError('CSV_HANDLE', 'Handle must contain only letters, digits and dashes.');
      const sku = stableId(skuCell);
      if (skus.has(sku) || handles.has(handle)) importError('CSV_VARIANTS', 'Use one row per unique Handle and SKU. Multi-variant and image continuation rows are not supported.');
      if (!/^(true|false)$/i.test(published)) importError('CSV_PUBLISHED', 'Published must be TRUE or FALSE; both import as unpublished drafts.');
      skus.add(sku); handles.add(handle);
      let details: unknown;
      if (withDetails) {
        try { details = JSON.parse(cells[6]); }
        catch { importError('PRODUCT_DETAILS', 'Stall Details must contain a JSON object; use {} to clear optional details.'); }
      }
      const value = validateProductValue({ sku, name: title, description: plainDescription(description), unitCents: priceCents(price), active: false, ...(withDetails ? { details } : {}) }, withDetails);
      return { namespace, kind: 'shopify-product', sourceId: sku, payload: value, payloadHash: sha256(canonicalJson(value)), artifactHash: hash, location: { artifact, row: sourceRow } };
    } catch (error) {
      if (!preserveRejected || !(error instanceof Error) || !('code' in error) || typeof error.code !== 'string' || !rowValueErrors.has(error.code)) throw error;
      const payload = { rejection: error.message, fields: cells };
      return { namespace, kind: 'shopify-product-rejected', sourceId: `csv-row-${sourceRow}`, payload, payloadHash: sha256(canonicalJson(payload)), artifactHash: hash, location: { artifact, row: sourceRow } };
    }
  });
  return { records, diagnostics: [...(withDetails ? [{ severity: 'warning' as const, code: 'IMPORT_DETAILS_REPLACEMENT', message: 'Stall Details replaces all optional details on each valid row, including any pending native details. Review the complete before-image; {} clears them. Tax and customs facts are not provider verified.' }] : []), { severity: 'warning', code: 'IMPORT_DRAFTS_ONLY', message: 'All imported products remain unpublished. A human must approve each product after Pier SKU validation.' }], artifacts: [{ name: artifact, sha256: hash, size: bytes.length, original: { status: 'available', base64: bytes.toString('base64') } }] };
}
