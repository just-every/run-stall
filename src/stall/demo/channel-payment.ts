// Mirrors Pier's channel-payment.ts: the connected demo shop attests to the
// payment evidence; recording it does not contact Stripe or move any stock.
export type ChannelPayment = { provider: 'stripe'; reference: string; amount: string; currency: 'USD'; paidAt: string; orderReference: string }
type PaymentOrder = { channel: string; total: string | null; channelPayment?: ChannelPayment }
const scale = 1000000000000n
const amount = (value: string) => {
 const [whole, fraction = ''] = value.split('.')
 return BigInt(whole) * scale + BigInt(fraction.padEnd(12, '0'))
}

// Pier retains twelve decimal places in extended quantity × unit-price totals.
export function orderTotal(lines: { quantity: string; price?: string }[]): string | null | undefined {
 const decimal = (value: unknown) => typeof value === 'string' && /^\d{1,10}(\.\d{1,6})?$/.test(value)
 if (lines.some(l => !decimal(l.quantity) || (l.price !== undefined && !decimal(l.price)))) return undefined
 if (lines.some(l => l.price === undefined)) return null
 const total = lines.reduce((sum, l) => sum + amount(l.quantity) * amount(l.price!) / scale, 0n)
 return `${total / scale}.${String(total % scale).padStart(12, '0')}`
}

export function recordChannelPayment(order: PaymentOrder, evidence: any): boolean {
 if (evidence === undefined) return true
 if (!evidence || order.channel !== 'stall' || evidence.provider !== 'stripe'
  || typeof evidence.reference !== 'string' || !/^pi_[A-Za-z0-9_]+$/.test(evidence.reference)
  || evidence.currency !== 'USD' || typeof evidence.amount !== 'string' || !/^\d+\.\d{2}$/.test(evidence.amount)
  || order.total === null || amount(evidence.amount) !== amount(order.total) || amount(evidence.amount) <= 0n
  || typeof evidence.paidAt !== 'string' || !Number.isFinite(Date.parse(evidence.paidAt))
  || typeof evidence.orderReference !== 'string' || !evidence.orderReference.trim() || evidence.orderReference.length > 2000) return false
 const payment: ChannelPayment = { provider: 'stripe', reference: evidence.reference, amount: evidence.amount, currency: 'USD', paidAt: evidence.paidAt, orderReference: evidence.orderReference.trim() }
 if (order.channelPayment && JSON.stringify(order.channelPayment) !== JSON.stringify(payment)) return false
 order.channelPayment = payment
 return true
}
