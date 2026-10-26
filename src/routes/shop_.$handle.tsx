import { createFileRoute } from '@tanstack/react-router'
import { productSeo } from '../stall/product-seo'
import { ProductPage } from '../stall/ui/product-page'
import { storeStyles } from '../stall/ui/styles'
export const Route = createFileRoute('/shop_/$handle')({ loader: ({ params }) => productSeo({ data: params.handle }), head: ({ loaderData }) => ({ meta: [{ title: loaderData?.title ?? 'Product · Stall' }, ...(loaderData?.description ? [{ name: 'description', content: loaderData.description }] : [])], links: storeStyles }), component: ProductPage })
