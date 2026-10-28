import { useEffect, useRef, type ReactNode } from 'react'

export function Dialog({ title, children, onClose, busy }: { title: string; children: ReactNode; onClose: () => void; busy: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { element?.close(); if (opener.current?.isConnected) opener.current.focus() }
  }, [])
  return <dialog ref={dialog} className="st-dialog st-stack" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <h2>{title}</h2>{children}
  </dialog>
}
