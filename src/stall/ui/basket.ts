// The shopper's basket lives in this browser tab until checkout; the server re-prices every line.
export interface BasketLine { sku: string; quantity: number; personalization?: Record<string, string>; addOnCents?: number; detail?: string[] }
const key = 'stall-basket'
export function readBasket(): BasketLine[] {
  try { const lines: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]'); return Array.isArray(lines) ? lines.filter((line): line is BasketLine => typeof line?.sku === 'string' && Number.isSafeInteger(line.quantity)) : [] } catch { return [] }
}
export function writeBasket(lines: BasketLine[]) { try { sessionStorage.setItem(key, JSON.stringify(lines)) } catch { /* private browsing: the basket lasts until reload */ } }
