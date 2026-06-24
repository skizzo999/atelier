import { useEffect, useRef, useState } from 'react'
import { readFile } from '@tauri-apps/plugin-fs'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
// Worker bundlato localmente (niente CDN: resta tutto offline).
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker

const btn =
  'px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-300 disabled:opacity-40'

// Viewer PDF (sola lettura): scroll continuo, pagine renderizzate quando entrano
// in vista, zoom −/+/Adatta larghezza.
export function PdfViewer({ filePath }: { filePath: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const baseWidthRef = useRef(0) // larghezza pagina 1 a scala 1 (per "Adatta")

  useEffect(() => {
    let cancelled = false
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null
    setLoading(true)
    setError(false)
    setDoc(null)
    setNumPages(0)
    ;(async () => {
      const bytes = await readFile(filePath)
      loadingTask = pdfjsLib.getDocument({ data: bytes })
      const pdf = await loadingTask.promise
      if (cancelled) return
      const page1 = await pdf.getPage(1)
      baseWidthRef.current = page1.getViewport({ scale: 1 }).width
      const cw = containerRef.current?.clientWidth ?? 800
      const fit = Math.min(2, Math.max(0.4, (cw - 48) / (baseWidthRef.current || 800)))
      setScale(+fit.toFixed(2))
      setDoc(pdf)
      setNumPages(pdf.numPages)
      setLoading(false)
    })().catch((e) => {
      console.error('Errore apertura PDF:', e)
      if (!cancelled) {
        setError(true)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
      loadingTask?.destroy()
    }
  }, [filePath])

  function fitWidth() {
    if (!baseWidthRef.current) return
    const cw = containerRef.current?.clientWidth ?? 800
    setScale(+Math.min(2, Math.max(0.4, (cw - 48) / baseWidthRef.current)).toFixed(2))
  }

  const fileName = filePath.split('\\').pop()

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-400 truncate flex items-center gap-2">
          {fileName}
          {numPages > 0 && <span className="text-xs text-zinc-600">{numPages} pagine</span>}
        </span>
        <div className="flex items-center gap-1 text-xs text-zinc-300">
          <button className={btn} title="Riduci" onClick={() => setScale((s) => +Math.max(0.4, s - 0.2).toFixed(2))}>
            −
          </button>
          <span className="w-10 text-center text-zinc-500">{Math.round(scale * 100)}%</span>
          <button className={btn} title="Ingrandisci" onClick={() => setScale((s) => +Math.min(4, s + 0.2).toFixed(2))}>
            +
          </button>
          <button className={btn} onClick={fitWidth}>
            Adatta
          </button>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto bg-zinc-950 flex flex-col items-center gap-4 p-6">
        {error && <span className="m-auto text-zinc-500 text-sm">Impossibile aprire il PDF.</span>}
        {loading && !error && <span className="m-auto text-zinc-500 text-sm">Caricamento…</span>}
        {doc &&
          Array.from({ length: numPages }, (_, i) => (
            <PdfPage key={i + 1} doc={doc} pageNumber={i + 1} scale={scale} />
          ))}
      </div>
    </div>
  )
}

function PdfPage({ doc, pageNumber, scale }: { doc: PDFDocumentProxy; pageNumber: number; scale: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [visible, setVisible] = useState(false)

  // Dimensioni della pagina alla scala corrente (per il segnaposto = scroll corretto).
  useEffect(() => {
    let cancelled = false
    doc.getPage(pageNumber).then((page) => {
      const vp = page.getViewport({ scale })
      if (!cancelled) setSize({ w: Math.floor(vp.width), h: Math.floor(vp.height) })
    })
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber, scale])

  // Renderizza solo quando la pagina è (quasi) in vista.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true)
      },
      { rootMargin: '400px 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let task: { promise: Promise<unknown>; cancel: () => void } | null = null
    doc.getPage(pageNumber).then((page) => {
      if (cancelled) return
      const vp = page.getViewport({ scale })
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = Math.floor(vp.width)
      canvas.height = Math.floor(vp.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      task = page.render({ canvasContext: ctx, viewport: vp, canvas })
      task.promise.catch(() => {}) // ignora le cancellazioni
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [visible, doc, pageNumber, scale])

  return (
    <div ref={wrapRef} style={{ width: size?.w, height: size?.h }} className="bg-white shadow-lg shrink-0">
      <canvas ref={canvasRef} className="block" />
    </div>
  )
}
