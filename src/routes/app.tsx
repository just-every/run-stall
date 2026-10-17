import { createFileRoute } from '@tanstack/react-router'
import { ShopDesk } from '../stall/ui/app'
import { deskStyles } from '../stall/ui/styles'
export const Route = createFileRoute('/app')({ head: () => ({ meta: [{ title: 'Shop desk · Stall' }], links: deskStyles }), component: ShopDesk })
