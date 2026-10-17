import { createFileRoute } from '@tanstack/react-router'
import { OrderReturn } from '../stall/ui/order-return'
import { storeStyles } from '../stall/ui/styles'
export const Route = createFileRoute('/order')({ head: () => ({ meta: [{ title: 'Order · Stall' }], links: storeStyles }), component: OrderReturn })
