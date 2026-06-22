import { useEffect, useRef, useState } from 'react'
import { readFile } from '@tauri-apps/plugin-fs'
import { writeFileBinaryAtomic } from '../../lib/fileOps'
import { useAppStore } from '../../store/appStore'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
}

// Formati raster ri-encodabili da canvas (toBlob): supportano l'editing.
const EDITABLE = new Set(['png', 'jpg', 'jpeg', 'webp'])

function extOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? ''
}

export function ImageViewer({ filePath }: { filePath: string }) {
  return EDITABLE.has(extOf(filePath)) ? (
    <EditableImage filePath={filePath} />
  ) : (
    <ViewOnlyImage filePath={filePath} />
  )
}

// --- Trasformazioni su canvas (ognuna ritorna un nuovo canvas) ---

function rotate90(src: HTMLCanvasElement, dir: 1 | -1): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.height
  c.height = src.width
  const ctx = c.getContext('2d')!
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((dir * Math.PI) / 2)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return c
}

function flip(src: HTMLCanvasElement, axis: 'h' | 'v'): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d')!
  ctx.translate(axis === 'h' ? c.width : 0, axis === 'v' ? c.height : 0)
  ctx.scale(axis === 'h' ? -1 : 1, axis === 'v' ? -1 : 1)
  ctx.drawImage(src, 0, 0)
  return c
}

function resizeCanvas(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  return c
}

const toolBtn =
  'px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-300 disabled:opacity-40'

function EditableImage({ filePath }: { filePath: string }) {
  const ext = extOf(filePath)
  const setImageBuffer = useAppStore((s) => s.setImageBuffer)
  const clearImageBuffer = useAppStore((s) => s.clearImageBuffer)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(true)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [resizeOpen, setResizeOpen] = useState(false)

  // Carica dal buffer (modifiche non salvate) se presente, altrimenti dal disco.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setZoom(1)
    setFit(true)
    const buffered = useAppStore.getState().imageBuffers[filePath]
    ;(async () => {
      let blob: Blob
      if (buffered) {
        blob = buffered
      } else {
        const bytes = await readFile(filePath)
        blob = new Blob([bytes], { type: MIME[ext] ?? 'image/png' })
      }
      const bmp = await createImageBitmap(blob)
      if (cancelled) {
        bmp.close()
        return
      }
      const cv = canvasRef.current
      if (cv) {
        cv.width = bmp.width
        cv.height = bmp.height
        cv.getContext('2d')!.drawImage(bmp, 0, 0)
        setDims({ w: bmp.width, h: bmp.height })
      }
      bmp.close()
      setDirty(!!buffered)
      setLoading(false)
    })().catch((err) => {
      console.error('Errore lettura immagine:', err)
      if (!cancelled) {
        setError(true)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [filePath, ext, reloadNonce])

  function applyTransform(produce: (src: HTMLCanvasElement) => HTMLCanvasElement) {
    const cv = canvasRef.current
    if (!cv) return
    const result = produce(cv)
    cv.width = result.width
    cv.height = result.height
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, cv.width, cv.height)
    ctx.drawImage(result, 0, 0)
    setDims({ w: cv.width, h: cv.height })
    setDirty(true)
    // Aggiorna il buffer (PNG lossless) così le modifiche sopravvivono al cambio file.
    cv.toBlob((b) => {
      if (b) setImageBuffer(filePath, b)
    }, 'image/png')
  }

  function handleSave() {
    const cv = canvasRef.current
    if (!cv || saving) return
    setSaving(true)
    cv.toBlob(
      async (blob) => {
        try {
          if (!blob) throw new Error('Encoding fallito')
          const buf = new Uint8Array(await blob.arrayBuffer())
          await writeFileBinaryAtomic(filePath, buf)
          clearImageBuffer(filePath)
          setDirty(false)
        } catch (err) {
          console.error('Errore salvataggio immagine:', err)
        } finally {
          setSaving(false)
        }
      },
      MIME[ext] ?? 'image/png',
      0.92,
    )
  }

  // Ctrl/Cmd+S salva l'immagine.
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const fileName = filePath.split('\\').pop()

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-400 truncate flex items-center gap-2">
          {dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
          {fileName}
          <span className="text-xs text-zinc-600">
            {dims.w}×{dims.h}
          </span>
        </span>
      </div>

      <div className="px-4 py-1.5 border-b border-zinc-800 flex items-center gap-1 text-xs flex-wrap">
        <button className={toolBtn} title="Ruota a sinistra" onClick={() => applyTransform((c) => rotate90(c, -1))}>
          ⟲
        </button>
        <button className={toolBtn} title="Ruota a destra" onClick={() => applyTransform((c) => rotate90(c, 1))}>
          ⟳
        </button>
        <button className={toolBtn} title="Capovolgi orizzontale" onClick={() => applyTransform((c) => flip(c, 'h'))}>
          ⇋
        </button>
        <button className={toolBtn} title="Capovolgi verticale" onClick={() => applyTransform((c) => flip(c, 'v'))}>
          ⇅
        </button>
        <button className={toolBtn} onClick={() => setResizeOpen(true)}>
          Ridimensiona
        </button>

        <div className="flex-1" />

        <button className={toolBtn} title="Riduci" onClick={() => { setFit(false); setZoom((z) => Math.max(0.1, +(z - 0.25).toFixed(2))) }}>
          −
        </button>
        <span className="w-12 text-center text-zinc-500">{fit ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
        <button className={toolBtn} title="Ingrandisci" onClick={() => { setFit(false); setZoom((z) => Math.min(8, +(z + 0.25).toFixed(2))) }}>
          +
        </button>
        <button className={toolBtn} onClick={() => setFit(true)}>
          Adatta
        </button>

        <div className="w-px h-5 bg-zinc-700 mx-1" />

        <button
          className={toolBtn}
          disabled={!dirty || saving}
          onClick={() => {
            clearImageBuffer(filePath)
            setReloadNonce((n) => n + 1)
          }}
        >
          Annulla
        </button>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-3 py-1 bg-zinc-100 text-zinc-900 rounded font-medium hover:bg-white disabled:opacity-40"
        >
          {saving ? 'Salvataggio…' : 'Salva'}
        </button>
      </div>

      <div className="flex-1 overflow-auto flex items-center justify-center bg-zinc-950 p-4 relative">
        {error && <span className="text-zinc-500 text-sm">Impossibile caricare l'immagine.</span>}
        {loading && !error && (
          <span className="absolute text-zinc-500 text-sm">Caricamento…</span>
        )}
        <canvas
          ref={canvasRef}
          className={fit ? 'max-w-full max-h-full object-contain' : ''}
          style={fit ? undefined : { width: `${zoom * 100}%` }}
        />
      </div>

      {resizeOpen && (
        <ResizeModal
          width={dims.w}
          height={dims.h}
          onCancel={() => setResizeOpen(false)}
          onApply={(w, h) => {
            applyTransform((c) => resizeCanvas(c, w, h))
            setResizeOpen(false)
          }}
        />
      )}
    </div>
  )
}

function ResizeModal({
  width,
  height,
  onApply,
  onCancel,
}: {
  width: number
  height: number
  onApply: (w: number, h: number) => void
  onCancel: () => void
}) {
  const ratio = width / height || 1
  const [w, setW] = useState(width)
  const [h, setH] = useState(height)
  const [lock, setLock] = useState(true)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="w-72 bg-zinc-900 border border-zinc-700 rounded-lg p-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-zinc-200">Ridimensiona</h3>
        <label className="text-xs text-zinc-400 flex items-center justify-between gap-2">
          Larghezza
          <input
            type="number"
            value={w}
            min={1}
            onChange={(e) => {
              const nv = Math.max(1, Math.round(+e.target.value))
              setW(nv)
              if (lock) setH(Math.max(1, Math.round(nv / ratio)))
            }}
            className="w-28 px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-zinc-500"
          />
        </label>
        <label className="text-xs text-zinc-400 flex items-center justify-between gap-2">
          Altezza
          <input
            type="number"
            value={h}
            min={1}
            onChange={(e) => {
              const nv = Math.max(1, Math.round(+e.target.value))
              setH(nv)
              if (lock) setW(Math.max(1, Math.round(nv * ratio)))
            }}
            className="w-28 px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-zinc-500"
          />
        </label>
        <label className="text-xs text-zinc-400 flex items-center gap-2">
          <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
          Mantieni proporzioni
        </label>
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 rounded">
            Annulla
          </button>
          <button
            onClick={() => onApply(w, h)}
            className="px-3 py-1.5 text-xs bg-zinc-100 text-zinc-900 rounded font-medium hover:bg-white"
          >
            Applica
          </button>
        </div>
      </div>
    </div>
  )
}

function ViewOnlyImage({ filePath }: { filePath: string }) {
  const ext = extOf(filePath)
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState(true)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setError(false)
    setUrl(null)
    setZoom(1)
    setFit(true)
    readFile(filePath)
      .then((bytes) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: MIME[ext] ?? 'application/octet-stream' }))
        setUrl(objectUrl)
      })
      .catch((err) => {
        console.error('Errore lettura immagine:', err)
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [filePath, ext])

  const fileName = filePath.split('\\').pop()

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-400 truncate">{fileName}</span>
        <div className="flex items-center gap-1 text-xs text-zinc-300">
          <button className={toolBtn} onClick={() => { setFit(false); setZoom((z) => Math.max(0.1, +(z - 0.25).toFixed(2))) }}>
            −
          </button>
          <span className="w-12 text-center text-zinc-500">{fit ? 'Fit' : `${Math.round(zoom * 100)}%`}</span>
          <button className={toolBtn} onClick={() => { setFit(false); setZoom((z) => Math.min(8, +(z + 0.25).toFixed(2))) }}>
            +
          </button>
          <button className={toolBtn} onClick={() => setFit(true)}>
            Adatta
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto flex items-center justify-center bg-zinc-950 p-4">
        {error ? (
          <span className="text-zinc-500 text-sm">Impossibile caricare l'immagine.</span>
        ) : url ? (
          <img
            src={url}
            alt={fileName}
            className={fit ? 'max-w-full max-h-full object-contain' : ''}
            style={fit ? undefined : { width: `${zoom * 100}%` }}
          />
        ) : (
          <span className="text-zinc-500 text-sm">Caricamento…</span>
        )}
      </div>
    </div>
  )
}
