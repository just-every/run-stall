import { fail, text } from '../model'
import { listingState } from '../listing'
import { hourStart, type ViewRow } from './measure'

const crawler = /(?:bot|crawl|spider|slurp|preview|headless|lighthouse)/i

/** One aggregate count per published product and UTC hour. Crawlers are dropped; a Global Privacy Control or Do Not Track visit is counted apart and never enters conversion. */
export async function recordView(db: D1Database, request: Request, input: any) {
  const sku = text(input.sku, 'Product SKU', 100)
  if (crawler.test(request.headers.get('user-agent') ?? '')) return { counted: false }
  const row = await db.prepare('SELECT value_json FROM st_products WHERE id=?').bind(sku).first<{ value_json: string }>()
  if (!row || listingState(JSON.parse(row.value_json)) !== 'published') fail('NOT_FOUND', 'No such published product.', 404)
  const limited = request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1'
  await db.prepare('INSERT INTO st_product_views VALUES(?,?,?,?) ON CONFLICT(hour,sku) DO UPDATE SET views=views+excluded.views,limited=limited+excluded.limited').bind(hourStart(Date.now()).slice(0, 13), sku, limited ? 0 : 1, limited ? 1 : 0).run()
  return { counted: !limited, limited }
}
export async function productViews(db: D1Database, sku: string, from: string, to: string): Promise<ViewRow[]> {
  return (await db.prepare('SELECT hour,views,limited FROM st_product_views WHERE sku=? AND hour>=? AND hour<? ORDER BY hour').bind(sku, from.slice(0, 13), to.slice(0, 13)).all<ViewRow>()).results
}
