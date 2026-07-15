import { useEffect, useRef } from 'react'

// Conferma in-app in stile Atelier (niente confirm() nativo di sistema:
// all'utente non piaceva). Backdrop sfocato, pannello caldo, titolo serif.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Annulla',
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus() // default sicuro: Invio = Annulla
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="w-[26rem] max-w-[90vw] bg-zinc-800 border border-zinc-700 rounded-card shadow-2xl p-6"
      >
        <h2 className="font-display text-xl text-zinc-100 tracking-tight">{title}</h2>
        <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{message}</p>
        <div className="mt-6 flex gap-3 justify-end">
          <button
            ref={cancelRef}
            className="px-4 py-2 rounded-lg text-sm bg-zinc-900 border border-zinc-700 text-zinc-200 hover:bg-zinc-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/60"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/60 ${
              danger ? 'bg-red-700 hover:bg-red-600 text-red-50' : 'btn-accent'
            }`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
