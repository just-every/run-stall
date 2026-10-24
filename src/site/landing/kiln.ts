// The homepage's one story: Fog & Clay, a ceramics studio in Asheville, North
// Carolina, through one kiln batch in October 2026. Every section reads its
// records from here, so an order, a mug or a dollar figure is the same
// wherever it appears. Weekdays follow the 2026 calendar; times are Eastern,
// 12-hour. All money is USD cents. North Carolina taxes shipping, so its tax
// is on items after the discount plus shipping.

export const usd = (cents: number) => `${cents < 0 ? '−' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
/** Whole dollars, as a storefront prints them: $38. */
export const dollars = (cents: number) => usd(cents).replace('.00', '')
/** A separator that never starts or ends a line: no-break spaces on both sides. */
export const SEP = '\u00a0·\u00a0'
/** Words that stay on one line together: their spaces become no-break spaces. */
const nb = (words: string) => words.replaceAll(' ', '\u00a0')
/** A record ID that never breaks at its hyphen (U+2011, the non-breaking hyphen): R‑0031, #4931‑R. */
const nbId = (id: string) => id.replaceAll('-', '\u2011')

export const shop = { name: 'Fog & Clay', domain: 'fogandclay.com', shopify: 'fogandclay.myshopify.com' }

export type Glaze = 'fog' | 'speckle' | 'cobalt'
/** Kiln batch 12: three mugs, one glaze and one photo each; stock as listed. */
export const mugs: Record<Glaze, { name: string; price: number; stock: number; weight: string }> = {
  fog: { name: 'Fog mug', price: 3800, stock: 16, weight: '0.9 lb' },
  speckle: { name: 'Speckle mug', price: 3800, stock: 24, weight: '0.9 lb' },
  cobalt: { name: 'Cobalt mug', price: 4200, stock: 8, weight: '0.9 lb' },
}
export const glazes: Glaze[] = ['fog', 'speckle', 'cobalt']

/** The hero's shop page on the booth wall, Tuesday afternoon: three Fog mugs left (08). */
export const heroMug = { glaze: 'fog' as Glaze, left: 3 }

// 02 · Sunday, Oct 11: the move from Shopify. Shopify numbers orders from
// #1001, so the 3,906 imported orders end at #4906.
export const imported = [
  { label: 'Products', count: 86 },
  { label: 'Variants', count: 241 },
  { label: 'Customers', count: 1412 },
  { label: 'Orders', count: 3906 },
  { label: 'Gift cards', count: 37 },
  { label: 'Redirects', count: 212 },
]
export const importFix = { noWeight: 4, setTo: '0.9 lb', took: '6 min 12 s' }
// The one start line every Run Edit Run page shows, and the alternative for people who already have Node.
export const startLine = 'curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-stall'
export const npxLine = 'npx -y @runeditrun/rer dev just-every/run-stall'

// 03 · Friday, Oct 16, 9:40 PM: the batch is listed and scheduled.
export const batch = { name: 'Kiln batch 12', channels: ['Online store', 'Google Shopping', 'Instagram'], publishes: `Publishes Fri, Oct\u00a016${SEP}10:00\u00a0PM\u00a0ET` }

// 04 · Friday 10:00 PM: the drop opens. Opening-minute stock (a few mugs are
// already in held checkouts), and Ana P.'s checkout, the drop's first order.
export const opening: Record<Glaze, number> = { fog: 15, speckle: 22, cobalt: 7 }
const FIRSTFIRE = 0.1
const NC_RATE = 0.07
function ncOrder(lines: number, shipping: number) {
  const discount = Math.round(lines * FIRSTFIRE)
  const tax = Math.round((lines - discount + shipping) * NC_RATE)
  return { lines, discount, shipping, tax, total: lines - discount + shipping + tax }
}
export const checkout = { glaze: 'speckle' as Glaze, code: 'FIRSTFIRE', service: 'USPS Ground Advantage', taxLabel: 'Sales tax\u00a0·\u00a0NC 7.00%', held: '9:12', ...ncOrder(mugs.speckle.price, 685) }

// 05 · Friday 10:43 PM: Dana R.'s cart, and the night's recovery figures.
// A product name, a count with its words and a separator with its neighbours never break apart.
export const danaCart = [
  { time: '10:31 PM', text: `${nb('Dana R.')}${SEP}${nb('Cobalt mug')} and ${nb('Fog mug held')}`, kind: 'step' },
  { time: '10:41 PM', text: `Hold expired${SEP}Cobalt back ${nb('to 1 left')}`, kind: 'alert' },
  { time: '10:43 PM', text: `${nb('Theo M.')} bought the last Cobalt${SEP}${nb('sold out')}`, kind: 'done' },
  { time: '11:00 PM', text: `Note sent to Dana${SEP}Fog still in ${nb('her cart')}`, kind: 'done' },
] as const
export const recovery = { left: 14, back: 6, cents: 26140 }

// 06 · Overnight: 38 orders; the reader shows a Fog and a Cobalt mug to Black
// Mountain, NC (Buncombe County, 7.00%) with FIRSTFIRE, USPS Ground Advantage at 2.8 lb.
export const overnight = { orders: 38, ...ncOrder(mugs.fog.price + mugs.cobalt.price, 875) }

// 07 · Saturday, Oct 17, 8:00 AM: the label run. The drop's orders are numbered
// from #4907 in the order they were paid; Theo's last Cobalt (10:43 PM) is #4931.
export const labels = [
  { order: 4907, to: 'Ana P., Asheville\u00a0NC', items: 'Speckle mug', weight: '1.4 lb', service: 'USPS Ground Advantage', cents: 685 },
  { order: 4912, to: 'June K., Portland\u00a0OR', items: 'Fog mug', weight: '1.4 lb', service: 'USPS Ground Advantage', cents: 740 },
  { order: 4918, to: 'Sam L., Brooklyn\u00a0NY', items: 'Fog mug', weight: '1.4 lb', service: 'USPS Ground Advantage', cents: 710, fix: { was: '14 Elm St, Apt ?', now: 'Apt 3B\u00a0·\u00a0USPS verified' } },
  { order: 4925, to: 'Maya R., Denver\u00a0CO', items: 'Speckle mug × 3', weight: '4.1 lb', service: 'USPS Priority Mail', cents: 1295 },
  { order: 4931, to: 'Theo M., Austin\u00a0TX', items: 'Cobalt mug', weight: '1.4 lb', service: 'UPS Ground', cents: 912 },
]
export const labelRun = { day: 'Sat, Oct\u00a017', count: 38, cents: 28165 }

// 08 · Tuesday, Oct 20, 2:14 PM: Theo's Cobalt arrives broken. The agent offers
// the Fog mug (Cobalt is sold out) and the $4.00 difference back.
const theo = labels[4]
export const reship = { order: nbId(`${theo.order}-R`), label: 725, refund: mugs.cobalt.price - mugs.fog.price, claim: mugs.cobalt.price }
// Each row is one line wherever the log is drawn at full size. Where a phone wraps a row, it breaks only between the
// groups below: every "·" stays mid-line between its neighbours, and no amount, name or last word is left alone.
export const agentLog = [
  { time: '2:14 PM', text: `UPS exception: ${nb('damaged in transit')}`, kind: 'alert' },
  { time: '2:15 PM', text: `Checked stock: Cobalt ${nb('sold out')}${SEP}${nb(`Fog ${heroMug.left} left`)}`, kind: 'step' },
  { time: '2:16 PM', text: `Asked Theo: ${nb('a Fog mug')} today ${nb(`and ${usd(reship.refund)} back,`)} ${nb(`or a ${usd(mugs.cobalt.price)} refund?`)}`, kind: 'step' },
  { time: '2:31 PM', text: nb('Theo: Fog please!'), kind: 'reply' },
  { time: '2:32 PM', text: `You tapped ${nb('Ship it')}${SEP}replacement, ${nb(`${usd(reship.refund)} refund`)} ${nb('and claim')}`, kind: 'you' },
  { time: '2:33 PM', text: `${nb(`Replacement #${reship.order}`)}${SEP}USPS ${nb(`label ${usd(reship.label)}`)}${SEP}shipped`, kind: 'done' },
  { time: '2:34 PM', text: `UPS damage claim filed${SEP}${usd(reship.claim)}`, kind: 'done' },
] as const
export const theoOrder = { order: theo.order, name: 'Theo M.', city: 'Austin TX 78704' }

// 09 · June K.'s return: delivered Thursday, Oct 22; returned the next week.
export const juneReturn = {
  order: labels[1].order, delivered: 'Oct 22', reason: 'Changed my mind', card: 'Visa •• 1881', id: nbId('R-0031'), refund: mugs.fog.price, stripe: 're_3Q8x',
  steps: [
    { title: 'Label emailed', detail: 'Oct 27' },
    { title: 'Received', detail: 'Oct 30' },
    { title: 'Inspected', detail: 'Fog +1' },
    { title: 'Refunded', detail: usd(mugs.fog.price) },
  ],
}

// 10 · Saturday, Oct 31: month end. Stripe fees are 2.9% + 30¢ on each of
// October's 270 orders; the gross is sales, shipping and tax together.
const books = { sales: 841260, shipping: 140285, tax: 41218, refunds: -14106, orders: 270 }
const gross = books.sales + books.shipping + books.tax
const fees = -Math.round(gross * 0.029 + books.orders * 30)
export const salesTax = { state: 'North Carolina', basis: 'by county', orders: 162, cents: books.tax, due: 'Nov 20' }
export const nexus = ['CA $18,400', 'TX $9,120', 'NY $6,310']
export const ledger = [
  { label: 'Sales', cents: books.sales },
  { label: 'Shipping', cents: books.shipping },
  { label: 'Sales tax', cents: books.tax },
  { label: 'Refunds', cents: books.refunds },
  { label: 'Stripe fees', cents: fees },
]
export const payout = { cents: -juneReturn.refund, matched: `Matched to refund ${juneReturn.id}${SEP}Oct 30`, posted: 'Posted Oct 31, 11:58 PM' }
