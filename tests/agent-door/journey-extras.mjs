import { isDeepStrictEqual } from 'node:util';
import { requireValue } from './native.mjs';
import { mediaBase64 } from './native-extras.mjs';

export async function checkExtraStep(context, { owner, readCurrent, redactedOrder }) {
 const { step, result, args } = context;
 if (step.tool === 'stall.catalog1.media') {
  const response = await context.request(new URL(`/api/stall/media/${encodeURIComponent(args.id)}`, context.origin).href, { headers: { Cookie: context.cookie } });
  requireValue(response.ok && response.headers.get('content-type') === result.mime, 'Media tool differs from native staff visibility or MIME.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const base64 = btoa(String.fromCharCode(...bytes));
  requireValue(isDeepStrictEqual(result, { id: args.id, mime: 'image/png', base64: mediaBase64 }) && result.base64 === base64, 'Media tool did not return the exact native uploaded bytes.');
 }
 if (step.tool === 'stall.ai5.preview') {
  const native = await owner('/api/stall/merchandising/preview', args);
  requireValue(isDeepStrictEqual(result, native), 'Proposal preview differs from the selected native proposal revision.');
  const state = await owner('/api/stall/state');
  const product = state.products.find(entry => entry.id === native.product.sku);
  const source = await owner(`/api/stall/merchandising?sku=${encodeURIComponent(native.product.sku)}`);
  const proposal = source.proposals.find(entry => entry.id === args.id);
  requireValue(proposal?.revision === args.revision && proposal.status === 'draft' && !proposal.approval && product && !product.value.draft && product.value.details?.seo?.title !== native.product.details?.seo?.title, 'Preview crossed publication or modified its exact proposal.');
 }
 if (step.tool === 'stall.agent1.act') {
  const state = await owner('/api/stall/state'), witness = await readCurrent('stall.audit1.read', {});
  requireValue(isDeepStrictEqual(result.products, state.products) && isDeepStrictEqual(result.orders, state.orders.map(redactedOrder)) && isDeepStrictEqual(result.proposals, witness.proposals) && isDeepStrictEqual(result.audit, state.audit), 'Refresh tool differs from current committed native commerce state.');
  const ids = state.orders.filter(order => order.payment && order.reservation).map(order => order.id);
  requireValue(isDeepStrictEqual(result.refreshed, { orderIds: ids, count: ids.length }) && !result.shipmentSync.error && Number.isFinite(Date.parse(result.shipmentSync.checkedAt)), 'Refresh did not retain successful native shipment observation and candidate counts.');
  let after = '0', latest;
  for (;;) {
   const page = await owner(`/agents/api/audit?after=${after}`);
   for (const row of page.rows) if (row.tool === step.tool && row.outcome === 'done') latest = row;
   if (!page.cursor || page.cursor === after) break;
   after = page.cursor;
  }
  requireValue(latest?.classes.find(entry => entry.class === 'standard')?.facts.measure === ids.length, 'Refresh policy facts must count the current native candidate orders.');
  requireValue(Object.keys(result).sort().join(',') === ['products','orders','proposals','audit','shipmentSync','refreshed'].sort().join(','), 'Refresh exposed fields outside its sanitized native contract.');
 }
}
