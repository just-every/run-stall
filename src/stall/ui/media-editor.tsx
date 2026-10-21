import { useState } from 'react'
import type { Media } from '../listing'
import { errorMessage } from './api'

const types = 'image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm'
/** Staff uploads each file once; the product keeps its order and alt text for review. */
export function MediaEditor({ media, setMedia, busy }: { media: Media[]; setMedia: (next: Media[]) => void; busy: boolean }) {
  const [problem, setProblem] = useState(''), [sending, setSending] = useState(false)
  async function upload(file: File | undefined) {
    if (!file) return
    setProblem(''); setSending(true)
    try {
      const response = await fetch('/api/stall/media', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type }, body: file })
      const data = await response.json().catch(() => null) as { id?: string; kind?: 'image' | 'video'; error?: { message?: string } } | null
      if (!response.ok || !data?.id) throw new Error(data?.error?.message ?? 'The file could not be uploaded.')
      setMedia([...media, { id: data.id, kind: data.kind!, alt: '' }])
    } catch (failure) { setProblem(errorMessage(failure)) } finally { setSending(false) }
  }
  const move = (index: number, by: number) => { const next = [...media]; const [item] = next.splice(index, 1); next.splice(index + by, 0, item); setMedia(next) }
  return <fieldset className="st-stack" disabled={busy}><legend>Images and videos</legend>
    <p className="st-small">PNG, JPEG, GIF or WebP images and MP4 or WebM videos up to 700 KB each. Alt text describes the file for people who cannot see it. The first image leads the gallery.</p>
    {media.map((item, index) => <div className="st-media-row" key={item.id}>
      {item.kind === 'image' ? <img src={`/api/stall/media/${item.id}`} alt="" width="64" height="64" /> : <span className="st-media-video" aria-hidden="true">▶</span>}
      <label>Alt text for {item.kind} {index + 1}<input required maxLength={300} value={item.alt} onChange={event => setMedia(media.map((entry, at) => at === index ? { ...entry, alt: event.target.value } : entry))} /></label>
      <div className="st-actions"><button type="button" className="st-secondary" disabled={index === 0} onClick={() => move(index, -1)}>Move {item.kind} {index + 1} earlier</button><button type="button" className="st-secondary" disabled={index === media.length - 1} onClick={() => move(index, 1)}>Move {item.kind} {index + 1} later</button><button type="button" className="st-secondary" onClick={() => setMedia(media.filter((_, at) => at !== index))}>Remove {item.kind} {index + 1}</button></div>
    </div>)}
    <label>Add an image or video<input type="file" accept={types} disabled={sending || media.length >= 20} onChange={event => { void upload(event.target.files?.[0]); event.target.value = '' }} /></label>
    {sending && <p role="status">Uploading…</p>}{problem && <p role="alert" className="st-field-error">{problem}</p>}
  </fieldset>
}
