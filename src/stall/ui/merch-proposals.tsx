import { useEffect, useState } from 'react'
import type { Change, Feed, Preview, Proposal, ProposalBundle, Source } from '../proposals/model'
import type { Product, Run } from './types'
import { errorMessage, request } from './api'
import { Badge, Notice } from './primitives'
import { shortId, usePerson, When } from './presentation'

const labels: Record<Change['field'], string> = { name: 'Product name', description: 'Description', alt: 'Image alt text', attribute: 'Attribute', seoTitle: 'SEO title', seoDescription: 'SEO description', collection: 'Collection', channel: 'Channel mapping' }
const wrap = { overflowWrap: 'anywhere' as const, minWidth: 0 }

function Sources({ sources }: { sources: Source[] }) {
  return <dl className="st-stack" style={wrap}>{sources.map(source => <div key={source.id}>
    <dt><strong>{source.label}</strong> <code className="st-small">{source.id}</code></dt><dd style={{ marginInlineStart: 0 }}>{source.value}</dd>
  </div>)}</dl>
}

function Questions({ questions, unsupported = [] }: { questions: string[]; unsupported?: string[] }) {
  return <>{!!questions.length && <div><h4>Unanswered questions</h4><p className="st-small">Add verified facts to the product and approve that revision before requesting another proposal.</p><ul>{questions.map(question => <li key={question}>{question}</li>)}</ul></div>}
    {!!unsupported.length && <Notice error><strong>Unsupported requests refused</strong><ul>{unsupported.map(item => <li key={item}>{item}</li>)}</ul><p>Inventory, certification and reviews cannot be inferred from this source bundle.</p></Notice>}</>
}

function FeedReview({ feed }: { feed: Feed }) {
  return <section aria-label="Channel feed validation" className="st-stack" style={wrap}>
    <div className="st-row"><h4>Google product feed</h4><Badge value={feed.valid ? 'Valid mapping' : 'Validation blocked'} tone={feed.valid ? undefined : 'need'} /></div>
    <p>No channel is connected. Selecting the channel change saves a mapping in Stall; it does not publish a feed to Google.</p>
    {!!feed.errors.length && <Notice error><strong>Feed errors</strong><ul>{feed.errors.map(error => <li key={error}>{error}</li>)}</ul></Notice>}
    {!!feed.warnings.length && <div><strong>Feed warnings</strong><ul>{feed.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
    <details><summary>Inspect mapped feed fields</summary>{feed.items.map((item, index) => <dl className="st-stack" key={index}>{Object.entries(item).map(([key, value]) => <div key={key}><dt><strong>{key}</strong></dt><dd style={{ marginInlineStart: 0 }}>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>)}</dl>)}</details>
  </section>
}

function currentValue(product: Product, change: Change) {
  const details = product.value.details
  switch (change.field) {
    case 'name': return product.value.name
    case 'description': return product.value.description
    case 'alt': return details?.media?.find(item => item.id === change.target)?.alt ?? 'No alt text'
    case 'attribute': return details?.attributes?.find(item => item.name === change.target)?.value ?? 'Not set'
    case 'seoTitle': return details?.seo?.title ?? 'Not set'
    case 'seoDescription': return details?.seo?.description ?? 'Not set'
    case 'collection': return 'Review membership in the preview'
    case 'channel': return 'Review mapping in the preview'
  }
}

function ProposalReview({ proposal, product, bundleRevision, busy, loading, canApprove, run, refresh }: { proposal: Proposal; product: Product; bundleRevision: string; busy: boolean; loading: boolean; canApprove: boolean; run: Run; refresh: () => void }) {
  const person = usePerson(), [selected, setSelected] = useState<string[]>([]), [review, setReview] = useState<{ key: string; value: Preview } | null>(null), [working, setWorking] = useState(false), [error, setError] = useState('')
  const draft = proposal.status === 'draft', stale = proposal.sourceRevision !== bundleRevision
  const key = JSON.stringify([proposal.revision, bundleRevision, product.revision, [...selected].sort()]), reviewed = review?.key === key ? review.value : null
  const disabled = busy || working || loading || stale || !draft
  async function preview() {
    setWorking(true); setError(''); setReview(null)
    try { const value = await request<Preview>('/api/stall/merchandising/preview', { id: proposal.id, revision: proposal.revision, selected }); setReview({ key, value }) }
    catch (failure) { setError(errorMessage(failure)) }
    finally { setWorking(false) }
  }
  async function approve() {
    if (!reviewed || !selected.length || disabled) return
    setWorking(true); setError('')
    try { if (await run('merch.approve', { id: proposal.id, revision: proposal.revision, selected })) { setReview(null); refresh() } }
    catch (failure) { setError(errorMessage(failure)) }
    finally { setWorking(false) }
  }
  return <details open={draft} className="st-panel-block" data-proposal-id={proposal.id} style={wrap}>
    <summary>Proposal {shortId(proposal.id)} · {proposal.status === 'published' ? 'Approved' : proposal.status === 'restored' ? 'Restored history' : 'Awaiting review'}</summary>
    <div className="st-stack">
      <p className="st-small">Prepared by {person(proposal.preparedBy)} · <When at={proposal.createdAt} /> · source revision {shortId(proposal.sourceRevision)}</p>
      {stale && draft && <Notice error>The product has changed. This proposal is stale and cannot be approved. Ask the agent to prepare a proposal from the current source bundle.</Notice>}
      <Questions questions={proposal.questions} unsupported={proposal.unsupported} />
      <h4>{draft ? 'Select changes to review' : 'Proposed changes'}</h4>
      {proposal.changes.map((change, index) => <div key={change.id} className="st-panel-block" data-change-field={change.field}>
        {draft ? <label className="st-checkbox"><input type="checkbox" aria-label={`Select ${labels[change.field]}${change.target ? ` · ${change.target}` : ''}`} checked={selected.includes(change.id)} disabled={disabled} onChange={event => { setSelected(event.target.checked ? [...selected, change.id] : selected.filter(id => id !== change.id)); setReview(null) }} /><strong>{labels[change.field]}{change.target && ` · ${change.target}`}</strong></label>
          : <h4>{labels[change.field]}{change.target && ` · ${change.target}`} · {proposal.selected?.includes(change.id) ? 'Approved' : 'Not applied'}</h4>}
        {draft && <p><span className="st-small">Current</span><br />{currentValue(product, change)}</p>}
        <p><span className="st-small">Proposed</span><br />{change.value}</p>
        <details><summary>Sources for change {index + 1}</summary><Sources sources={proposal.sources.filter(source => change.citations.includes(source.id))} /></details>
      </div>)}
      {error && <Notice error>{error}</Notice>}
      {draft && <><p className="st-small">{selected.length} of {proposal.changes.length} changes selected. Unselected changes stay unchanged.</p>
        <button className="st-secondary" disabled={disabled || !selected.length} onClick={() => void preview()}>{working ? 'Working…' : 'Preview selected changes'}</button>
        {reviewed && <section className="st-note" aria-label="Exact selection preview"><div className="st-stack" style={wrap}>
          <h4>Exact selection ready for approval</h4><p>Only the {selected.length} selected changes shown above will be applied.</p>
          <p><strong>Resulting product name</strong><br />{reviewed.product.name}</p><p><strong>Resulting description</strong><br />{reviewed.product.description}</p>
          <p><strong>Collections to add</strong><br />{reviewed.collections.join(' · ') || 'No collection changes'}</p>
          <FeedReview feed={reviewed.feed} />
          {canApprove ? <button disabled={disabled} onClick={() => void approve()}>Approve {selected.length} selected {selected.length === 1 ? 'change' : 'changes'}</button> : <p>An owner or administrator must approve this exact selection.</p>}
        </div></section>}
      </>}
      {proposal.approval && <p className="st-small">Approved by {person(proposal.approval.by)} · <When at={proposal.approval.at} /></p>}
      {!draft && proposal.feed && <FeedReview feed={proposal.feed} />}
    </div>
  </details>
}

export function MerchProposals({ product, busy, run, canApprove }: { product: Product; busy: boolean; run: Run; canApprove: boolean }) {
  const [bundle, setBundle] = useState<ProposalBundle | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [version, setVersion] = useState(0)
  useEffect(() => {
    let current = true
    if (!product.value.approval || product.value.draft) { setLoading(false); return }
    setLoading(true); setError('')
    void request<ProposalBundle>(`/api/stall/merchandising?sku=${encodeURIComponent(product.id)}`).then(value => { if (current) setBundle(value) }).catch(failure => { if (current) setError(errorMessage(failure)) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [product.id, product.revision, version])
  if (!product.value.approval || product.value.draft) return <section className="st-panel-block"><h3>Merchandising proposals</h3><p>Approve the product and finish any existing product draft first to create its verified source bundle.</p></section>
  return <section className="st-panel-block st-stack" aria-label="Merchandising proposals" style={wrap}>
    <div className="st-row"><h3>Merchandising proposals</h3><button className="st-link" disabled={loading || busy} onClick={() => setVersion(value => value + 1)}>Refresh proposals</button></div>
    <p>Review agent proposals against approved product facts. Select the changes you want, preview the exact selection, then approve it.</p>
    <p className="st-small">Preparation requires an agent credential from <a href="#settings">Settings → Agent access</a>. The agent reads this source bundle and submits a proposal; nothing is generated in this panel.</p>
    <details><summary>Source rules and unsupported claims</summary><p>Proposal text must use cited source values exactly, joined with “ · ” when combining facts. Attribute and collection values each use one source. Missing size, material or safety facts remain questions. Inventory, certification and reviews are refused; approved product copy is not evidence of stock or certification.</p></details>
    {loading && <p role="status" className="st-small">Loading proposals…</p>}{error && <Notice error>{error}</Notice>}
    {bundle && <><details><summary>Approved source bundle · revision {shortId(bundle.revision)}</summary><Sources sources={bundle.sources} /></details>
      <Questions questions={bundle.questions} />
      {!bundle.proposals.length && <p className="st-small">No proposals yet. Ask your agent to prepare one using these sources.</p>}
      {bundle.proposals.map(proposal => <ProposalReview key={proposal.id} proposal={proposal} product={product} bundleRevision={bundle.revision} busy={busy} loading={loading || !!error} canApprove={canApprove} run={run} refresh={() => setVersion(value => value + 1)} />)}
    </>}
  </section>
}
