import { useRef, useState } from 'react'
import { errorMessage, request } from './api'
import { JsonDetail, Notice, Section } from './primitives'
interface Transfer { id: string; kind: 'export' | 'import'; phase: string; completed: number; total: number | null; requiredConfiguration?: string[] }
interface Archive { manifest: Record<string, unknown>; parts: { kind: string; index: number; [key: string]: unknown }[]; closing: { contentHash: string; archiveHash: string } }
const base = '/api/stall/portability'
export function Portability({ reload }: { reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [transfer, setTransfer] = useState<Transfer | null>(null), [archive, setArchive] = useState<Archive | null>(null), [confirmed, setConfirmed] = useState(false)
  const lock = useRef(false)
  async function act(action: () => Promise<void>) { if (lock.current) return; lock.current = true; setBusy(true); setError(''); setNotice(''); try { await action() } catch (error) { setError(errorMessage(error)) } finally { lock.current = false; setBusy(false) } }
  async function exportData() {
    const created = await request<{ id: string }>(`${base}/exports`, {})
    setTransfer(await request<Transfer>(`${base}/exports/${encodeURIComponent(created.id)}/advance`, {}))
  }
  async function download() {
    if (!transfer) return
    const response = await fetch(`${base}/exports/${encodeURIComponent(transfer.id)}/download`, { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) throw new Error('The archive download could not finish. Prepare a new export and try again.')
    const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'stall.rer'; document.body.appendChild(anchor); anchor.click(); anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function restore() {
    if (!archive || !confirmed) return
    const created = await request<{ id: string }>(`${base}/imports`, { manifest: archive.manifest, confirmed: true })
    setTransfer(await request<Transfer>(`${base}/imports/${encodeURIComponent(created.id)}`))
    for (const part of archive.parts) setTransfer(await request<Transfer>(`${base}/imports/${encodeURIComponent(created.id)}/parts/${part.index}`, part, 'PUT'))
    const result = await request<Transfer>(`${base}/imports/${encodeURIComponent(created.id)}/finalize`, archive.closing)
    setTransfer(result); setArchive(null); setConfirmed(false); setNotice('Archive restored. Review provider connections before taking orders.'); await reload()
  }
  return <Section id="portability" title="Your installation, your data"><p>Download a private archive through Base’s portability service. It contains business records and customer information; keep it secure. Restore is supported into an empty destination. Provider secrets must be configured separately.</p>{error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}<div className="st-actions"><button disabled={busy} onClick={() => void act(exportData)}>Prepare export download</button>{transfer?.phase === 'building' && <button disabled={busy} onClick={() => void act(async () => setTransfer(await request<Transfer>(`${base}/exports/${encodeURIComponent(transfer.id)}/advance`, {})))}>Continue preparing export</button>}{transfer?.phase === 'complete' && transfer.kind === 'export' && <button disabled={busy} onClick={() => void act(download)}>Download archive</button>}</div>
    {transfer && <p role="status">Transfer {transfer.id}: {transfer.phase} · {transfer.completed} / {transfer.total ?? '…'}</p>}
    <details><summary>Restore an archive into this empty installation</summary><div className="st-stack"><p>Restore recreates the exported installation’s data. This installation must contain no product or order data. The destination keeps its own owner and authentication records. Restore is rejected if the destination is not empty.</p><label>Choose archive<input type="file" accept=".rer,.ndjson,application/x-ndjson" disabled={busy} onChange={event => { const file = event.target.files?.[0]; setArchive(null); setConfirmed(false); if (file) void act(async () => { const lines = (await file.text()).split('\n').filter(line => line.trim()).map(line => JSON.parse(line)); const manifest = lines[0], closing = lines.at(-1); if (manifest?.kind !== 'manifest' || manifest?.format !== 'runeditrun-portability' || closing?.kind !== 'closing' || lines.slice(1, -1).some(part => part.kind !== 'part')) throw new Error('Choose a complete Base portability archive.'); setArchive({ manifest, parts: lines.slice(1, -1), closing }); setTransfer(null) }) }} /></label>{archive && <><JsonDetail label="Review archive manifest" value={archive.manifest} /><p>{archive.parts.length} archive parts will be uploaded and verified by Base.</p><label className="st-checkbox"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />I have reviewed this archive and confirm restoring it into this empty installation.</label><button disabled={busy || !confirmed} onClick={() => void act(restore)}>{busy ? 'Restoring…' : 'Restore reviewed archive'}</button></>}</div></details>
  </Section>
}
