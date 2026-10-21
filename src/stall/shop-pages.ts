import type { Bindings } from '../auth.server'
import { handleOf } from './listing-checks'
import { listingState } from './listing'
import { products } from './store'

/** An unknown or unpublished product handle is a real 404 document, not a 200 page that says so. */
export async function unknownProductPage(request: Request, env: Bindings): Promise<boolean> {
 const match = request.method === 'GET' && /^\/shop\/([^/]+)\/?$/.exec(new URL(request.url).pathname)
 if (!match) return false
 let handle: string
 try { handle = decodeURIComponent(match[1]) } catch { return true }
 return !(await products(env.DB).catch(() => [])).some(product => listingState(product.value) === 'published' && handleOf(product.value) === handle)
}
