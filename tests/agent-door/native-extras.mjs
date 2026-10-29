import { nativeOwner, requireValue } from './native.mjs';
import { stripeOrigin, taxAddress, paidAddress, shipFrom } from './stripe-config.mjs';

// An actual one-pixel PNG, uploaded through the person-only native media route.
export const mediaBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6AAAAABJRU5ErkJggg==';
export async function uploadFixtureMedia(context) {
 const bytes = Uint8Array.from(atob(mediaBase64), char => char.charCodeAt(0));
 const response = await context.request(new URL('/api/stall/media', context.origin).href, {
  method: 'POST', headers: { Origin: context.origin, Cookie: context.cookie, 'Content-Type': 'image/png' }, body: bytes,
 });
 requireValue(response.ok, `Native person media upload failed with HTTP ${response.status}.`);
 const media = await response.json();
 requireValue(media.id && media.mime === 'image/png' && media.size === bytes.length, 'Native media upload omitted the stored file identity.');
 return media;
}

/** Native owner tax configuration followed by public quote/checkout/payment observation. */
export async function mismatchedPaidOrder(context, sku) {
 context.fixtures.set(stripeOrigin, { appOrigin: context.origin, sku });
 const owner = nativeOwner(context);
 const configuration = await owner('/api/stall/tax/configuration');
 const categories = [...configuration.categories.filter(entry => entry.sku !== sku), { sku, taxCode: 'txcd_99999999' }];
 await owner('/api/stall/tax/configuration', { revision: configuration.revision, value: { shipFrom, categories, thresholds: configuration.thresholds } });
 const mode = await owner('/api/stall/tax/commerce?review=1');
 await owner('/api/stall/tax/commerce', { revision: mode.revision, enabled: true, consent: mode.consent });
 const publicCall = async (path, input) => {
  const response = await context.request(new URL(path, context.origin).href, { method: input === undefined ? 'GET' : 'POST', headers: { Origin: context.origin, 'Content-Type': 'application/json' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  requireValue(response.ok, `Native public tax checkout failed with HTTP ${response.status}.`);
  return response.json();
 };
 const lines = [{ sku, quantity: 2 }], customerEmail = 'journey-buyer@example.invalid';
 const offered = await publicCall('/api/stall/shipping/quote', { lines, postalCode: taxAddress.postal_code });
 const service = offered.services.find(entry => entry.kind === 'ship');
 requireValue(service?.cents === 200, 'Native address-remedy checkout needs its configured paid shipping rate.');
 context.fixtures.set(stripeOrigin, { appOrigin: context.origin, sku, shippingName: service.name });
 const shipping = { service: service.code, quote: service.quote, postalCode: taxAddress.postal_code };
 const disclosure = await publicCall('/api/stall/tax/mode');
 const quote = await publicCall('/api/stall/tax/quote', { id: crypto.randomUUID(), destination: taxAddress, customerEmail, lines, shipping, consent: disclosure.shopperConsent });
 requireValue(quote.taxCents > 0 && quote.totalCents === 2763, 'Public tax checkout did not retain the original Stripe calculation.');
 const checkout = await publicCall('/api/stall/checkout', { idempotencyKey: crypto.randomUUID(), customerEmail, lines, shipping, expectedTotalCents: quote.totalCents, taxQuoteId: quote.quoteId });
 const confirmation = await publicCall('/api/stall/checkout/confirm', { orderId: checkout.orderId });
 const order = (await owner('/api/stall/state')).orders.find(entry => entry.id === checkout.orderId);
 requireValue(confirmation.status === 'paid' && order?.status === 'paid' && order.payment?.intentId && !order.reservation && !order.tax.transactionId && order.tax.calculationId === quote.calculationId && order.shippingDetails.address.line1 === paidAddress.line1, 'Address-remedy fixture requires a verified taxed payment held before reservation or tax posting.');
 return order;
}
