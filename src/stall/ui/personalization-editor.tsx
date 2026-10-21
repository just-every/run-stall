import type { FileKind, PersonalizationField } from '../listing'

export type FieldRow = { key: string; label: string; type: 'text' | 'choice' | 'file'; required: boolean; addOn: string; maxLength: string; choices: string; fileTypes: FileKind[]; maxKb: string }
export const fieldRowOf = (field: PersonalizationField): FieldRow => ({ key: field.key, label: field.label, type: field.type, required: !!field.required, addOn: field.addOnCents ? (field.addOnCents / 100).toFixed(2) : '', maxLength: field.type === 'text' ? String(field.maxLength) : '20', choices: field.type === 'choice' ? field.choices.join(', ') : '', fileTypes: field.type === 'file' ? field.fileTypes : ['png'], maxKb: field.type === 'file' ? String(Math.floor(field.maxBytes / 1000)) : '500' })
export function readFields(rows: FieldRow[]): PersonalizationField[] {
  return rows.map(row => {
    if (row.addOn && !/^\d+(\.\d{1,2})?$/.test(row.addOn)) throw new Error(`${row.label || 'Personalization'} add-on price must be dollars and cents.`)
    const base = { key: row.key.trim(), label: row.label.trim(), ...(row.required ? { required: true as const } : {}), ...(row.addOn ? { addOnCents: Math.round(Number(row.addOn) * 100) } : {}) }
    if (row.type === 'text') return { ...base, type: 'text' as const, maxLength: Number(row.maxLength) }
    if (row.type === 'choice') return { ...base, type: 'choice' as const, choices: row.choices.split(',').map(choice => choice.trim()).filter(Boolean) }
    return { ...base, type: 'file' as const, fileTypes: row.fileTypes, maxBytes: Math.round(Number(row.maxKb) * 1000) }
  })
}
export function PersonalizationEditor({ rows, setRows, busy }: { rows: FieldRow[]; setRows: (next: FieldRow[]) => void; busy: boolean }) {
  const change = (index: number, patch: Partial<FieldRow>) => setRows(rows.map((row, at) => at === index ? { ...row, ...patch } : row))
  return <fieldset className="st-stack" disabled={busy}><legend>Personalization</legend>
    <p className="st-small">Ask the shopper for engraving text, a choice, or a file. Answers are checked before add to basket and carry to the order, packing slip and confirmation email.</p>
    {rows.map((row, index) => <fieldset className="st-stack" key={index}><legend>Personalization field {index + 1}</legend>
      <div className="st-editor-grid">
        <label>Field {index + 1} key<input required pattern="[a-z][a-z0-9_]{0,39}" maxLength={40} value={row.key} onChange={event => change(index, { key: event.target.value })} /></label>
        <label>Field {index + 1} label<input required maxLength={80} value={row.label} onChange={event => change(index, { label: event.target.value })} /></label>
        <label>Field {index + 1} type<select value={row.type} onChange={event => change(index, { type: event.target.value as FieldRow['type'] })}><option value="text">Text</option><option value="choice">Choice list</option><option value="file">File upload</option></select></label>
        <label>Field {index + 1} add-on price · USD<input inputMode="decimal" value={row.addOn} placeholder="0.00" onChange={event => change(index, { addOn: event.target.value })} /></label>
      </div>
      {row.type === 'text' && <label>Field {index + 1} character limit<input type="number" min="1" max="500" value={row.maxLength} onChange={event => change(index, { maxLength: event.target.value })} /></label>}
      {row.type === 'choice' && <label>Field {index + 1} choices (comma separated)<input value={row.choices} onChange={event => change(index, { choices: event.target.value })} /></label>}
      {row.type === 'file' && <><fieldset><legend>Field {index + 1} allowed file types</legend>{(['png', 'jpg', 'pdf'] as const).map(type => <label className="st-checkbox" key={type}><input type="checkbox" checked={row.fileTypes.includes(type)} onChange={event => change(index, { fileTypes: event.target.checked ? [...row.fileTypes, type] : row.fileTypes.filter(kind => kind !== type) })} />{type.toUpperCase()}</label>)}</fieldset>
        <label>Field {index + 1} size limit · KB (at most 700)<input type="number" min="1" max="700" value={row.maxKb} onChange={event => change(index, { maxKb: event.target.value })} /></label></>}
      <label className="st-checkbox"><input type="checkbox" checked={row.required} onChange={event => change(index, { required: event.target.checked })} />Field {index + 1} is required</label>
      <button type="button" className="st-secondary" onClick={() => setRows(rows.filter((_, at) => at !== index))}>Remove personalization field {index + 1}</button>
    </fieldset>)}
    <button type="button" className="st-secondary" disabled={rows.length >= 5} onClick={() => setRows([...rows, { key: '', label: '', type: 'text', required: false, addOn: '', maxLength: '20', choices: '', fileTypes: ['png'], maxKb: '500' }])}>Add a personalization field</button>
  </fieldset>
}
