import { useState } from 'react'
import type { CustomField, ProductDetails } from '../product-details'
import { money } from './api'

type FieldInput = { key: string; label: string; type: CustomField['type']; value: string }
const optionalNumber = (value: string) => value === '' ? undefined : Number(value)
export function useProductDetails(initial?: ProductDetails) {
  const [values, setValues] = useState(() => ({
    cost: initial?.costCents === undefined ? '' : (initial.costCents / 100).toFixed(2),
    weight: String(initial?.weightGrams ?? ''), length: String(initial?.dimensionsMm?.length ?? ''),
    width: String(initial?.dimensionsMm?.width ?? ''), height: String(initial?.dimensionsMm?.height ?? ''),
    taxCategory: initial?.taxCategory ?? '', hsCode: initial?.hsCode ?? '', countryOfOrigin: initial?.countryOfOrigin ?? '',
  }))
  const [fields, setFields] = useState<FieldInput[]>(() => initial?.customFields?.map(field => ({ ...field, value: String(field.value) })) ?? [])
  function read(): ProductDetails {
    const details: ProductDetails = {}
    if (values.cost !== '') {
      if (!/^\d+(\.\d{1,2})?$/.test(values.cost)) throw new Error('Enter a nonnegative cost with at most two decimal places.')
      details.costCents = Math.round(Number(values.cost) * 100)
      if (!Number.isSafeInteger(details.costCents)) throw new Error('Cost must fit safely in whole cents.')
    }
    if (values.weight !== '') details.weightGrams = optionalNumber(values.weight)
    const dimensions = [values.length, values.width, values.height]
    if (dimensions.some(Boolean)) {
      if (!dimensions.every(value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0)) throw new Error('Enter all three dimensions as positive whole millimeters, or leave all three blank.')
      details.dimensionsMm = { length: Number(values.length), width: Number(values.width), height: Number(values.height) }
    }
    if (values.taxCategory.trim()) details.taxCategory = values.taxCategory.trim()
    if (values.hsCode.trim()) details.hsCode = values.hsCode.trim()
    if (values.countryOfOrigin.trim()) details.countryOfOrigin = values.countryOfOrigin.trim().toUpperCase()
    if (fields.length) details.customFields = fields.map(field => {
      const base = { key: field.key, label: field.label }
      if (field.type === 'boolean') return { ...base, type: 'boolean', value: field.value === 'true' }
      if (field.type === 'number') {
        if (!field.value.trim() || !Number.isFinite(Number(field.value))) throw new Error('Every number field needs a finite number.')
        return { ...base, type: 'number', value: Number(field.value) }
      }
      return { ...base, type: 'text', value: field.value }
    })
    if (new Set(fields.map(field => field.key)).size !== fields.length) throw new Error('Custom field keys must be unique.')
    return details
  }
  return { values, setValues, fields, setFields, read }
}

type Inputs = ReturnType<typeof useProductDetails>
export function ProductDetailsEditor({ input, busy }: { input: Inputs; busy: boolean }) {
  const { values, setValues, fields, setFields } = input
  function change(name: keyof typeof values, value: string) { setValues(current => ({ ...current, [name]: value })) }
  function fieldChange(index: number, patch: Partial<FieldInput>) { setFields(current => current.map((field, at) => at === index ? { ...field, ...patch } : field)) }
  return <details onInvalidCapture={event => { event.currentTarget.open = true }}><summary>Optional product details</summary><fieldset disabled={busy} className="st-stack">
    <legend>Cost, shipping and custom fields</legend>
    <p className="st-small">Leave optional values blank when unknown. Dimensions need all three measurements. Custom fields appear in the shop after approval.</p>
    <div className="st-editor-grid">
      <label>Cost price · USD<input inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" value={values.cost} placeholder="Not set" onChange={event => change('cost', event.target.value)} /></label>
      <label>Weight · g<input type="number" min="1" step="1" value={values.weight} placeholder="Not set" onChange={event => change('weight', event.target.value)} /></label>
      {(['length', 'width', 'height'] as const).map(name => <label key={name}>{name[0].toUpperCase() + name.slice(1)} · mm<input type="number" min="1" step="1" value={values[name]} placeholder="Not set" onChange={event => change(name, event.target.value)} /></label>)}
    </div>
    <label>Tax category<input maxLength={100} value={values.taxCategory} placeholder="Not set" onChange={event => change('taxCategory', event.target.value)} /></label>
    <label>HS code<input inputMode="numeric" pattern="([0-9]{6}|[0-9]{8}|[0-9]{10})" value={values.hsCode} placeholder="6, 8 or 10 digits" onChange={event => change('hsCode', event.target.value)} /></label>
    <label>Country of origin<input maxLength={2} pattern="[A-Za-z]{2}" value={values.countryOfOrigin} placeholder="Two-letter code" onChange={event => change('countryOfOrigin', event.target.value.toUpperCase())} /></label>
    <p className="st-small">HS code and origin are checked for format only.</p>
    {fields.map((field, index) => <fieldset className="st-stack" key={index}><legend>Custom field {index + 1}</legend>
      <label>Field key {index + 1}<input aria-label={`Field key ${index + 1}`} required pattern="[a-z][a-z0-9_]{0,39}" maxLength={40} value={field.key} onChange={event => fieldChange(index, { key: event.target.value })} /><small>Start with a lowercase letter; use lowercase letters, numbers and underscores.</small></label>
      <label>Field label {index + 1}<input required maxLength={80} value={field.label} onChange={event => fieldChange(index, { label: event.target.value })} /></label>
      <label>Field type {index + 1}<select value={field.type} onChange={event => { const type = event.target.value as CustomField['type']; fieldChange(index, { type, value: type === 'boolean' ? 'false' : '' }) }}><option value="text">Text</option><option value="number">Number</option><option value="boolean">Yes / no</option></select></label>
      <label>Field value {index + 1}{field.type === 'boolean' ? <select value={field.value} onChange={event => fieldChange(index, { value: event.target.value })}><option value="true">Yes</option><option value="false">No</option></select> : field.type === 'number' ? <input required type="number" step="any" value={field.value} onChange={event => fieldChange(index, { value: event.target.value })} /> : <textarea maxLength={4000} rows={3} value={field.value} onChange={event => fieldChange(index, { value: event.target.value })} />}</label>
      <button type="button" className="st-secondary" onClick={() => setFields(current => current.filter((_, at) => at !== index))}>Remove custom field {index + 1}</button>
    </fieldset>)}
    <button type="button" className="st-secondary" disabled={fields.length >= 20} onClick={() => setFields(current => [...current, { key: '', label: '', type: 'text', value: '' }])}>Add custom field</button>
  </fieldset></details>
}

export function CustomFields({ fields }: { fields?: CustomField[] }) {
  if (!fields?.length) return null
  return <dl>{fields.map(field => <div key={field.key}><dt>{field.label}</dt><dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{field.type === 'boolean' ? field.value ? 'Yes' : 'No' : String(field.value)}</dd></div>)}</dl>
}
export function ProductDetailsView({ details }: { details?: ProductDetails }) {
  return <div className="st-stack">
    <dl>
      <div><dt>Cost price · USD</dt><dd>{details?.costCents === undefined ? 'Not set' : money(details.costCents)}</dd></div>
      <div><dt>Weight · g</dt><dd>{details?.weightGrams ?? 'Not set'}</dd></div>
      <div><dt>Dimensions · mm (length × width × height)</dt><dd>{details?.dimensionsMm ? `${details.dimensionsMm.length} × ${details.dimensionsMm.width} × ${details.dimensionsMm.height}` : 'Not set'}</dd></div>
      <div><dt>Tax category</dt><dd>{details?.taxCategory || 'Not set'}</dd></div>
      <div><dt>HS code</dt><dd>{details?.hsCode || 'Not set'}</dd></div>
      <div><dt>Country of origin</dt><dd>{details?.countryOfOrigin || 'Not set'}</dd></div>
    </dl>
    {details?.customFields?.length ? <CustomFields fields={details.customFields} /> : <p className="st-small">No custom fields.</p>}
  </div>
}
