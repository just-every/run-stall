import { createFileRoute } from '@tanstack/react-router'
import { ShopDesk } from '../stall/ui/app'
export const Route = createFileRoute('/app')({ head: () => ({ meta: [{ title: 'Shop desk · Stall' }], links: [{ rel: 'stylesheet', href: '/stall.css' }] }), component: ShopDesk })
