import type { ProductValue, Approval } from '../model'
export type Source = { id: string; label: string; value: string; kind: string }
export type Change = { id: string; field: 'name' | 'description' | 'alt' | 'attribute' | 'seoTitle' | 'seoDescription' | 'collection' | 'channel'; target?: string; value: string; citations: string[] }
export type Feed = { channel: 'google_product'; connected: false; valid: boolean; errors: string[]; warnings: string[]; items: Record<string, unknown>[] }
export type Proposal = { id: string; revision: string; sku: string; sourceRevision: string; sourceDigest: string; sources: Source[]; changes: Change[]; questions: string[]; unsupported: string[]; preparedBy: string; createdAt: string; status: 'draft' | 'published' | 'restored'; selected?: string[]; approval?: Approval; feed?: Feed }
export type ProposalBundle = { sku: string; revision: string; sources: Source[]; questions: string[]; proposals: Proposal[] }
export type Preview = { product: Omit<ProductValue, 'draft'>; collections: string[]; feed: Feed }
