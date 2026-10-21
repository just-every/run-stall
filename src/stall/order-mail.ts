import type { Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { readOrder, saveOrder } from './store'
import { shopCurrency, type Line, type Order } from './model'

const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: shopCurrency.toUpperCase() }).format(cents / 100)
export const lineDetail = (line: Line) => [...(line.variant ? [Object.entries(line.variant).map(([name, value]) => `${name}: ${value}`).join(', ')] : []),
 ...(line.personalization ?? []).map(answer => `${answer.label}: ${answer.value}${answer.addOnCents ? ` (+${usd(answer.addOnCents)} each)` : ''}`)]
/** One plain-text confirmation once payment is verified. Durable outbox, delivery and bounce evidence belong to MAIL-001. */
export function confirmationText(order: Order) {
 return ['Thank you. Your payment is confirmed.', '', ...order.lines.flatMap(line => [`${line.quantity} × ${line.name} — ${usd(line.quantity * line.unitCents)}`, ...lineDetail(line).map(detail => `   ${detail}`)]),
  '', `Shipping: ${usd(order.shippingCents ?? 0)}`, `Total: ${usd(order.totalCents)}`].join('\n')
}
export async function sendConfirmation(env: Bindings, order: Order): Promise<Order> {
 if (order.confirmation || order.erasedAt || !order.customerEmail) return order
 let status: 'sent' | 'failed' = 'failed'
 try {
  const sender = operatorMail(env)
  if (sender && env.MAIL_FROM) {
   const text = confirmationText(order), html = `<pre style="font:inherit;white-space:pre-wrap">${text.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)}</pre>`
   const result = await sender.send({ deliveryId: `stall-confirmation-${order.id}`, from: env.MAIL_FROM, to: [order.customerEmail], subject: 'Your order is confirmed', text, html, headers: { 'Auto-Submitted': 'auto-generated' } })
   if (result.status === 'accepted' || result.status === 'development') status = 'sent'
  }
 } catch { /* The order stays paid; the recorded status shows the notice did not go out. */ }
 try { return await saveOrder(env, { ...order, confirmation: { status, at: new Date().toISOString() } }, status === 'sent' ? 'confirmation.sent' : 'confirmation.failed') }
 catch { return readOrder(env.DB, order.id) }
}
