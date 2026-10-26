import { Buffer } from 'node:buffer';
import { sha256 } from '../../modules/import-kit/src/provenance/identity.ts';
import { importError } from '../imports/validation.ts';

export type ReviewSource = 'judge-me' | 'yotpo' | 'okendo' | 'loox' | 'stamped' | 'shopify';
export type ParsedReview = {
  sourceId: string; productHandle?: string; productId?: string; sku?: string;
  rating: number; title: string; body: string; reviewerName: string; reviewerEmail: string;
  date: string; sourceVerified: boolean; reply: string; media: string[]; row: number;
};
type Field = 'id' | 'handle' | 'productId' | 'sku' | 'rating' | 'title' | 'body' | 'name' | 'email' | 'date' | 'verified' | 'reply' | 'publicReply' | 'images' | 'videos';
type Format = Partial<Record<Field, string[]>>;
type CSVRow = { cells: string[]; row: number };

// Headers are case insensitive; spaces, underscores and dashes are equivalent.
// Required: rating and body. Other columns may be omitted. Unknown columns are ignored.
// Judge.me: title, body, rating, review_date, reviewer_name, reviewer_email,
// product_id, product_handle, picture_urls, reply; optional id and verified.
// https://judge.me/help/en/articles/8236266-exporting-reviews
// https://judge.me/help/en/articles/8415368-importing-reviews-using-judge-me-template
// Yotpo: native export headers below, including semicolon-separated published media.
// https://support.yotpo.com/v1/docs/exporting-reviews-from-yotpo
// Okendo: documented template columns, including comma-separated imageUrls and videoUrls.
// https://support.okendo.io/en/articles/2057320-importing-reviews-using-the-okendo-import-template
// Loox: documented custom template plus legacy nickname, review, date, handle and img.
// https://support.loox.io/support/solutions/articles/501000162508-importing-reviews-using-a-custom-file
// Stamped and legacy Shopify Product Reviews accept the explicit common CSV columns:
// id, product_handle, product_id, sku, rating, title, body, author, email, created_at,
// verified, reply, image_urls. Stamped also accepts reviewRating, reviewMessage,
// reviewTitle, reviewDate, customerEmail and verifiedBuyer from mapped exports.
// Stamped's public export guide does not specify a stable CSV schema.
// https://stampedsupport.stamped.io/hc/en-us/articles/8839244356891-Managing-Reviews-Exporting-Reviews-Checkout-Comments-or-NPS
// Legacy Shopify documentation now redirects to Shop; this is the legacy CSV subset.
// https://help.shopify.com/en/manual/products/product-reviews/import-export-reviews
const common: Format = {
  id: ['id', 'review_id'], handle: ['product_handle'], productId: ['product_id'], sku: ['sku'],
  rating: ['rating'], title: ['title'], body: ['body'], name: ['author'], email: ['email'],
  date: ['created_at'], verified: ['verified'], reply: ['reply'], images: ['image_urls'],
};
const formats: Record<ReviewSource, Format> = {
  'judge-me': { ...common, name: ['reviewer_name'], email: ['reviewer_email'], date: ['review_date'], images: ['picture_urls'] },
  yotpo: {
    id: ['Review ID'], handle: ['Product Handle'], productId: ['Product ID'], sku: ['Product SKU'],
    rating: ['Review Score'], title: ['Review Title'], body: ['Review Content'], name: ['Reviewer Display Name'],
    email: ['Reviewer Email'], date: ['Review Creation Date'], verified: ['Reviewer Type'],
    reply: ['Comment Content'], publicReply: ['Comment Public'],
    images: ['Published Image URL', 'Published Image URLs'], videos: ['Published Video URL', 'Published Video URLs'],
  },
  okendo: {
    ...common, id: ['id', 'reviewId', 'uniqueHash'], handle: ['handle'], name: ['name'], date: ['dateCreated'],
    images: ['imageUrls'], videos: ['videoUrls'], verified: ['isVerifiedBuyer'], publicReply: ['replyIsPublic'],
  },
  loox: {
    ...common, handle: ['product_handle', 'handle'], body: ['body', 'review'], name: ['author', 'nickname'],
    date: ['created_at', 'date'], images: ['photo_url', 'img'], verified: ['verified_purchase', 'verified'],
  },
  stamped: {
    ...common, rating: ['rating', 'reviewRating'], title: ['title', 'reviewTitle'], body: ['body', 'reviewMessage'],
    date: ['created_at', 'reviewDate'], email: ['email', 'customerEmail'], verified: ['verified', 'verifiedBuyer'],
    images: ['image_urls', 'photoFilenames'], videos: ['videoFilenames'],
  },
  shopify: common,
};
const key = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/gu, '');
const fail = (code: string, row: number, message: string): never => importError(`REVIEW_${code}`, `Review CSV row ${row}: ${message}`);

function readCSV(csv: string): CSVRow[] {
  const rows: CSVRow[] = [];
  let cells: string[] = [], cell = '', quoted = false, closed = false, line = 1, start = 1;
  const finishCell = () => {
    cells.push(cell); cell = ''; closed = false;
    if (cells.length > 128) fail('COLUMNS', start, 'Supply at most 128 columns.');
  };
  const finishRow = () => {
    // Ignore physical empty lines, but never silently discard an explicit empty record.
    if (cell || cells.length || closed) { finishCell(); rows.push({ cells, row: start }); }
    cells = [];
    if (rows.length > 5001) fail('ROWS', start, 'Supply at most 5000 reviews.');
  };
  for (let i = csv.startsWith('\uFEFF') ? 1 : 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '\n' || (ch === '\r' && csv[i + 1] !== '\n')) line++;
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (ch === ',') finishCell();
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && csv[i + 1] === '\n') { i++; line++; }
      finishRow(); start = line;
    } else if (ch === '"' && !cell && !closed) quoted = true;
    else if (ch === '"' || closed) fail('QUOTES', start, 'A quoted field must end at a comma or line ending.');
    else cell += ch;
    if (cell.length > 65536) fail('FIELD', start, 'A field exceeds 65536 characters.');
  }
  if (quoted) fail('QUOTES', start, 'A quoted field is not closed.');
  finishRow();
  return rows;
}

function checkedDate(value: string, row: number): string {
  if (!value) return '';
  const validDay = (year: number, month: number, day: number) => {
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  };
  const invalid = (): never => fail('DATE', row, 'Invalid review date. Use an ISO date or timestamp.');
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(?: ?(UTC|Z|[+-]\d{2}:?\d{2}))?)?$/i.exec(value);
  if (iso) {
    if (!validDay(+iso[1], +iso[2], +iso[3])) invalid();
    if (!iso[4]) return value;
    if (+iso[4] > 23 || +iso[5] > 59 || +(iso[6] ?? 0) > 59) invalid();
    const zone = iso[8]?.toUpperCase().replace('UTC', 'Z');
    if (zone && zone !== 'Z') {
      const digits = zone.replace(':', '');
      if (+digits.slice(1, 3) > 23 || +digits.slice(3, 5) > 59) invalid();
    }
    const time = `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}:${iso[6] ?? '00'}${iso[7] ?? ''}`;
    // An absent timezone stays absent; never invent UTC for a local timestamp.
    return time + (zone ? zone === 'Z' ? zone : `${zone.slice(0, 3)}:${zone.replace(':', '').slice(3)}` : '');
  }
  const local = /^(\d{1,2})([/-])(\d{1,2})\2(\d{4})$/.exec(value);
  if (local) {
    const a = +local[1], b = +local[3], year = +local[4];
    const dmy = validDay(year, b, a), mdy = validDay(year, a, b);
    if (!dmy && !mdy) invalid();
    if (dmy && mdy && a !== b) return value;
    const month = dmy ? b : a, day = dmy ? a : b;
    return `${local[4]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return invalid();
}

function booleanValue(value: string, row: number, field: string): boolean {
  if (!value || /^(false|no|0)$/i.test(value)) return false;
  if (/^(true|yes|1)$/i.test(value)) return true;
  return fail('BOOLEAN', row, `${field} must be true, false, yes, no, 1, 0 or blank.`);
}
function mediaURLs(value: string, row: number, source: ReviewSource): string[] {
  if (!value) return [];
  const urls = value.split(source === 'yotpo' ? ';' : ',').map(part => part.trim());
  if (urls.length > 20) fail('MEDIA', row, 'Supply at most 20 media URLs per review.');
  for (const url of urls) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return fail('MEDIA', row, 'Every media reference must be an absolute HTTP or HTTPS URL.'); }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || url.length > 2048 || /\s/u.test(url))
      fail('MEDIA', row, 'Every media reference must be an absolute HTTP or HTTPS URL without credentials or whitespace.');
  }
  return urls;
}

/** Pure bounded CSV import. No URL is fetched. Date ambiguity is retained as text.
 * Native IDs take precedence; missing IDs hash immutable review content and product
 * references, excluding row order, replies, verification and media. Duplicate IDs fail.
 * Source verification is historical evidence only. It never proves a Stall purchase.
 * Unknown columns never imply verification. Private replies and unpublished media
 * are deliberately omitted because the result has no visibility metadata. */
export function parseReviews(csv: string, source: ReviewSource): ParsedReview[] {
  if (!Object.prototype.hasOwnProperty.call(formats, source)) importError('REVIEW_SOURCE', 'Choose a supported review source.');
  if (typeof csv !== 'string' || csv.length > 2 * 1024 * 1024) importError('REVIEW_SIZE', 'Supply UTF-8 CSV text of at most 2 MiB.');
  const bytes = Buffer.from(csv, 'utf8');
  if (bytes.length > 2 * 1024 * 1024 || bytes.toString('utf8') !== csv || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(csv))
    importError('REVIEW_SIZE', 'Supply valid UTF-8 CSV text of at most 2 MiB without control characters.');
  const rows = readCSV(csv), header = rows.shift();
  if (!header) importError('REVIEW_EMPTY', 'Supply review CSV headers and at least one review.');
  const headers = header.cells.map(key);
  if (headers.some(name => !name) || new Set(headers).size !== headers.length)
    fail('HEADERS', header.row, 'Column headers must be nonempty and unique.');
  const format = formats[source], columns = new Map<Field, number>();
  for (const [field, names] of Object.entries(format) as [Field, string[]][]) {
    const matches = [...new Set(names.map(name => headers.indexOf(key(name))).filter(index => index >= 0))];
    if (matches.length > 1) fail('HEADERS', header.row, `Multiple columns map to ${field}. Supply one.`);
    if (matches.length) columns.set(field, matches[0]);
  }
  for (const field of ['rating', 'body'] as const) {
    if (!columns.has(field)) fail('HEADERS', header.row, `Missing ${field} column. Expected ${format[field]!.join(' or ')}.`);
  }
  if (!rows.length) importError('REVIEW_EMPTY', 'Supply at least one review after the headers.');
  const ids = new Map<string, number>();
  return rows.map(({ cells, row }) => {
    if (cells.length !== headers.length) fail('COLUMNS', row, `Expected ${headers.length} columns; found ${cells.length}.`);
    const get = (field: Field, max: number, trim = true) => {
      const index = columns.get(field), raw = index === undefined ? '' : cells[index];
      if (raw.length > max) fail('FIELD', row, `${field} exceeds ${max} characters.`);
      return trim ? raw.trim() : raw;
    };
    const score = get('rating', 16);
    if (!/^[1-5](?:\.0+)?$/.test(score)) fail('RATING', row, 'Rating must be a whole number from 1 through 5.');
    const rating = Number(score), title = get('title', 1000, false), body = get('body', 20000, false);
    if (!body.trim()) fail('BODY', row, 'Review body must contain text.');
    const productHandle = get('handle', 200), productId = get('productId', 300), sku = get('sku', 200);
    if ([productHandle, productId, sku, get('id', 300)].some(value => /[\t\r\n]/u.test(value)))
      fail('IDENTITY', row, 'Review and product identifiers must fit on one line without tabs.');
    const reviewerName = get('name', 300), reviewerEmail = get('email', 320);
    if (reviewerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(reviewerEmail)) fail('EMAIL', row, 'Reviewer email is invalid. Leave it blank if unavailable.');
    const date = checkedDate(get('date', 100), row), verified = get('verified', 100);
    let sourceVerified: boolean;
    if (source === 'yotpo') {
      if (verified && !/^(anonymous|verified reviewer|verified buyer)$/i.test(verified)) fail('BOOLEAN', row, 'Reviewer Type must be Anonymous, Verified Reviewer or Verified Buyer.');
      sourceVerified = /^verified buyer$/i.test(verified);
    } else sourceVerified = booleanValue(verified, row, 'Source verification');
    const publicReply = get('publicReply', 16), replyText = get('reply', 20000, false);
    const reply = columns.has('publicReply') && !booleanValue(publicReply, row, 'Reply visibility') ? '' : replyText;
    const media = [...mediaURLs(get('images', 45000), row, source), ...mediaURLs(get('videos', 45000), row, source)];
    if (media.length > 20) fail('MEDIA', row, 'Supply at most 20 media URLs per review.');
    const sourceId = get('id', 300) || `content-${sha256(JSON.stringify([source, productHandle, productId, sku, rating, title, body.replace(/\r\n?/g, '\n'), reviewerName, reviewerEmail.toLowerCase(), date]))}`;
    const first = ids.get(sourceId);
    if (first !== undefined) fail('DUPLICATE', row, `Duplicate source review identity; first seen on row ${first}.`);
    ids.set(sourceId, row);
    return { sourceId, ...(productHandle ? { productHandle } : {}), ...(productId ? { productId } : {}), ...(sku ? { sku } : {}), rating, title, body, reviewerName, reviewerEmail, date, sourceVerified, reply, media, row };
  });
}
