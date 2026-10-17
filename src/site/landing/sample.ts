// The homepage's one sample shop, Fog & Clay, a ceramics studio shipping from
// Austin, Texas. Every drawing reads its figures from here, so the same order
// shows the same money in the hero, the checkout, the label and the interlude.
// All money is USD; Texas taxes shipping, so tax is on items plus shipping.

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const shop = { name: 'Fog & Clay', domain: 'fogandclay.com' }

export const mug = { name: 'Fog glaze', price: 3800, left: 3 }

export const products = [
  { photo: 'mug', price: 3800 },
  { photo: 'bowl', price: 4200 },
  { photo: 'vase', price: 5600 },
] as const

export const glazes = ['Fog', 'Cobalt', 'Speckle'] as const

export const rates = [
  { carrier: 'USPS Ground Advantage', cents: 685 },
  { carrier: 'UPS Ground', cents: 912 },
  { carrier: 'USPS Priority', cents: 1040 },
]

// Two Fog glaze mugs to Texas by USPS Ground Advantage.
const quantity = 2
const items = mug.price * quantity
const shipping = rates[0].cents
const taxRate = 0.0825
const tax = Math.round((items + shipping) * taxRate)
export const order = {
  number: 1052,
  line: `${mug.name} mug × ${quantity}`,
  items: usd(items),
  carrier: rates[0].carrier,
  shipping: usd(shipping),
  taxLabel: 'Sales tax (TX)',
  tax: usd(tax),
  total: usd(items + shipping + tax),
  tracking: '9400 1118 9922 3456 7811 00',
  hold: 'Stock held · 10 min',
}

// October's sales tax, by state; the total is their sum.
export const taxStates = [
  { state: 'Texas', rate: '8.25%', cents: 21460 },
  { state: 'Colorado', rate: '2.9% + local', cents: 8831 },
  { state: 'Maine', rate: '5.5%', cents: 10927 },
]
export const taxTotal = usd(taxStates.reduce((sum, row) => sum + row.cents, 0))

export const moveIn = [
  { label: 'Products', count: 214 },
  { label: 'Customers', count: 1980 },
  { label: 'Orders', count: 6412 },
  { label: 'Redirects', count: 340 },
]

export const recovered = usd(14200)
export const overnight = 38

export { usd }
