import { env } from 'cloudflare:workers'
import type { Bindings } from '../auth.server'
import { products } from './store'
import { listingState } from './listing'
import { handleOf } from './listing-checks'
export async function publicProductSeo(handle: string) {
 const product = (await products((env as Bindings).DB)).find(entry => listingState(entry.value) === 'published' && handleOf(entry.value) === handle)
 return product ? { title: product.value.details?.seo?.title ?? product.value.name, description: product.value.details?.seo?.description ?? product.value.description } : { title: 'Product · Stall', description: '' }
}
