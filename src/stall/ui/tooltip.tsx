import { cloneElement, useEffect, useId, useRef, useState, type ReactElement } from 'react'

export function Tooltip({ label, children }: { label: string; children: ReactElement<{ 'aria-describedby'?: string }> }) {
  const id = useId(), [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), focused = useRef(false), hovered = useRef(false)
  const clear = () => { clearTimeout(timer.current); timer.current = undefined }
  useEffect(() => clear, [])
  return <span className="st-tooltip"
    onPointerEnter={() => { hovered.current = true; clear(); if (!focused.current) timer.current = setTimeout(() => setOpen(true), 300) }}
    onPointerLeave={() => { hovered.current = false; clear(); if (!focused.current) setOpen(false) }}
    onFocusCapture={() => { focused.current = true; clear(); setOpen(true) }}
    onBlurCapture={() => { focused.current = false; if (!hovered.current) setOpen(false) }}
    onKeyDown={event => { if (event.key === 'Escape') { clear(); setOpen(false) } }}>
    {cloneElement(children, { 'aria-describedby': id })}<span id={id} role="tooltip" hidden={!open}>{label}</span>
  </span>
}
