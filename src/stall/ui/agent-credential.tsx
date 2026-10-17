import { useRef, useState } from 'react'
import { request, errorMessage } from './api'
import { When } from './presentation'
import { Notice, Section } from './primitives'
export function AgentCredential() {
  const [credential, setCredential] = useState<{ token: string; expiresAt: number | string } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const lock = useRef(false)
  async function act(revoke: boolean) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice(''); setCredential(null)
    try { if (revoke) { await request('/api/stall/agent-token/revoke', {}); setNotice('Agent credentials revoked.') } else setCredential(await request('/api/stall/agent-token', {})) }
    catch (error) { setError(errorMessage(error)) } finally { lock.current = false; setBusy(false) }
  }
  return <Section title="Agent access"><p>Give an agent a private credential to read shop state and prepare product, shipping and refund drafts. Publishing, shipping and refunds require a signed-in person’s explicit approval. Agents cannot approve, restore, export or erase data.</p>{error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}<div className="st-actions"><button disabled={busy} onClick={() => void act(false)}>Create agent credential</button><button className="st-secondary" disabled={busy} onClick={() => void act(true)}>Revoke agent credentials</button></div>{credential && <div className="st-review st-stack"><Notice>Copy this credential now. It is displayed once and cleared when you leave this page.</Notice><label>Private agent credential<input readOnly type="password" autoComplete="off" value={credential.token} onFocus={event => event.currentTarget.select()} /></label><p>Expires: <When at={credential.expiresAt} /></p><div className="st-actions"><button className="st-secondary" onClick={() => void navigator.clipboard.writeText(credential.token).then(() => setNotice('Credential copied. Keep it private.')).catch(() => setError('Select and copy the credential field; clipboard is unavailable.'))}>Copy credential</button><button className="st-secondary" onClick={() => setCredential(null)}>Hide credential</button></div></div>}</Section>
}
