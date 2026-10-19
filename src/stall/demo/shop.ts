// The demo's sample shop: Saltbush & Clay, a two-person studio in Santa Fe, New
// Mexico selling its own ceramics and a few pantry goods. Every person, email and
// address is invented (example.* domains). Prices are USD cents; stock is what
// Pier holds sellable today.

export const shop = { owner: 'Hannah Bright', since: 70 }
export const team = [{ id: 'demo-op-sam', email: 'sam.okoro@saltbushclay.example', name: 'Sam Okoro', role: 'admin', joined: 64 }] as const
export const agentGrant = { id: 'demo-agent-orders', created: 9, expiresIn: 5 }

export type ProductSeed = { sku: string; name: string; description: string; cents: number; stock: number; bin: string; active?: boolean; draft?: { cents?: number; name?: string; description?: string; by: 'agent' | 'sam'; at: number }; staged?: boolean }
export const products: ProductSeed[] = [
 { sku: 'SC-MUG-SALT', name: 'Saltbush mug', description: 'Wheel-thrown 12 oz mug in our soft gray-green saltbush glaze. Dishwasher safe.', cents: 4200, stock: 18, bin: 'A1' },
 { sku: 'SC-MUG-OCHRE', name: 'Ochre speckle mug', description: 'Speckled stoneware mug with a warm ochre rim, 12 oz.', cents: 4200, stock: 5, bin: 'A1' },
 { sku: 'SC-BOWL-RIPPLE', name: 'Ripple serving bowl', description: 'A wide 11-inch serving bowl with hand-carved ripples under a clear glaze.', cents: 9600, stock: 3, bin: 'A2' },
 { sku: 'SC-BOWL-NOODLE', name: 'Noodle bowls, set of two', description: 'Deep 6-inch bowls for ramen, pho and big salads.', cents: 7800, stock: 9, bin: 'A2' },
 { sku: 'SC-PLATE-DINNER', name: 'Sea-glass dinner plate', description: '10.5-inch dinner plate in a pale sea-glass celadon.', cents: 5400, stock: 22, bin: 'B1' },
 { sku: 'SC-PLATE-SIDE', name: 'Sea-glass side plate', description: '8-inch side plate to match the dinner plates.', cents: 3600, stock: 30, bin: 'B1', draft: { cents: 3800, by: 'sam', at: 1 } },
 { sku: 'SC-VASE-BUD', name: 'Bud vase trio', description: 'Three small bud vases in saltbush, ochre and sea-glass.', cents: 6500, stock: 0, bin: 'C1' },
 { sku: 'SC-JUG-POUR', name: 'Pouring jug', description: 'A one-quart jug with a crisp, drip-free lip. Milk, water or flowers.', cents: 8800, stock: 4, bin: 'C1' },
 { sku: 'SC-PLANTER-SM', name: 'Small planter with saucer', description: '5-inch planter with a drainage hole and its own saucer.', cents: 4800, stock: 7, bin: 'C2' },
 { sku: 'SC-CANDLE-PINON', name: 'Piñon & fig candle', description: 'Soy wax poured into a small saltbush vessel. About 40 hours.', cents: 3400, stock: 38, bin: 'D1' },
 { sku: 'SC-TOWEL-LINEN', name: 'Rio Grande stripe tea towel', description: 'Washed linen tea towel with a blue river stripe.', cents: 2800, stock: 26, bin: 'D1' },
 { sku: 'SC-HONEY-MESQUITE', name: 'Mesquite honey, 1 lb', description: 'Raw mesquite honey from a family apiary near Las Cruces.', cents: 2400, stock: 14, bin: 'D2' },
 { sku: 'SC-TEA-SAGE', name: 'Desert sage tea, 3 oz', description: 'Loose-leaf green tea with desert sage and lemon verbena.', cents: 1900, stock: 33, bin: 'D2' },
 { sku: 'SC-ORN-PINECONE', name: 'Piñon cone ornament set', description: 'Six porcelain piñon cone ornaments for the holidays.', cents: 3200, stock: 0, bin: 'C2', active: false },
 { sku: 'SC-MUG-SEAFOAM', name: 'Seafoam mug', description: 'New this season: our 12 oz mug in a pale seafoam glaze.', cents: 4400, stock: 12, bin: 'A1', staged: true, draft: { by: 'agent', at: 0 } },
]
export const bins = ['A1', 'A2', 'B1', 'C1', 'C2', 'D1', 'D2']

export type Customer = { name: string; email: string; line1: string; city: string; state: string; postcode: string }
export const customers: Customer[] = [
 { name: 'Olivia Marchetti', email: 'olivia.marchetti@example.com', line1: '14 Camino del Monte Sol', city: 'Santa Fe', state: 'NM', postcode: '87501' },
 { name: 'James Tran', email: 'jtran@example.net', line1: '2210 Central Ave SE', city: 'Albuquerque', state: 'NM', postcode: '87106' },
 { name: 'Aroha Ngata', email: 'aroha.ngata@example.org', line1: '9 Paseo del Pueblo Norte', city: 'Taos', state: 'NM', postcode: '87571' },
 { name: 'Priya Raman', email: 'priya.raman@example.com', line1: '41 Pearl Street', city: 'Boulder', state: 'CO', postcode: '80302' },
 { name: 'Ben Fitzgerald', email: 'ben.fitz@example.com', line1: '118 Main Avenue', city: 'Durango', state: 'CO', postcode: '81301' },
 { name: 'Chloe Nguyen', email: 'chloe.nguyen@example.net', line1: '7 South Congress Avenue', city: 'Austin', state: 'TX', postcode: '78704' },
 { name: 'Tom Hartley', email: 'tom.hartley@example.org', line1: '56 Montrose Boulevard', city: 'Houston', state: 'TX', postcode: '77006' },
 { name: 'Grace Ellison', email: 'grace.ellison@example.com', line1: '29 Hawthorne Boulevard', city: 'Portland', state: 'OR', postcode: '97214' },
 { name: 'Marcus Webb', email: 'mwebb@example.com', line1: '33 Ballard Avenue NW', city: 'Seattle', state: 'WA', postcode: '98107' },
 { name: 'Sienna Brooks', email: 'sienna.brooks@example.net', line1: '15 Valencia Street', city: 'San Francisco', state: 'CA', postcode: '94103' },
 { name: 'Daniel Kowalczyk', email: 'dan.kowalczyk@example.com', line1: '80 Milwaukee Avenue', city: 'Chicago', state: 'IL', postcode: '60622' },
 { name: 'Isla McKenzie', email: 'isla.mckenzie@example.org', line1: '12 Church Street', city: 'Burlington', state: 'VT', postcode: '05401' },
 { name: 'Hamish Doyle', email: 'hamish.doyle@example.com', line1: '27 Main Street', city: 'Northampton', state: 'MA', postcode: '01060' },
 { name: 'Mei Lin Chua', email: 'meilin.chua@example.net', line1: '6 Fourth Avenue', city: 'Tucson', state: 'AZ', postcode: '85705' },
 { name: 'Ruby Okafor', email: 'ruby.okafor@example.com', line1: '19 Roosevelt Row', city: 'Phoenix', state: 'AZ', postcode: '85004' },
 { name: 'Lachlan Price', email: 'lachlan.price@example.org', line1: '4 Center Street', city: 'Moab', state: 'UT', postcode: '84532' },
 { name: 'Ava Sorensen', email: 'ava.sorensen@example.com', line1: '61 Ocean Avenue', city: 'Carmel-by-the-Sea', state: 'CA', postcode: '93921' },
 { name: 'Noah Pham', email: 'noah.pham@example.net', line1: '10 Broadway', city: 'Asheville', state: 'NC', postcode: '28801' },
 { name: 'Zara Haddad', email: 'zara.haddad@example.com', line1: '25 Mesa Street', city: 'El Paso', state: 'TX', postcode: '79901' },
 { name: 'Felix Andersen', email: 'felix.andersen@example.org', line1: '8 Grand Avenue', city: 'Saint Paul', state: 'MN', postcode: '55105' },
 { name: 'Matilda Clarke', email: 'tilly.clarke@example.com', line1: '3 Canyon Road', city: 'Santa Fe', state: 'NM', postcode: '87501' },
 { name: 'Oscar Nakamura', email: 'oscar.nakamura@example.net', line1: '17 Bedford Avenue', city: 'Brooklyn', state: 'NY', postcode: '11211' },
 { name: 'Harriet Wills', email: 'harriet.wills@example.com', line1: '50 King Street', city: 'Charleston', state: 'SC', postcode: '29401' },
 { name: 'Kiran Desai', email: 'kiran.desai@example.org', line1: '21 Larimer Street', city: 'Denver', state: 'CO', postcode: '80205' },
 { name: 'Sophie Laurent', email: 'sophie.laurent@example.com', line1: '5 Magazine Street', city: 'New Orleans', state: 'LA', postcode: '70130' },
 { name: 'Will Bennett', email: 'will.bennett@example.net', line1: '88 Old Santa Fe Trail', city: 'Santa Fe', state: 'NM', postcode: '87505' },
]

// Each order: [days ago, hour in Santa Fe (minutes ago for today's), customer, lines [sku, quantity], what happened].
export type Fate = 'shipped' | 'refunded' | 'refund-waiting' | 'packed' | 'reserved' | 'paid' | 'shortfall' | 'abandoned' | 'checkout-pending'
export type Refunded = { sku: string; quantity: number; reason: string }
export type OrderSeed = [number, number, number, [string, number][], Fate, Refunded?]
export const orders: OrderSeed[] = [
 [44, 10, 0, [['SC-MUG-SALT', 2], ['SC-HONEY-MESQUITE', 1]], 'shipped'],
 [43, 19, 1, [['SC-PLATE-DINNER', 4], ['SC-PLATE-SIDE', 4]], 'shipped'],
 [42, 8, 2, [['SC-CANDLE-PINON', 2]], 'shipped'],
 [40, 13, 3, [['SC-BOWL-RIPPLE', 1]], 'refunded', { sku: 'SC-BOWL-RIPPLE', quantity: 1, reason: 'Arrived with a chipped rim; customer kept it for the garden.' }],
 [39, 21, 4, [['SC-JUG-POUR', 1], ['SC-TOWEL-LINEN', 2]], 'shipped'],
 [37, 9, 5, [['SC-MUG-OCHRE', 2], ['SC-TEA-SAGE', 2]], 'shipped'],
 [36, 16, 6, [['SC-BOWL-NOODLE', 1]], 'shipped'],
 [35, 11, 7, [['SC-VASE-BUD', 1], ['SC-CANDLE-PINON', 1]], 'shipped'],
 [33, 20, 8, [['SC-PLATE-DINNER', 2]], 'shipped'],
 [32, 7, 9, [['SC-MUG-SALT', 4]], 'refunded', { sku: 'SC-MUG-SALT', quantity: 1, reason: 'One mug cracked in transit (photos received).' }],
 [31, 14, 10, [['SC-HONEY-MESQUITE', 2], ['SC-TEA-SAGE', 1]], 'shipped'],
 [29, 18, 11, [['SC-PLANTER-SM', 2]], 'shipped'],
 [28, 10, 12, [['SC-TOWEL-LINEN', 3]], 'shipped'],
 [27, 12, 13, [['SC-BOWL-NOODLE', 2], ['SC-MUG-SALT', 2]], 'shipped'],
 [26, 19, 14, [['SC-VASE-BUD', 1]], 'shipped'],
 [24, 9, 0, [['SC-CANDLE-PINON', 3]], 'shipped'],
 [23, 15, 15, [['SC-JUG-POUR', 1]], 'shipped'],
 [22, 20, 16, [['SC-PLATE-SIDE', 6]], 'shipped'],
 [21, 8, 17, [['SC-MUG-OCHRE', 1], ['SC-HONEY-MESQUITE', 1]], 'shipped'],
 [20, 13, 18, [['SC-BOWL-RIPPLE', 1], ['SC-TOWEL-LINEN', 1]], 'shipped'],
 [18, 17, 19, [['SC-TEA-SAGE', 3]], 'refunded', { sku: 'SC-TEA-SAGE', quantity: 1, reason: 'Sent the wrong tea; refunded one tin instead of a return.' }],
 [17, 11, 20, [['SC-PLANTER-SM', 1], ['SC-CANDLE-PINON', 1]], 'shipped'],
 [16, 21, 21, [['SC-MUG-SALT', 2]], 'shipped'],
 [15, 10, 3, [['SC-PLATE-DINNER', 6]], 'shipped'],
 [14, 14, 22, [['SC-VASE-BUD', 2]], 'shipped'],
 [13, 9, 23, [['SC-BOWL-NOODLE', 1], ['SC-TEA-SAGE', 2]], 'shipped'],
 [12, 16, 24, [['SC-TOWEL-LINEN', 2], ['SC-HONEY-MESQUITE', 2]], 'shipped'],
 [11, 20, 25, [['SC-JUG-POUR', 1], ['SC-MUG-OCHRE', 2]], 'shipped'],
 [10, 8, 1, [['SC-CANDLE-PINON', 4]], 'shipped'],
 [9, 12, 5, [['SC-MUG-SALT', 1], ['SC-PLANTER-SM', 1]], 'shipped'],
 [8, 18, 7, [['SC-PLATE-SIDE', 2], ['SC-PLATE-DINNER', 2]], 'shipped'],
 [7, 10, 11, [['SC-HONEY-MESQUITE', 3]], 'shipped'],
 [6, 15, 9, [['SC-BOWL-RIPPLE', 1], ['SC-MUG-SALT', 2]], 'refund-waiting', { sku: 'SC-BOWL-RIPPLE', quantity: 1, reason: 'Bowl arrived with a hairline crack; customer sent photos and kept the mugs.' }],
 [5, 11, 13, [['SC-VASE-BUD', 2]], 'shortfall'],
 [4, 9, 14, [['SC-TEA-SAGE', 2], ['SC-CANDLE-PINON', 1]], 'shipped'],
 [3, 13, 2, [['SC-BOWL-NOODLE', 1], ['SC-MUG-OCHRE', 1]], 'packed'],
 [3, 19, 16, [['SC-PLATE-DINNER', 4]], 'packed'],
 [2, 10, 24, [['SC-JUG-POUR', 1]], 'packed'],
 [2, 16, 18, [['SC-TOWEL-LINEN', 2], ['SC-CANDLE-PINON', 2]], 'reserved'],
 [1, 9, 6, [['SC-MUG-SALT', 2]], 'reserved'],
 [1, 14, 20, [['SC-PLANTER-SM', 2]], 'abandoned'],
 [1, 20, 10, [['SC-HONEY-MESQUITE', 1], ['SC-TEA-SAGE', 1]], 'reserved'],
 [0, 190, 22, [['SC-BOWL-RIPPLE', 1]], 'abandoned'],
 [0, 25, 17, [['SC-MUG-OCHRE', 2], ['SC-TOWEL-LINEN', 1]], 'paid'],
 [0, 12, 12, [['SC-CANDLE-PINON', 1]], 'checkout-pending'],
]
