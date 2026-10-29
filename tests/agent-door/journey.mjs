import { isDeepStrictEqual } from 'node:util';
import { command, nativeOwner, requireValue } from './native.mjs';

const orderKeys = ['id', 'revision', 'lines', 'totalCents', 'currency', 'status', 'shipment', 'refunds'];
const redactedOrder = order => Object.fromEntries(orderKeys.map(key => [key, order[key] ?? (key === 'shipment' ? null : undefined)]));

/** Prove each door result is the committed native draft, with approval separate. */
export async function afterStep(context) {
 const { step, result, args } = context, owner = nativeOwner(context);
 const injected = context.phase === 'autonomous' && step.inject;
 const readCurrent = async (name, input) => {
  const answer = await context.tool(name, input, step.client === undefined ? {} : { client: step.client });
  requireValue(answer.status === 200 && !answer.result?.isError && answer.result?.structuredContent !== undefined, 'Post-injection scoped read did not complete.');
  return answer.result.structuredContent;
 };
 if (['stall.catalog1.read', 'stall.catalog1.edit'].includes(step.tool)) {
  const current = injected && step.tool === 'stall.catalog1.edit' ? await readCurrent('stall.catalog1.read', { sku: args.sku }) : result;
  const state = await owner('/api/stall/state'), product = state.products.find(entry => entry.id === args.sku);
  requireValue(isDeepStrictEqual(current, product), 'Catalog scoped read differs from the native product.');
  if (step.tool === 'stall.catalog1.edit') {
   for (const prepared of [result, current]) {
    requireValue(prepared.id === args.sku && typeof prepared.revision === 'string' && prepared.revision.length > 0 && prepared.revision !== args.revision, 'Catalog preparation lost its product identity or new revision.');
    const draft = prepared.value.draft;
    requireValue(draft && ['name', 'description', 'unitCents', 'active'].every(key => draft[key] === args[key]), 'Catalog edit did not retain its exact native draft.');
    requireValue(!prepared.value.approval && prepared.value.active === false, 'Catalog preparation crossed the owner approval boundary.');
   }
  }
 }
 if (['stall.order1.manage', 'stall.order2.manage', 'stall.order3.manage'].includes(step.tool)) {
  const mutation = step.tool !== 'stall.order1.manage';
  const current = injected && mutation ? await readCurrent('stall.order1.manage', { id: args.orderId }) : result;
  const state = await owner('/api/stall/state'), order = state.orders.find(entry => entry.id === (args.orderId ?? args.id));
  requireValue(order && isDeepStrictEqual(current, redactedOrder(order)), 'Order scoped read differs from its committed native order.');
  for (const prepared of [result, current]) {
   requireValue(isDeepStrictEqual(Object.keys(prepared).sort(), [...orderKeys].sort()), 'Order tool exposed fields outside the redacted contract.');
   requireValue(prepared.id === (args.orderId ?? args.id) && typeof prepared.revision === 'string' && prepared.revision.length > 0 && (!mutation || prepared.revision !== args.revision), 'Order preparation lost its order identity or new revision.');
   if (step.tool === 'stall.order2.manage') requireValue(prepared.status === 'reserved' && prepared.shipment?.id === result.shipment?.id && typeof prepared.shipment?.id === 'string' && prepared.shipment.status === 'draft' && prepared.shipment.reference === args.reference && !prepared.shipment.approval, 'Shipment tool must prepare a draft while retaining reserved stock.');
   if (step.tool === 'stall.order3.manage') {
    const refund = prepared.refunds.at(-1);
    requireValue(prepared.status === 'shipped' && typeof refund?.id === 'string' && refund.id.length > 0 && refund.status === 'draft' && refund.reason === args.reason && isDeepStrictEqual(refund.lines, args.lines) && !refund.approval, 'Refund tool must retain a draft against the purchased shipped lines.');
   }
  }
 }
 if (['stall.ai5.read', 'stall.ai5.operate'].includes(step.tool)) {
  const bundle = await owner(`/api/stall/merchandising?sku=${encodeURIComponent(args.sku)}`);
  if (step.tool === 'stall.ai5.read') requireValue(isDeepStrictEqual(result, bundle), 'Source tool differs from the approved native source bundle.');
  else {
   const proposal = bundle.proposals.find(entry => entry.id === result.id);
   requireValue(isDeepStrictEqual(result, proposal) && proposal.status === 'draft' && !proposal.approval && proposal.sourceRevision === args.revision, 'Merchandising preparation did not retain the exact unapproved native proposal.');
   requireValue(proposal.changes.length === args.changes.length && args.changes.every((requested, index) => {
    const change = proposal.changes[index];
    return change.field === requested.field && change.value === requested.value && change.target === requested.target
     && requested.citations.every(citation => change.citations.includes(citation))
     && (change.field === 'channel' || isDeepStrictEqual(change.citations, requested.citations));
   }), 'Proposal changed the requested cited merchant facts.');
  }
 }
}

/** Existing native personal grants must reach scoped tools and retain revocation. */
export default async function journey(context) {
 const owner = nativeOwner(context), sku = `door-local-${crypto.randomUUID()}`;
 const draft = await command(owner, 'product.prepare', { sku, name: 'Local credential pouch', description: 'Owner confirmed cotton pouch.', unitCents: 900, active: false });
 const grant = await owner('/api/stall/agent-token', {});
 requireValue(grant.id && grant.token, 'Native personal agent issuance omitted its grant.');
 try {
  const read = await context.tool('stall.catalog1.read', { sku }, { token: grant.token, track: false });
  requireValue(read.status === 200 && !read.result?.isError && isDeepStrictEqual(read.result?.structuredContent, draft), 'Existing native personal credential could not read through the scoped door.');
  const approval = await context.request(new URL('/api/stall/commands', context.origin).href, {
   method: 'POST', headers: { Origin: context.origin, Authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' },
   body: JSON.stringify({ type: 'product.approve', payload: { sku, revision: draft.revision } }),
  });
  const refusal = await approval.json();
  requireValue(approval.status === 403 && refusal.error?.code === 'PERSON_REQUIRED', 'Native personal agent grant crossed the person approval boundary.');
  const state = await owner('/api/stall/state');
  requireValue(isDeepStrictEqual(state.products.find(entry => entry.id === sku), draft), 'Refused personal-agent approval changed the native product.');
 } finally {
  await owner('/api/stall/agent-token/revoke', { grantId: grant.id });
 }
 const revoked = await context.tool('stall.catalog1.read', { sku }, { token: grant.token, track: false });
 requireValue(revoked.status === 401 && revoked.result?.structuredContent === undefined, 'Revoked native credential retained scoped read access.');
}
