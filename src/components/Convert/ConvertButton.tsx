import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { optionsFor } from '../../lib/convert'

// Tasto unico "⇄ Converti": mostra SOLO le conversioni possibili per il file
// aperto (deciso da lib/convert.optionsFor); se non ce ne sono, non appare.
// Il file convertito viene creato accanto all'originale e aperto subito.
export function ConvertButton({ filePath, className }: { filePath: string; className: string }) {
  const setSelectedFile = useAppStore((s) => s.setSelectedFile)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const options = optionsFor(filePath)
  if (options.length === 0) return null

  async function run(opt: (typeof options)[number]) {
    setOpen(false)
    setBusy(true)
    setError(false)
    try {
      const dest = await opt.run(filePath)
      setSelectedFile(dest) // apre il file convertito
    } catch (e) {
      console.error('Conversione fallita:', e)
      setError(true)
      setTimeout(() => setError(false), 2500)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={className}
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        title="Converti in un altro formato (crea un nuovo file accanto all'originale)"
      >
        {busy ? 'Converto…' : error ? 'Errore ✕' : '⇄ Converti'}
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-60 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl py-1">
          <p className="px-3 py-1 text-[11px] text-zinc-500 uppercase tracking-wider">Converti in</p>
          {options.map((o) => (
            <button
              key={o.id}
              className="w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
              onClick={() => run(o)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
