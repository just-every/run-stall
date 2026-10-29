import { customerId } from './provider-config.mjs';

export class ProviderRefusal extends Error {
 constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
const check = (condition, code = 'INPUT') => { if (!condition) throw new ProviderRefusal(code); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const quantity = value => typeof value === 'string' && /^[1-9]\d{0,3}$/.test(value);
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
 : object(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);

// This is solely the external Pier ledger; native app records are never supplied.
const items = new Map(), orders = new Map(), shipments = new Map(), receipts = new Map();
const used = new Map();

export function addFixture(fixture) {
 check(exact(fixture, ['skus']) && Array.isArray(fixture.skus) && fixture.skus.length > 0 && fixture.skus.length <= 20, 'FIXTURE');
 for (const sku of fixture.skus) {
  check(typeof sku === 'string' && /^door-stock-[a-f0-9-]{36}$/.test(sku), 'FIXTURE');
  if (!items.has(sku)) items.set(sku, { id: `item-${sku}`, sku, name: 'Order pouch', archived: false });
 }
}

export function snapshot() {
 return {
  items: [...items.values()], locations: [{ id: 'fixture-bin', name: 'Fixture stock bin', kind: 'bin' }],
  positions: [...items.values()].map(item => ({ itemId: item.id, locationId: 'fixture-bin', status: 'sellable', available: String(1000 - (used.get(item.id) ?? 0)) })),
  parties: [{ id: customerId, name: 'Disposable Stall shop', kind: 'customer' }],
  orders: [...orders.values()], shipments: [...shipments.values()],
 };
}

function reserve(payload) {
 check(exact(payload, ['customerId', 'channel', 'currency', 'lines']) && payload.customerId === customerId && payload.channel === 'stall' && payload.currency === 'USD');
 check(Array.isArray(payload.lines) && payload.lines.length > 0 && payload.lines.length <= 50);
 const selected = new Set(), pending = new Map();
 const lines = payload.lines.map(line => {
  check(exact(line, ['itemId', 'quantity', 'price']) && quantity(line.quantity) && typeof line.price === 'string' && /^\d+\.\d{2}$/.test(line.price) && Number(line.price) > 0);
  check([...items.values()].some(item => item.id === line.itemId) && !selected.has(line.itemId), 'ITEM');
  selected.add(line.itemId);
  const amount = Number(line.quantity), total = (used.get(line.itemId) ?? 0) + amount;
  check(total <= 1000, 'STOCK'); pending.set(line.itemId, total);
  return { id: crypto.randomUUID(), ...line, reserved: line.quantity, dispatched: '0', cancelled: '0' };
 });
 const id = crypto.randomUUID(), order = { id, reference: `FIXTURE-${id}`, ...payload, lines };
 for (const [itemId, amount] of pending) used.set(itemId, amount);
 orders.set(id, order);
 return order;
}

function dispatch(payload) {
 check(exact(payload, ['orderId', 'shipmentReference', 'lines']) && typeof payload.shipmentReference === 'string' && payload.shipmentReference.length > 0 && payload.shipmentReference.length <= 500);
 const order = orders.get(payload.orderId);
 check(order && Array.isArray(payload.lines) && payload.lines.length === order.lines.length, 'ORDER');
 const seen = new Set();
 const lines = payload.lines.map(line => {
  check(exact(line, ['orderLineId', 'quantity']) && quantity(line.quantity));
  const original = order.lines.find(entry => entry.id === line.orderLineId);
  check(original && !seen.has(original.id) && original.reserved === line.quantity && original.dispatched === '0', 'RESERVATION');
  seen.add(original.id);
  return { ...line, itemId: original.itemId };
 });
 const shipment = { id: crypto.randomUUID(), orderId: order.id, reference: payload.shipmentReference, lines, createdAt: new Date().toISOString(), tracking: [] };
 order.lines = order.lines.map(line => ({ ...line, reserved: '0', dispatched: line.quantity }));
 shipments.set(shipment.id, shipment);
 return shipment;
}

export function execute(command) {
 check(exact(command, ['commandId', 'type', 'payload']) && typeof command.commandId === 'string' && command.commandId.length <= 160);
 check((command.type === 'order.create' && /^stall-reserve-[a-f0-9-]{36}$/.test(command.commandId))
  || (command.type === 'dispatch.create' && /^stall-ship-[a-f0-9-]{36}$/.test(command.commandId)), 'COMMAND');
 const intent = canonical({ type: command.type, payload: command.payload }), previous = receipts.get(command.commandId);
 if (previous) {
  check(previous.intent === intent, 'IDEMPOTENCY');
  return structuredClone(previous.result);
 }
 const result = command.type === 'order.create' ? reserve(command.payload) : dispatch(command.payload);
 receipts.set(command.commandId, { intent, result: structuredClone(result) });
 return structuredClone(result);
}
