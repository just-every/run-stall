import { useEffect, useRef, type ReactNode } from 'react'

export function Dialog({ title, children, onClose, busy }: { title: string; children: ReactNode; onClose: () => void; busy: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current, opener = document.activeElement
    element?.showModal()
    return () => { element?.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus() }
  }, [])
  return <dialog ref={dialog} className="st-dialog st-stack" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')].filter(element => !element.matches(':disabled, [tabindex="-1"]') && element.getClientRects().length)
    const first = controls[0], last = controls.at(-1)
    if (first && last && (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      event.preventDefault(); (event.shiftKey ? last : first).focus()
    }
  }}>
    <h2>{title}</h2>{children}
  </dialog>
}
