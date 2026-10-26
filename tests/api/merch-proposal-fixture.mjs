import { sendFile, solidPng } from './network.mjs'
export const merchSku = 'synthetic-stall-901'
export const merchVariant = 'synthetic-stall-902'
export async function merchandisingFixture(h) {
 const uploaded = await sendFile(h, '/api/stall/media', solidPng(400, 400, [172, 132, 96]), 'image/png')
 const media = await uploaded.json()
 if (uploaded.status !== 200) throw new Error(JSON.stringify(media))
 const draft = await h.command('product.prepare', { sku: merchSku, name: 'Studio mug', description: 'Hand-thrown mug', unitCents: 2400, active: true, details: { handle: 'studio-mug', categories: ['Ceramics'], customFields: [{ key: 'finish', label: 'Finish', type: 'text', value: 'Matte glaze' }], media: [{ id: media.id, kind: 'image', alt: 'Side view of Studio mug' }], options: [{ name: 'Color', values: ['Clay'] }], variants: [{ sku: merchVariant, options: { Color: 'Clay' }, unitCents: 2600, mediaId: media.id }] } })
 const product = await h.command('product.approve', { sku: merchSku, revision: draft.revision })
 await h.command('collection.save', { handle: 'ceramics', title: 'Ceramics', description: 'Pieces for everyday use', kind: 'manual', skus: [] })
 const grant = await h.api('/api/stall/agent-token', {})
 const agent = { as: '', headers: { authorization: `Bearer ${grant.token}` } }
 const source = await h.api(`/api/stall/merchandising?sku=${merchSku}`, undefined, agent)
 const changes = [
  { field: 'name', value: 'Studio mug · Matte glaze', citations: ['name', 'fact:finish'] },
  { field: 'description', value: 'Hand-thrown mug · Matte glaze', citations: ['description', 'fact:finish'] },
  { field: 'alt', target: media.id, value: 'Side view of Studio mug · Studio mug', citations: [`media:${media.id}`, 'name'] },
  { field: 'attribute', target: 'Finish', value: 'Matte glaze', citations: ['fact:finish'] },
  { field: 'seoTitle', value: 'Studio mug · Matte glaze', citations: ['name', 'fact:finish'] },
  { field: 'seoDescription', value: 'Hand-thrown mug · Matte glaze', citations: ['description', 'fact:finish'] },
  { field: 'collection', target: 'ceramics', value: 'ceramics', citations: ['collection:ceramics'] },
  { field: 'channel', value: 'google_product', citations: ['sku'] },
 ]
 return { product, media, grant, agent, source, changes, input: { sku: merchSku, revision: source.revision, changes, requests: ['inventory', 'certification', 'reviews'] } }
}
