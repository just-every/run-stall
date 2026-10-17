import { createFileRoute } from '@tanstack/react-router'
import { Chrome, Section } from '../stall/ui/primitives'
import { storeStyles } from '../stall/ui/styles'
export const Route = createFileRoute('/order')({ head: () => ({ meta: [{ title: 'Order · Stall' }], links: storeStyles }), component: () => <div className="st-app st-store"><Chrome /><main id="main" className="st-store-main st-store-narrow"><Section title="Thanks for visiting the checkout"><p>Returning from Stripe does not confirm payment. The shop will verify the payment with Stripe before preparing your order.</p><p>If payment was canceled, you can return to the shop and try again.</p><a href="/shop">Return to the shop</a></Section></main></div> })
