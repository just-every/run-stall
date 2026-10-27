import { recordAnalytics } from './analytics-events'
// The shopper's basket lives in this browser tab until checkout; the server re-prices every line.
export interface BasketLine { sku: string; quantity: number; personalization?: Record<string, string>; addOnCents?: number; detail?: string[] }
const key = 'stall-basket'
export function readBasket(): BasketLine[] {
  try { const lines: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]'); return Array.isArray(lines) ? lines.filter((line): line is BasketLine => typeof line?.sku === 'string' && Number.isSafeInteger(line.quantity)) : [] } catch { return [] }
}
export function writeBasket(lines: BasketLine[]) { const previous=readBasket(); try { sessionStorage.setItem(key, JSON.stringify(lines)); for(const line of lines)if(line.quantity>(previous.find(old=>old.sku===line.sku)?.quantity??0))void recordAnalytics('add_to_cart',line.sku) } catch { /* private browsing: the basket lasts until reload */ } }
