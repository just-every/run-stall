import { createFileRoute } from '@tanstack/react-router'
import { Shop } from '../stall/ui/shop'
import { storeStyles } from '../stall/ui/styles'
export const Route = createFileRoute('/shop')({ head: () => ({ meta: [{ title: 'Shop · Stall' }], links: storeStyles }), component: Shop })
