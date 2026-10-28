import { useEffect, useRef, type ReactNode } from 'react'

export function Dialog({ title, children, onClose, busy }: { title: string; children: ReactNode; onClose: () => void; busy: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { element?.close(); if (opener.current?.isConnected) opener.current.focus() }
  }, [])
  return <dialog ref={dialog} className="st-dialog st-stack" aria-label={title} tabIndex={-1} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const element = event.currentTarget
    const controls = [...element.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]')].filter(control => control.tabIndex >= 0 && control.getClientRects().length)
    const first = controls[0], last = controls.at(-1)
    if (!first) { event.preventDefault(); element.focus() }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <h2>{title}</h2>{children}
  </dialog>
}
