import { HistoricalOrderImport } from './customer-history-import'
import { MerchantCustomerBalances } from './customer-balances'
import { RegistrationRequests } from './customer-registration'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { HydrationUnit } from '../../base/hydration/unit'
import { errorMessage, money, request } from './api'
import { Notice } from './primitives'
import { When, usePerson } from './presentation'
import { AddressFields, blankAddress } from './address-book'
import type { Address } from './customer-types'

type SavedAddress = { id: string; email: string; revision: string; address: Address }
type Customer = { id: string; revision: string; name: string; emails: string[]; tags: string[]; notes: { id: string; text: string; by: string; at: string }[]; addresses?: SavedAddress[]; states: string[]; orderCount: number; paidCents: number; refundedCents: number; lifetimeValueCents: number }
type Segment = { id: string; revision: string; members: string[]; value: { name: string; tag: string; minimumSpentCents: number; minimumOrders: number; state: string } }
type Directory = { customers: Customer[]; segments: Segment[] }
type Preview = { rows: { row: number; email: string; name: string; tags: string[]; status: string; customerId?: string }[]; fingerprint: string; newCount: number; duplicateCount: number }
type Save = (body: unknown, message: string) => Promise<boolean>
const labelOf = (customer: Customer) => customer.name || customer.emails[0] || 'Unnamed customer'

function CustomerImport({ busy, apply }: { busy: boolean; apply: (body: unknown, message: string, path?: string) => Promise<boolean> }) {
  const [input, setInput] = useState(''), [preview, setPreview] = useState<Preview>(), [rows, setRows] = useState<unknown[]>(), [error, setError] = useState(''), [reviewing, setReviewing] = useState(false)
  const lock = useRef(false)
  async function inspect(event: FormEvent) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setReviewing(true); setError(''); setPreview(undefined)
    try {
      const parsed: unknown = JSON.parse(input)
      if (!Array.isArray(parsed)) throw new Error('Supply a JSON array of customer rows.')
      const checked = await request<Preview>('/api/stall/customers/import/preview', { rows: parsed })
      setRows(parsed); setPreview(checked)
    } catch (error) { setError(errorMessage(error)) }
    finally { lock.current = false; setReviewing(false) }
  }
  return <details className="st-panel st-stack"><summary>Import customers</summary>
    <p>Import 1 to 200 rows with email, optional name and optional tags. Exact normalized emails are skipped when already recorded or repeated in this import. Similar names remain separate. Importing does not create a sign-in account.</p>
    <form className="st-stack" aria-label="Import customers" onSubmit={event => void inspect(event)}>
      <label>Customer rows · JSON<textarea required rows={7} value={input} disabled={busy || reviewing} placeholder={'[{"email":"customer@example.com","name":"Customer name","tags":["repeat"]}]'} onChange={event => { setInput(event.target.value); setPreview(undefined); setRows(undefined); setError('') }} /></label>
      <div className="st-actions"><button disabled={busy || reviewing}>{reviewing ? 'Checking rows…' : 'Preview import'}</button></div>
    </form>
    {error && <Notice error>{error}</Notice>}
    {preview && <section className="st-stack" aria-label="Import preview">
      <h3>Review import</h3><p>{preview.newCount} new · {preview.duplicateCount} duplicate rows skipped</p>
      <ol>{preview.rows.map(row => <li key={row.row} style={{ overflowWrap: 'anywhere' }}>Row {row.row + 1}: {row.email} · {row.name || 'No name'} · {row.status === 'new' ? 'Create customer' : row.customerId ? 'Skip existing email' : 'Skip repeated email'}</li>)}</ol>
      <div className="st-actions"><button disabled={busy || reviewing || !preview.newCount} onClick={() => void apply({ rows, fingerprint: preview.fingerprint }, 'Customer import completed. Duplicate rows were skipped.', '/api/stall/customers/import/apply').then(ok => { if (ok) { setInput(''); setRows(undefined); setPreview(undefined) } })}>Import {preview.newCount} new customers</button></div>
    </section>}
  </details>
}

function CustomerEditor({ customer, busy, save }: { customer: Customer; busy: boolean; save: Save }) {
  const [name, setName] = useState(customer.name), [tags, setTags] = useState(customer.tags.join(', ')), [note, setNote] = useState('')
  const person = usePerson()
  return <div className="st-stack">
    <form className="st-stack" aria-label="Customer profile" onSubmit={event => { event.preventDefault(); void save({ type: 'profile.save', id: customer.id, revision: customer.revision, name, tags: tags.split(',').map(tag => tag.trim()).filter(Boolean) }, 'Customer profile saved.') }}>
      <div className="st-form-grid"><label>Name<input maxLength={200} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><label>Tags · separated by commas<input value={tags} disabled={busy} onChange={event => setTags(event.target.value)} /></label></div>
      <div className="st-actions"><button disabled={busy}>Save customer profile</button></div>
    </form>
    <section className="st-stack" aria-label="Customer notes"><h3>Merchant notes</h3><p className="st-small">These notes stay in the shop desk and are excluded from the customer account.</p>
      {!customer.notes.length && <p>No notes recorded.</p>}
      {customer.notes.map(item => <article key={item.id}><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.text}</p><p className="st-small">{person(item.by)} · <When at={item.at} /></p></article>)}
      <form className="st-stack" aria-label="Add customer note" onSubmit={event => { event.preventDefault(); void save({ type: 'note.add', id: customer.id, revision: customer.revision, text: note }, 'Customer note added.').then(ok => { if (ok) setNote('') }) }}>
        <label>New merchant note<textarea required maxLength={2000} rows={3} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
        <div className="st-actions"><button disabled={busy || !note.trim()}>Add note</button></div>
      </form>
    </section>
  </div>
}

function CustomerMerge({ source, customers, busy, save }: { source: Customer; customers: Customer[]; busy: boolean; save: Save }) {
  const [targetId, setTargetId] = useState(''), [reviewed, setReviewed] = useState(false), target = customers.find(customer => customer.id === targetId)
  return <details className="st-stack"><summary>Review a customer merge</summary>
    <p>Choose the directory record to keep. Its name is retained; email associations, tags and merchant notes combine. The source directory record is removed. Each mailbox keeps its own order access and address book; no customer sign-in authority changes.</p>
    <label>Keep customer<select aria-label="Keep customer" value={targetId} disabled={busy} onChange={event => { setTargetId(event.target.value); setReviewed(false) }}><option value="">Choose another customer…</option>{customers.filter(customer => customer.id !== source.id).map(customer => <option value={customer.id} key={customer.id}>{labelOf(customer)} · {customer.emails.join(', ')}</option>)}</select></label>
    {target && <section className="st-panel st-stack" aria-label="Merge review">
      <h3>Review metadata merge</h3>
      <p style={{ overflowWrap: 'anywhere' }}>Remove source: {labelOf(source)} · {source.emails.join(', ')}</p>
      <p style={{ overflowWrap: 'anywhere' }}>Keep target: {labelOf(target)} · {target.emails.join(', ')}</p>
      <p>Combined tags: {[...new Set([...target.tags, ...source.tags])].join(', ') || 'None'}. Retained notes: {target.notes.length + source.notes.length}.</p>
      <label className="st-checkbox"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} />I reviewed these two records and approve this metadata merge.</label>
      <div className="st-actions"><button disabled={busy || !reviewed} onClick={() => void save({ type: 'merge', id: source.id, revision: source.revision, targetId: target.id, targetRevision: target.revision }, 'Directory records merged. Customer account access is unchanged.')}>Merge reviewed records</button></div>
    </section>}
  </details>
}

function MerchantAddresses({ customer, addresses, busy, save }: { customer: Customer; addresses: SavedAddress[]; busy: boolean; save: (body: unknown, message: string, method?: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState<SavedAddress>(), [address, setAddress] = useState<Address>(blankAddress), [mailbox, setMailbox] = useState(customer.emails[0] ?? '')
  const identity = { customerId: customer.id, customerRevision: customer.revision, email: mailbox }
  return <section className="st-stack" aria-label="Customer addresses"><h3>Saved addresses</h3><p className="st-small">Each saved address stays with its named mailbox. Changes here do not replace addresses recorded on past orders.</p>
    {!addresses.length && <p>No saved addresses.</p>}
    {addresses.map(saved => <article key={saved.id} className="st-stack" aria-label={`Saved address for ${saved.address.name}`}>
      <p>{saved.email}</p><address>{saved.address.name}<br />{saved.address.line1}<br />{saved.address.line2 && <>{saved.address.line2}<br /></>}{saved.address.city}, {saved.address.state} {saved.address.postal_code}<br />{saved.address.country}</address>
      <div className="st-actions"><button className="st-secondary" disabled={busy} onClick={() => { setEditing(saved); setAddress(saved.address); setMailbox(saved.email) }}>Edit saved address</button><button className="st-secondary" disabled={busy} onClick={() => void save({ customerId: customer.id, customerRevision: customer.revision, email: saved.email, id: saved.id, revision: saved.revision }, 'Customer address removed.', 'DELETE')}>Remove saved address</button></div>
    </article>)}
    <details open={!!editing || !addresses.length}><summary>{editing ? 'Edit customer address' : 'Add customer address'}</summary>
      <form className="st-stack" aria-label="Merchant customer address" onSubmit={event => { event.preventDefault(); void save({ ...identity, ...(editing ? { id: editing.id, revision: editing.revision } : {}), address }, 'Customer address saved.') }}>
        <label>Address mailbox<select aria-label="Address mailbox" required value={mailbox} disabled={busy || !!editing} onChange={event => setMailbox(event.target.value)}>{customer.emails.map(email => <option key={email} value={email}>{email}</option>)}</select></label>
        <div className="st-form-grid"><AddressFields value={address} change={setAddress} disabled={busy} /></div>
        <div className="st-actions"><button disabled={busy}>Save customer address</button>{editing && <button type="button" className="st-secondary" disabled={busy} onClick={() => { setEditing(undefined); setAddress(blankAddress) }}>Cancel address edit</button>}</div>
      </form>
    </details>
  </section>
}

function SegmentEditor({ segment, busy, save, close }: { segment?: Segment; busy: boolean; save: Save; close: () => void }) {
  const [name, setName] = useState(segment?.value.name ?? ''), [tag, setTag] = useState(segment?.value.tag ?? ''), [spent, setSpent] = useState(((segment?.value.minimumSpentCents ?? 0) / 100).toFixed(2)), [orders, setOrders] = useState(String(segment?.value.minimumOrders ?? 0)), [state, setState] = useState(segment?.value.state ?? '')
  return <form className="st-stack st-editor" aria-label="Customer segment" onSubmit={event => { event.preventDefault(); void save({ type: 'segment.save', ...(segment ? { id: segment.id, revision: segment.revision } : {}), segment: { name, tag, minimumSpentCents: Math.round(Number(spent) * 100), minimumOrders: Number(orders), state } }, 'Customer segment saved. Membership reflects current orders and refunds.').then(ok => { if (ok) close() }) }}>
    <h3>{segment ? 'Edit segment' : 'New segment'}</h3>
    <div className="st-form-grid">
      <label>Segment name<input required maxLength={100} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <label>Required tag<input maxLength={40} value={tag} disabled={busy} onChange={event => setTag(event.target.value)} /></label>
      <label>Minimum net lifetime value · USD<input required type="number" min="0" step="0.01" value={spent} disabled={busy} onChange={event => setSpent(event.target.value)} /></label>
      <label>Minimum paid orders<input required type="number" min="0" max="1000000" step="1" value={orders} disabled={busy} onChange={event => setOrders(event.target.value)} /></label>
      <label>State or province · two letters<input maxLength={2} pattern="[A-Za-z]{2}" value={state} disabled={busy} onChange={event => setState(event.target.value.toUpperCase())} /></label>
    </div><p className="st-small">Every filled condition must match. Blank tag and state include all values. Membership recalculates from paid orders, succeeded refunds and saved addresses whenever the directory is refreshed.</p>
    <div className="st-actions"><button disabled={busy}>Save segment</button><button type="button" className="st-secondary" disabled={busy} onClick={close}>Cancel segment</button></div>
  </form>
}

export function CustomerDirectory({ canManage, canReviewRegistration=false, query }: { canManage: boolean; canReviewRegistration?:boolean; query?: string }) {
  const [data, setData] = useState<Directory>(), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [search, setSearch] = useState(''), [selected, setSelected] = useState(''), [segmentId, setSegmentId] = useState(''), [editing, setEditing] = useState<Segment | null | undefined>()
  const lock = useRef(false)
  async function refresh() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { setData(await request<Directory>('/api/stall/customers')) }
    catch (error) { setError(errorMessage(error)) }
    finally { lock.current = false; setBusy(false) }
  }
  useEffect(() => { void refresh() }, [])
  async function apply(body: unknown, message: string, path = '/api/stall/customers', method = 'POST') {
    if (lock.current) return false
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { setData(await request<Directory>(path, body, method)); setNotice(message); return true }
    catch (error) { setError(errorMessage(error)); return false }
    finally { lock.current = false; setBusy(false) }
  }
  const chosen = data?.customers.find(customer => customer.id === selected), segment = data?.segments.find(item => item.id === segmentId), term = (query ?? search).trim().toLowerCase()
  const visible = data?.customers.filter(customer => (!segment || segment.members.includes(customer.id)) && (!term || [customer.name, ...customer.emails, ...customer.tags].some(value => value.toLowerCase().includes(term)))) ?? []
  return <HydrationUnit><section className="st-orders st-stack" style={{ overflowWrap: 'anywhere' }} aria-labelledby="customers-title">
    <div className="st-view-head"><h1 id="customers-title">Customers</h1><button className="st-secondary" disabled={busy} onClick={() => void refresh()}>Refresh customers</button></div>
    <p>Manage customer profiles, merchant notes and live segments.</p>
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    {!data && !error && <p role="status">Loading customers…</p>}
    {data && <>
      {canReviewRegistration&&<RegistrationRequests/>}
      {canManage && <CustomerImport busy={busy} apply={apply} />}
      <HistoricalOrderImport canManage={canManage} onImported={refresh}/>
      <section className="st-panel st-stack" aria-label="Saved customer segments"><h2>Saved segments</h2>
        <div className="st-actions"><button className="st-secondary" disabled={busy} onClick={() => setEditing(null)}>New segment</button></div>
        {editing !== undefined && <SegmentEditor key={editing?.revision ?? 'new'} segment={editing ?? undefined} busy={busy} save={apply} close={() => setEditing(undefined)} />}
        {!data.segments.length && <p>No saved segments yet.</p>}
        {data.segments.map(item => <article key={item.id} className="st-stack" aria-label={`Segment ${item.value.name}`}><h3>{item.value.name}</h3><p>{item.members.length} matching customers · Tag: {item.value.tag || 'Any'} · Net value from {money(item.value.minimumSpentCents)} · Paid orders from {item.value.minimumOrders} · State or province: {item.value.state || 'Any'}</p><div className="st-actions"><button className="st-secondary" onClick={() => setSegmentId(item.id)}>View segment customers</button><button className="st-secondary" disabled={busy} onClick={() => setEditing(item)}>Edit segment</button></div></article>)}
      </section>
      <div className="st-form-grid">{query === undefined && <label>Search customers<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>}<label>Customer segment<select aria-label="Customer segment" value={segmentId} onChange={event => setSegmentId(event.target.value)}><option value="">All customers</option>{data.segments.map(item => <option value={item.id} key={item.id}>{item.value.name} · {item.members.length}</option>)}</select></label></div>
      <p>{visible.length} customers shown{segment ? ` in ${segment.value.name}` : ''}</p>
      <p className="st-small">Paid order count includes recorded payments. Net lifetime value is paid USD totals less succeeded refunds; pending refunds do not reduce it. Refresh to include new orders and refunds.</p>
      {!visible.length && <p>No customers match this view.</p>}
      <div className="st-stack" aria-label="Customer directory">{visible.map(customer => <article className="st-panel st-stack" key={customer.id} aria-label={`Customer ${customer.emails[0]}`}>
        <h2>{labelOf(customer)}</h2><p style={{ overflowWrap: 'anywhere' }}>{customer.emails.join(', ')}</p><p>Tags: {customer.tags.join(', ') || 'None'}</p>
        <dl className="st-definition"><div><dt>Paid orders</dt><dd>{customer.orderCount}</dd></div><div><dt>Paid total</dt><dd>{money(customer.paidCents)}</dd></div><div><dt>Succeeded refunds</dt><dd>{money(customer.refundedCents)}</dd></div><div><dt>Net lifetime value</dt><dd>{money(customer.lifetimeValueCents)}</dd></div></dl>
        <p>Observed states and provinces: {customer.states.join(', ') || 'None recorded'}</p>
        <div className="st-actions"><button className="st-secondary" disabled={busy} aria-expanded={selected === customer.id} onClick={() => setSelected(selected === customer.id ? '' : customer.id)}>{selected === customer.id ? 'Close customer details' : 'Manage customer'}</button></div>
        {chosen?.id === customer.id && <div key={customer.revision} className="st-stack"><CustomerEditor customer={customer} busy={busy} save={apply} />{canManage && customer.addresses && <MerchantAddresses customer={customer} addresses={customer.addresses} busy={busy} save={(body, message, method) => apply(body, message, '/api/stall/customers/addresses', method)} />}{canManage && <MerchantCustomerBalances emails={customer.emails}/>} {canManage && <CustomerMerge source={customer} customers={data.customers} busy={busy} save={apply} />}</div>}
      </article>)}</div>
    </>}
  </section></HydrationUnit>
}
