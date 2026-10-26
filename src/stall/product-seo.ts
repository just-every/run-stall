import { createServerFn } from '@tanstack/react-start'

/** A public projection: unpublished revisions never enter document metadata. */
export const productSeo = createServerFn({ method: 'GET' })
 .inputValidator((handle: string) => typeof handle === 'string' && handle.length <= 100 ? handle : '')
 .handler(async ({ data }) => {
  const { publicProductSeo } = await import('./product-seo.server')
  return publicProductSeo(data)
 })
