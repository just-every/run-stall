import { stripeOrigin, stripeKey, taxAddress, paidAddress, shipFrom } from './stripe-config.mjs';
import { ProviderRefusal } from './provider-state.mjs';

const check = (condition, code = 'INPUT') => { if (!condition) throw new ProviderRefusal(code, 400); };
const exact = (form, expected) => check(JSON.stringify([...form.entries()].sort()) === JSON.stringify(Object.entries(expected).flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map(entry => [key, String(entry)])).sort()));
const calculations = new Map(), sessions = new Map(), receipts = new Map();
const addressForm = (prefix, address) => Object.fromEntries(Object.entries(address).map(([key, value]) => [`${prefix}[${key}]`, value]));
const uuid = '[a-f0-9-]{36}';

/** Only Stripe's HTTP ledger is synthetic. Native checkout, tax and payment records are real. */
export async function stripeFetch(request, fixture) {
 const url = new URL(request.url);
 check(url.origin === stripeOrigin && !url.hash, 'ORIGIN');
 check(request.headers.get('authorization') === `Bearer ${stripeKey}` && !request.headers.has('cookie') && request.headers.get('stripe-version') === '2025-06-30.basil', 'AUTH');
 check(fixture && typeof fixture.appOrigin === 'string' && /^https?:\/\//.test(fixture.appOrigin) && typeof fixture.sku === 'string', 'FIXTURE');
 const path = url.pathname;
 if (request.method === 'GET') {
  check(!request.headers.has('idempotency-key') && !request.body, 'METHOD');
  if (path === '/v1/account' && !url.search) return Response.json({ id: 'acct_agentdoorfixture', country: 'US' });
  if (path === '/v1/tax/settings' && !url.search) return Response.json({ status: 'active', head_office: { address: shipFrom }, defaults: { tax_code: 'txcd_99999999' } });
  if (path === '/v1/tax/registrations') {
   exact(url.searchParams, { status: 'active', limit: 100 });
   return Response.json({ object: 'list', has_more: false, data: [{ id: 'taxreg_agentdoorfixture', status: 'active', country: 'US', country_options: { us: { state: 'TX' } } }] });
  }
  const calculation = path.match(/^\/v1\/tax\/calculations\/(taxcalc_[A-Za-z0-9]+)(\/line_items)?$/);
  if (calculation) {
   const value = calculations.get(calculation[1]); check(value, 'EVIDENCE');
   if (calculation[2]) { exact(url.searchParams, { limit: 100, 'expand[]': 'data.tax_breakdown' }); return Response.json({ object: 'list', has_more: false, data: value.items }); }
   check(!url.search); return Response.json(value.calculation);
  }
  const session = sessions.get(path.slice('/v1/checkout/sessions/'.length));
  if (path.startsWith('/v1/checkout/sessions/') && session) { check(!url.search); return Response.json(session); }
  throw new ProviderRefusal('NOT_FOUND', 404);
 }
 check(request.method === 'POST' && !url.search && request.headers.get('content-type') === 'application/x-www-form-urlencoded', 'METHOD');
 const key = request.headers.get('idempotency-key'), body = await request.text(), form = new URLSearchParams(body);
 check(typeof key === 'string' && key.length > 0, 'IDEMPOTENCY');
 const old = receipts.get(key);
 if (old) { check(old.path === path && old.body === body, 'IDEMPOTENCY'); return Response.json(old.value); }
 let value;
 if (path === '/v1/tax/calculations') {
  const quoteId = form.get('line_items[0][metadata][stall_quote_id]'), intent = form.get('line_items[0][metadata][stall_intent]');
  check(new RegExp(`^${uuid}$`).test(quoteId ?? '') && /^[a-f0-9]{64}$/.test(intent ?? '') && key === `stall-sale-quote-${quoteId}`, 'IDEMPOTENCY');
  exact(form, { currency: 'usd', 'customer_details[address_source]': 'shipping', ...addressForm('customer_details[address]', taxAddress), ...addressForm('ship_from_details[address]', shipFrom), 'shipping_cost[amount]': 200, 'shipping_cost[tax_behavior]': 'exclusive', 'expand[]': ['line_items.data.tax_breakdown', 'shipping_cost.tax_breakdown'], 'line_items[0][reference]': 'line-0', 'line_items[0][quantity]': 2, 'line_items[0][amount]': 2400, 'line_items[0][tax_code]': 'txcd_99999999', 'line_items[0][tax_behavior]': 'exclusive', 'line_items[0][metadata][stall_quote_id]': quoteId, 'line_items[0][metadata][stall_intent]': intent });
  const id = `taxcalc_${crypto.randomUUID().replaceAll('-', '')}`;
  const breakdown = amount => [{ amount: Math.round(amount * 0.0625), inclusive: false, taxable_amount: amount, taxability_reason: 'standard_rated', jurisdiction: { level: 'state', display_name: 'Texas', country: 'US', state: 'TX' }, tax_rate_details: { country: 'US', state: 'TX', percentage_decimal: '6.25', tax_type: 'sales_tax' } }];
  const items = [{ id: 'taxli_fixture0', object: 'tax.calculation_line_item', livemode: false, reference: 'line-0', amount: 2400, quantity: 2, amount_tax: 150, tax_code: 'txcd_99999999', tax_behavior: 'exclusive', tax_breakdown: breakdown(2400), metadata: { stall_quote_id: quoteId, stall_intent: intent } }];
  value = { id, object: 'tax.calculation', livemode: false, currency: 'usd', customer_details: { address: taxAddress, address_source: 'shipping' }, ship_from_details: { address: shipFrom }, shipping_cost: { amount: 200, amount_tax: 13, tax_behavior: 'exclusive', tax_breakdown: breakdown(200) }, expires_at: Math.floor(Date.now() / 1000) + 3600, amount_total: 2763, tax_amount_exclusive: 163, tax_amount_inclusive: 0, tax_breakdown: [{ ...breakdown(2600)[0], amount: 163 }] };
  calculations.set(id, { calculation: value, items });
 } else if (path === '/v1/checkout/sessions') {
  const orderId = form.get('client_reference_id'), calculationId = form.get('metadata[stall_tax_calculation]');
  check(new RegExp(`^${uuid}$`).test(orderId ?? '') && key === `stall-checkout-${orderId}` && calculations.has(calculationId), 'IDEMPOTENCY');
  exact(form, { mode: 'payment', customer_email: 'journey-buyer@example.invalid', client_reference_id: orderId, 'metadata[stall_order_id]': orderId, 'payment_intent_data[metadata][stall_order_id]': orderId, success_url: `${fixture.appOrigin}/order?checkout=success&orderId=${orderId}`, cancel_url: `${fixture.appOrigin}/order?checkout=cancelled&orderId=${orderId}`, 'shipping_address_collection[allowed_countries][0]': 'US', 'line_items[0][quantity]': 2, 'line_items[0][price_data][currency]': 'usd', 'line_items[0][price_data][unit_amount]': 1200, 'line_items[0][price_data][product_data][name]': 'Order pouch', 'line_items[1][quantity]': 1, 'line_items[1][price_data][currency]': 'usd', 'line_items[1][price_data][unit_amount]': 163, 'line_items[1][price_data][product_data][name]': 'Sales tax', 'metadata[stall_tax_calculation]': calculationId, 'payment_intent_data[metadata][stall_tax_calculation]': calculationId, 'shipping_options[0][shipping_rate_data][type]': 'fixed_amount', 'shipping_options[0][shipping_rate_data][fixed_amount][amount]': 200, 'shipping_options[0][shipping_rate_data][fixed_amount][currency]': 'usd', 'shipping_options[0][shipping_rate_data][display_name]': fixture.shippingName });
  const id = `cs_${crypto.randomUUID().replaceAll('-', '')}`;
  value = { id, object: 'checkout.session', mode: 'payment', livemode: false, client_reference_id: orderId, metadata: { stall_order_id: orderId, stall_tax_calculation: calculationId }, currency: 'usd', amount_total: 2763, total_details: { amount_shipping: 200 }, payment_status: 'unpaid', status: 'open', url: `https://checkout.stripe.com/c/pay/${id}` };
  sessions.set(id, { ...value, payment_status: 'paid', status: 'complete', payment_intent: `pi_${crypto.randomUUID().replaceAll('-', '')}`, collected_information: { shipping_details: { name: 'Conformance buyer', address: paidAddress } } });
 } else throw new ProviderRefusal('NOT_FOUND', 404);
 receipts.set(key, { path, body, value: structuredClone(value) });
 return Response.json(value);
}
