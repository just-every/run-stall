import { useEffect, useRef, type ReactNode } from 'react'

export function Dialog({ title, children, onClose, busy }: { title: string; children: ReactNode; onClose: () => void; busy: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = dialog.current
    element?.showModal()
    return () => { element?.close(); if (opener?.isConnected) opener.focus() }
  }, [])
  return <dialog ref={dialog} className="st-dialog st-stack" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <h2>{title}</h2>{children}
  </dialog>
}
