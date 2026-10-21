import { createFileRoute } from '@tanstack/react-router'
import { ProductPage } from '../stall/ui/product-page'
import { storeStyles } from '../stall/ui/styles'
export const Route = createFileRoute('/shop_/$handle')({ head: () => ({ meta: [{ title: 'Product · Stall' }], links: storeStyles }), component: ProductPage })
