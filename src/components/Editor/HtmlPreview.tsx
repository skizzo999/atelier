import { useEffect, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { openWithSystem } from '../../lib/imageActions'

// Anteprima dei file web: il file VERO dentro un iframe, servito dal
// protocollo asset di Tauri — così fogli di stile, script e immagini con
// percorso relativo si risolvono da soli, come in un browser.
// L'iframe è in sandbox SENZA allow-same-origin: gli script della pagina
// girano, ma in un'origine isolata che non può toccare Atelier.
// Se il caricamento non riesce lo diciamo, invece di lasciare un riquadro
// bianco muto: c'è sempre la via d'uscita "Apri nel browser".

export function HtmlPreview({ filePath, rev }: { filePath: string; rev: number }) {
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    setLoaded(false)
    setSlow(false)
    setError(null)
    try {
      setUrl(convertFileSrc(filePath))
    } catch (e) {
      setError(String(e))
    }
    const t = setTimeout(() => setSlow(true), 2500)
    return () => clearTimeout(t)
  }, [filePath, rev])

  const name = filePath.split('\\').pop() ?? filePath

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 text-[11px] text-zinc-500 shrink-0">
        <span className="truncate" title={url}>
          Anteprima di {name}
        </span>
        <div className="flex-1" />
        <button className="tbtn" onClick={() => frameRef.current?.contentWindow?.location.reload()} title="Ricarica l'anteprima">
          Ricarica
        </button>
        <button className="tbtn" onClick={() => void openWithSystem(filePath).catch((e) => setError(String(e)))}>
          Apri nel browser
        </button>
      </div>

      <div className="flex-1 relative min-h-0">
        {url && (
          <iframe
            key={rev}
            ref={frameRef}
            title="Anteprima"
            src={url}
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            onLoad={() => setLoaded(true)}
            className="absolute inset-0 w-full h-full bg-white border-0"
          />
        )}
        {(error || (!loaded && slow)) && (
          <div className="absolute inset-0 grid place-items-center bg-zinc-900/95 p-6 text-center">
            <div className="max-w-md flex flex-col items-center gap-3">
              <p className="text-sm text-zinc-300">Non riesco a mostrare l'anteprima di questo file.</p>
              <p className="text-xs text-zinc-500 break-all">{error ?? url}</p>
              <p className="text-xs text-zinc-500">
                Puoi comunque aprirlo nel browser di sistema: la pagina è sul disco e funziona normalmente.
              </p>
              <button className="btn-accent rounded-md h-7 px-3 text-xs font-medium" onClick={() => void openWithSystem(filePath)}>
                Apri nel browser
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
