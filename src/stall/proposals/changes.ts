import { fail, text, type ProductValue } from '../model'
import { strictObject } from '../facts'
import { productDetails } from '../product-details'
import { handleOf } from '../listing-checks'
import { sellables } from '../listing'
import type { Change, Feed, Source, Preview } from './model'

export function proposalChanges(input: unknown, sources: Source[]): Change[] {
 if (!Array.isArray(input) || !input.length || input.length > 40) fail('INPUT', 'Propose between one and forty cited changes.', 400)
 const seen = new Set<string>()
 return input.map((item, index) => {
  const entry = strictObject(item, ['field', 'target', 'value', 'citations'], 'Proposed change')
  const field = text(entry.field, 'Change field'), value = text(entry.value, 'Proposed value', 4000)
  if (!['name', 'description', 'alt', 'attribute', 'seoTitle', 'seoDescription', 'collection', 'channel'].includes(field)) fail('UNSUPPORTED_CLAIM', 'Inventory, certifications and reviews cannot be invented or changed by this proposal.', 400)
  if (!Array.isArray(entry.citations) || !entry.citations.length || entry.citations.length > 20) fail('UNSUPPORTED_CLAIM', 'Every proposed change needs approved source citations.', 400)
  const citations = entry.citations.map(id => text(id, 'Source citation')), cited = citations.map(id => sources.find(source => source.id === id))
  if (cited.some(source => !source) || new Set(citations).size !== citations.length) fail('UNSUPPORTED_CLAIM', 'Cite each existing approved source once.', 400)
  const facts = cited as Source[], target = entry.target === undefined ? undefined : text(entry.target, 'Change target', 100)
  const key = `${field}:${target ?? ''}`
  if (seen.has(key)) fail('INPUT', 'Propose each field once.', 400)
  seen.add(key)
  if (field === 'channel') {
   if (target || value !== 'google_product' || !citations.includes('sku')) fail('UNSUPPORTED_CLAIM', 'A channel draft maps this product SKU to Google product fields.', 400)
  } else if (field === 'collection') {
   if (value !== target || !facts.some(source => source.id === `collection:${target}`) || facts.length !== 1) fail('UNSUPPORTED_CLAIM', 'Choose one existing cited manual collection.', 400)
  } else {
   if (facts.some(source => source.kind === 'collection') || value !== facts.map(source => source.value).join(' · ')) fail('UNSUPPORTED_CLAIM', 'Proposed wording must use the cited merchant facts exactly, joined with a middle dot. Answer missing facts before adding claims.', 400)
   if (field === 'alt' && (!target || !citations.includes(`media:${target}`))) fail('UNSUPPORTED_CLAIM', 'Alt text must cite this exact image or video description.', 400)
   if (field === 'attribute' && (!target || facts.length !== 1 || !['attribute', 'fact', 'variant'].includes(facts[0].kind) || facts[0].label.toLowerCase() !== target.toLowerCase())) fail('UNSUPPORTED_CLAIM', 'An attribute must retain the cited merchant fact label and value.', 400)
   if (!['alt', 'attribute'].includes(field) && target) fail('INPUT', 'This field has no target.', 400)
  }
  return { id: String(index + 1), field: field as Change['field'], ...(target ? { target } : {}), value, citations: field === 'channel' ? [...new Set([...citations, ...sources.filter(source => ['sku', 'name', 'description', 'price', 'handle', 'media', 'variant'].includes(source.kind)).map(source => source.id)])] : citations }
 })
}
export function channelFeed(value: Omit<ProductValue, 'draft'>, origin: string): Feed {
 const details = value.details ?? {}, image = details.media?.find(entry => entry.kind === 'image'), errors = ['Availability needs current connected inventory evidence before channel submission.']
 if (!origin.startsWith('https://')) errors.push('Channel links require an HTTPS shop address.')
 if (!image) errors.push('A product image is required.')
 if (!value.description) errors.push('A product description is required.')
 const items = sellables(value).map(item => ({ id: item.sku, item_group_id: value.sku, title: value.name, description: value.description, price: `${(item.unitCents / 100).toFixed(2)} USD`, link: `${origin}/shop/${handleOf(value)}`, ...(image ? { image_link: `${origin}/api/stall/media/${item.variant?.mediaId ?? image.id}` } : {}), ...(item.variant ? { attributes: item.variant.options } : {}) }))
 return { channel: 'google_product', connected: false, valid: errors.length === 0, errors, warnings: ['Draft validation only. No channel is connected and nothing is submitted.'], items }
}
export function proposalPreview(value: ProductValue, changes: Change[], selected: unknown, origin: string): Preview {
 if (!Array.isArray(selected) || !selected.length || new Set(selected).size !== selected.length || selected.some(id => typeof id !== 'string' || !changes.some(change => change.id === id))) fail('SELECTION', 'Select existing proposed changes once each.', 400)
 const { draft: _draft, approval: _approval, ...product } = structuredClone(value), groups: string[] = []
 const details = product.details ??= {}
 for (const change of changes.filter(change => selected.includes(change.id))) {
  switch (change.field) {
   case 'name': product.name = text(change.value, 'Name', 160); break
   case 'description': product.description = change.value; break
   case 'alt': { const image = details.media?.find(entry => entry.id === change.target); if (!image) fail('SOURCE_CHANGED', 'The cited media is missing.'); image.alt = text(change.value, 'Alt text', 300); break }
   case 'attribute': details.attributes = [...(details.attributes ?? []).filter(entry => entry.name.toLowerCase() !== change.target!.toLowerCase()), { name: change.target!, value: change.value }]; break
   case 'seoTitle': details.seo = { ...details.seo, title: text(change.value, 'SEO title', 160) }; break
   case 'seoDescription': details.seo = { ...details.seo, description: text(change.value, 'SEO description', 400) }; break
   case 'collection': groups.push(change.value); break
   case 'channel': break
  }
 }
 product.details = productDetails(details)
 return { product, collections: groups, feed: channelFeed(product, origin) }
}
