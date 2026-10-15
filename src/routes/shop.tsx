import { createFileRoute } from '@tanstack/react-router'
import { Shop } from '../stall/ui/shop'
export const Route = createFileRoute('/shop')({ head: () => ({ meta: [{ title: 'Shop · Stall' }], links: [{ rel: 'stylesheet', href: '/stall.css' }] }), component: Shop })
