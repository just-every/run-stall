import { useState } from 'react'
import { request, errorMessage, money } from './api'
import type { PersonalizationField } from './shop'

export type Answers = Record<string, { value: string; label?: string }>
const mimes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf' }
export const fileMime = (field: PersonalizationField) => (field.fileTypes ?? []).map(type => mimes[type]).join(',')

function FileField({ field, sku, answer, set, disabled }: { field: PersonalizationField; sku: string; answer?: { value: string; label?: string }; set: (value: { value: string; label?: string } | null) => void; disabled: boolean }) {
  const [problem, setProblem] = useState(''), [sending, setSending] = useState(false)
  async function choose(file: File | undefined) {
    setProblem('')
    if (!file) return set(null)
    const allowed = (field.fileTypes ?? []).map(type => mimes[type])
    if (!allowed.includes(file.type)) { set(null); return setProblem(`Choose a ${(field.fileTypes ?? []).join(', ')} file.`) }
    if (file.size > (field.maxBytes ?? 0)) { set(null); return setProblem(`That file is over the ${Math.floor((field.maxBytes ?? 0) / 1000)} KB limit.`) }
    setSending(true)
    try {
      const response = await fetch(`/api/stall/personalization/upload?sku=${encodeURIComponent(sku)}&field=${encodeURIComponent(field.key)}&name=${encodeURIComponent(file.name)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type }, body: file })
      const data = await response.json().catch(() => null) as { fileId?: string; name?: string; error?: { message?: string } } | null
      if (!response.ok) throw new Error(data?.error?.message ?? 'The file could not be uploaded.')
      set({ value: data!.fileId!, label: data!.name })
    } catch (failure) { set(null); setProblem(errorMessage(failure)) } finally { setSending(false) }
  }
  return <><input id={`pz-${field.key}`} type="file" accept={fileMime(field)} disabled={disabled || sending} onChange={event => void choose(event.target.files?.[0])} aria-describedby={`pz-${field.key}-help`} />
    <small id={`pz-${field.key}-help`}>{answer?.label ? `Attached: ${answer.label}` : `${(field.fileTypes ?? []).join(', ')} up to ${Math.floor((field.maxBytes ?? 0) / 1000)} KB.`}{sending && ' Uploading…'}</small>{problem && <small role="alert" className="st-field-error">{problem}</small>}</>
}
export function Personalization({ fields, sku, answers, setAnswers, disabled }: { fields: PersonalizationField[]; sku: string; answers: Answers; setAnswers: (next: Answers) => void; disabled: boolean }) {
  const put = (key: string, value: { value: string; label?: string } | null) => { const { [key]: _old, ...rest } = answers; setAnswers(value && value.value ? { ...rest, [key]: value } : rest) }
  return <fieldset className="st-personalize st-stack"><legend>Personalize it</legend>{fields.map(field => <div className="st-field" key={field.key}>
    <label htmlFor={`pz-${field.key}`}>{field.label}{field.required ? ' (required)' : ''}{field.addOnCents ? ` · +${money(field.addOnCents)}` : ''}</label>
    {field.type === 'text' && <><input id={`pz-${field.key}`} type="text" maxLength={field.maxLength! + 40} value={answers[field.key]?.value ?? ''} disabled={disabled} aria-invalid={[...(answers[field.key]?.value ?? '')].length > field.maxLength!} onChange={event => put(field.key, { value: event.target.value })} aria-describedby={`pz-${field.key}-help`} />
      <small id={`pz-${field.key}-help`} className={[...(answers[field.key]?.value ?? '')].length > field.maxLength! ? 'st-field-error' : undefined}>{[...(answers[field.key]?.value ?? '')].length}/{field.maxLength} characters{[...(answers[field.key]?.value ?? '')].length > field.maxLength! ? ' — too long' : ''}</small></>}
    {field.type === 'choice' && <select id={`pz-${field.key}`} value={answers[field.key]?.value ?? ''} disabled={disabled} onChange={event => put(field.key, { value: event.target.value })}><option value="">None</option>{field.choices!.map(choice => <option key={choice}>{choice}</option>)}</select>}
    {field.type === 'file' && <FileField field={field} sku={sku} answer={answers[field.key]} set={value => put(field.key, value)} disabled={disabled} />}
  </div>)}</fieldset>
}
