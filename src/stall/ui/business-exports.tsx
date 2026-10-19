import { useRef, useState } from 'react'
import { Notice, Section } from './primitives'
import { errorMessage } from './api'

const downloads = { products: 'Products', customers: 'Customers', orders: 'Orders', lines: 'Order lines', payments: 'Payments', refunds: 'Refunds', shipments: 'Shipments', reconciliation: 'Reconciliation', records: 'All business records (JSON)' }

export function BusinessExports() {
  const lock = useRef(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  async function download(kind: string) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/stall/exports/${kind}`, { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: unknown } } | null
        throw new Error(typeof body?.error?.message === 'string' ? body.error.message : 'The download could not finish. Try again.')
      }
      const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a')
      anchor.href = url; anchor.download = `stall-${kind}.${kind === 'records' ? 'json' : 'csv'}`
      document.body.appendChild(anchor); anchor.click(); anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice(`${downloads[kind as keyof typeof downloads]} downloaded. Keep customer data private.`)
    } catch (error) { setError(errorMessage(error)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <Section id="business-exports" title="Business exports">
    <p>Download every locally retained record, including drafts and outstanding orders. CSV files use exact integer cents, each record’s currency and UTC dates. Nested details are JSON cells. Spreadsheet text is escaped to prevent formulas; JSON keeps original text.</p>
    <p>Customer rows come from unerased order contacts; marketing consent is unknown. Variants, media, returns, gift cards, discounts, redirects and saved reports are not implemented. Provider fees, payouts and live stock history are held by providers. Credentials are excluded. Use the installation archive below for a restorable backup.</p>
    <p>Downloads read the current local data; concurrent changes can occur between catalog and order reads. Large exports must fit the server’s memory and response limits; a failure is shown instead of a shortened file.</p>
    {error && <Notice error>{error}</Notice>}{notice && <p role="status">{notice}</p>}
    <div className="st-actions">{Object.entries(downloads).map(([kind, label]) => <button key={kind} className="st-secondary" disabled={busy} onClick={() => void download(kind)}>{label}</button>)}</div>
  </Section>
}
