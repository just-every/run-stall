import { origin as pierOrigin } from './provider-config.mjs';
import { command, nativeOwner, requireValue } from './native.mjs';

const product = (sku, name, active) => ({ sku, name, description: 'Merchant confirmed cotton storage pouch.', unitCents: 1200, active });

async function approved(owner, input) {
 const draft = await command(owner, 'product.prepare', input);
 requireValue(draft.id === input.sku && draft.value?.draft && !draft.value.approval, 'Product preparation did not create a native draft.');
 const published = await command(owner, 'product.approve', { sku: draft.id, revision: draft.revision });
 requireValue(published.value?.approval && !published.value.draft && published.value.active === input.active, 'Owner did not approve the exact native product.');
 return published;
}

async function paidOrder(owner, sku) {
 const lines = [{ sku, quantity: 2 }], postalCode = '10001';
 const quote = await owner('/api/stall/shipping/quote', { lines, postalCode });
 const service = quote.services?.find(entry => entry.kind === 'ship');
 requireValue(service && Number.isSafeInteger(service.cents), 'Native shipping must offer a priced shipping service.');
 const totalCents = 2400 + service.cents;
 const order = await command(owner, 'order.manual', {
  idempotencyKey: crypto.randomUUID(), lines, customerEmail: 'journey-buyer@example.invalid',
  name: 'Conformance buyer', address: { line1: '123 Fixture Street', city: 'New York', state: 'NY', postal_code: postalCode, country: 'US' },
  expectedTotalCents: totalCents, method: 'cash', amountCents: totalCents,
  receivedOn: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
  reference: 'Disposable conformance sale', shipping: { service: service.code, quote: service.quote, postalCode },
 });
 requireValue(order.status === 'reserved' && order.payment?.source === 'staff' && order.reservation?.lines?.length === 1 && order.totalCents === totalCents, 'Native paid order did not reserve its purchased stock.');
 return order;
}

/** Every phase uses fresh records through the owner door and real native commits. */
export default async function fixtures(context) {
 const owner = nativeOwner(context), suffix = crypto.randomUUID();
 const skus = { catalog: `door-draft-${suffix}`, merch: `door-merch-${suffix}`, stock: `door-stock-${suffix}` };
 requireValue(typeof context.fixtures?.set === 'function', 'The declared Pier network fixture control is required.');
 context.fixtures.set(pierOrigin, { skus: [skus.stock] });

 const catalog = await command(owner, 'product.prepare', product(skus.catalog, 'Catalog pouch', false));
 requireValue(catalog.value?.draft && !catalog.value.approval, 'Catalog fixture requires an unapproved product draft.');
 await approved(owner, product(skus.merch, 'Merchandising pouch', false));
 const bundle = await owner(`/api/stall/merchandising?sku=${encodeURIComponent(skus.merch)}`);
 requireValue(bundle.sku === skus.merch && bundle.sources?.some(source => source.id === 'name') && bundle.proposals?.length === 0, 'Merchandising fixture must expose approved sources without a previous proposal.');
 await approved(owner, product(skus.stock, 'Order pouch', true));
 const shipment = await paidOrder(owner, skus.stock);
 let refund = await paidOrder(owner, skus.stock);
 refund = await command(owner, 'shipment.prepare', { orderId: refund.id, revision: refund.revision, reference: `fixture-${suffix}` });
 requireValue(refund.shipment?.status === 'draft', 'Native shipment was not prepared.');
 refund = await command(owner, 'shipment.approve', { orderId: refund.id, revision: refund.revision });
 requireValue(refund.status === 'shipped' && refund.shipment?.status === 'shipped' && refund.shipment.pierShipmentId && refund.refunds?.length === 0, 'Refund fixture must be a paid shipped native order.');

 // Settle Pier's first shipment observation before any no-effect witness runs.
 const settled = await owner('/api/stall/state');
 requireValue(!settled.shipmentSync?.error && settled.orders?.find(order => order.id === refund.id)?.shipment?.dispatches?.length === 1, 'Native shipment observation did not retain the provider dispatch.');
 return { values: { catalog: { sku: skus.catalog }, merch: { sku: skus.merch }, shipment: { id: shipment.id }, refund: { id: refund.id } }, clients: {} };
}
