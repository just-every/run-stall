import { products } from '../store'
import { collections } from '../collections'
import { digest } from '../access'
import { fail } from '../model'
import { handleOf } from '../listing-checks'
import type { Source } from './model'

/** Only approved public catalog facts enter agent context. No customers or costs. */
export async function proposalSources(db: D1Database, sku: string) {
 const product = (await products(db)).find(entry => entry.id === sku)
 if (!product?.value.approval || product.value.draft) fail('SOURCE_APPROVAL', 'Approve the merchant facts and finish the existing product draft first.')
 const value = product.value, details = value.details ?? {}, groups = await collections(db), sources: Source[] = []
 const add = (id: string, label: string, value: string, kind: string) => { if (value) sources.push({ id, label, value, kind }) }
 add('sku', 'Product SKU', sku, 'sku'); add('name', 'Approved name', value.name, 'name')
 add('description', 'Approved description', value.description, 'description')
 add('price', 'Approved price in USD', (value.unitCents / 100).toFixed(2), 'price')
 add('handle', 'Shop page handle', handleOf(value), 'handle')
 for (const [i, entry] of (details.attributes ?? []).entries()) add(`attribute:${i}`, entry.name, entry.value, 'attribute')
 for (const [i, entry] of (details.categories ?? []).entries()) add(`category:${i}`, 'Category', entry, 'category')
 for (const entry of details.customFields ?? []) if (entry.type === 'text') add(`fact:${entry.key}`, entry.label, entry.value, 'fact')
 for (const entry of details.media ?? []) add(`media:${entry.id}`, `Approved ${entry.kind} description`, entry.alt, 'media')
 for (const variant of details.variants ?? []) if (!variant.archived) {
  add(`variant:${variant.sku}:price`, `${variant.sku} price in USD`, ((variant.unitCents ?? value.unitCents) / 100).toFixed(2), 'price')
  for (const [name, choice] of Object.entries(variant.options)) add(`variant:${variant.sku}:${name}`, `${variant.sku} · ${name}`, choice, 'variant')
 }
 for (const group of groups) if (group.value.kind === 'manual') add(`collection:${group.id}`, `Collection · ${group.value.title}`, group.id, 'collection')
 const factNames = sources.filter(entry => ['attribute', 'fact'].includes(entry.kind)).map(entry => entry.label.toLowerCase())
 const questions = [['size', 'What are the product measurements and size guidance?'], ['material', 'What materials are confirmed by the merchant?'], ['safety', 'What safety instructions or restrictions are confirmed?']].filter(([key]) => !factNames.some(name => name.includes(key))).map(([, question]) => question)
 const sourceDigest = await digest(JSON.stringify({ revision: product.revision, sources, collections: groups.map(group => [group.id, group.revision]) }))
 return { product, groups, sources, questions, sourceDigest }
}
