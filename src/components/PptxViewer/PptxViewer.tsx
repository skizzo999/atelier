import { useEffect, useRef, useState } from 'react'
import { readFile } from '@tauri-apps/plugin-fs'
import { revealInExplorer } from '../../lib/imageActions'
import { ConvertButton } from '../Convert/ConvertButton'
import { IMAGE_MIME } from '../../lib/mime'
import type { PptxDoc, PptxSlide } from '../../lib/pptx'

// Viewer PowerPoint best-effort (Fase 3 del piano Office): slide renderizzate
// come HTML posizionato (testo con stili base, immagini, sfondi/riempimenti
// pieni). Niente gruppi trasformati, gradienti, tabelle, grafici, animazioni.

const btn = 'tbtn' // pattern toolbar condiviso (index.css)

// Il colore di sfondo è scuro? (per il colore testo di default)
function isDark(hex?: string): boolean {
  if (!hex) return false
  const n = parseInt(hex.slice(1), 16)
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return lum < 128
}

// Una slide renderizzata alla scala data (usata anche per le miniature).
function Slide({
  slide,
  doc,
  scale,
  urls,
}: {
  slide: PptxSlide
  doc: PptxDoc
  scale: number
  urls: Map<Uint8Array, string>
}) {
  const defColor = isDark(slide.bg) ? '#f4f4f5' : '#1f2937'
  return (
    <div
      className="relative overflow-hidden rounded-md shrink-0 ring-1 ring-black/10 shadow-[0_2px_16px_rgba(0,0,0,0.5)]"
      style={{ width: doc.w * scale, height: doc.h * scale, background: slide.bg ?? '#ffffff' }}
    >
      {slide.shapes.map((s, i) => {
        const st: React.CSSProperties = {
          position: 'absolute',
          left: s.x * scale,
          top: s.y * scale,
          width: s.w * scale,
          height: s.h * scale,
        }
        if (s.img) {
          const url = urls.get(s.img.bytes)
          return url ? <img key={i} src={url} alt="" style={{ ...st, objectFit: 'fill' }} /> : null
        }
        return (
          <div key={i} style={{ ...st, background: s.fill, overflow: 'hidden' }}>
            {s.paras?.map((p, j) => (
              <div
                key={j}
                style={{
                  textAlign: (p.align as 'left' | 'center' | 'right') ?? 'left',
                  padding: `0 ${6 * scale}px`,
                  lineHeight: 1.25,
                }}
              >
                {p.bullet && <span style={{ color: defColor, fontSize: 18 * scale }}>• </span>}
                {p.runs.map((r, k) => (
                  <span
                    key={k}
                    style={{
                      fontSize: (r.sz ?? 24) * scale,
                      fontWeight: r.b ? 700 : 400,
                      fontStyle: r.i ? 'italic' : undefined,
                      color: r.color ?? defColor,
                    }}
                  >
                    {r.text}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export function PptxViewer({ filePath }: { filePath: string }) {
  const [doc, setDoc] = useState<PptxDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [scale, setScale] = useState(0.8)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const urlsRef = useRef(new Map<Uint8Array, string>())
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setDoc(null)
    ;(async () => {
      const bytes = await readFile(filePath)
      const { parsePptx } = await import('../../lib/pptx')
      const parsed = parsePptx(bytes)
      if (cancelled) return
      // Immagini → object URL (una volta sola, revocate alla chiusura).
      const urls = new Map<Uint8Array, string>()
      for (const slide of parsed.slides)
        for (const s of slide.shapes) {
          if (s.img && !urls.has(s.img.bytes)) {
            const blob = new Blob([s.img.bytes], { type: IMAGE_MIME[s.img.ext] ?? 'image/png' })
            urls.set(s.img.bytes, URL.createObjectURL(blob))
          }
        }
      urlsRef.current = urls
      // Adatta alla larghezza disponibile.
      const cw = containerRef.current?.clientWidth ?? 900
      setScale(Math.max(0.2, Math.min(1.5, (cw - 64) / parsed.w)))
      setDoc(parsed)
      setLoading(false)
    })().catch((e) => {
      console.error('Apertura PPTX:', e)
      if (!cancelled) {
        setError(true)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
      for (const url of urlsRef.current.values()) URL.revokeObjectURL(url)
      urlsRef.current = new Map()
    }
  }, [filePath])

  function fitWidth() {
    if (!doc) return
    const cw = containerRef.current?.clientWidth ?? 900
    setScale(Math.max(0.2, Math.min(1.5, (cw - 64) / doc.w)))
  }

  const raw = filePath.split('\\').pop() ?? ''
  let fileName = raw
  try {
    fileName = decodeURIComponent(raw)
  } catch {
    /* tieni il grezzo */
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {sidebarOpen && doc && (
        <aside className="w-52 shrink-0 border-r border-zinc-800 bg-zinc-900/40 overflow-y-auto p-2 flex flex-col gap-2">
          {doc.slides.map((s, i) => (
            <button
              key={i}
              className="block group"
              onClick={() => document.getElementById(`pptx-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              <div className="mx-auto group-hover:ring-2 group-hover:ring-blue-500 rounded-md">
                <Slide slide={s} doc={doc} scale={168 / doc.w} urls={urlsRef.current} />
              </div>
              <span className="block text-center text-[11px] text-zinc-500 mt-0.5">{i + 1}</span>
            </button>
          ))}
        </aside>
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between gap-3 shrink-0">
          <span className="text-sm text-zinc-300 flex items-center gap-2 min-w-0">
            <button className={btn} title="Miniature" onClick={() => setSidebarOpen((o) => !o)}>
              ☰
            </button>
            <span className="truncate">{fileName}</span>
            {doc && <span className="text-xs text-zinc-500 shrink-0">· {doc.slides.length} slide</span>}
          </span>
          <div className="flex items-center gap-1 text-xs text-zinc-300">
            <ConvertButton filePath={filePath} className={btn} />
            <button className={btn} title="Apri in Explorer" onClick={() => revealInExplorer(filePath).catch((e) => console.error(e))}>
              Explorer
            </button>
            <div className="w-px h-5 bg-zinc-700 mx-1" />
            <button className={btn} title="Riduci" onClick={() => setScale((s) => +Math.max(0.2, s - 0.1).toFixed(2))}>
              −
            </button>
            <span className="w-12 text-center text-zinc-400 tabular-nums">{Math.round(scale * 100)}%</span>
            <button className={btn} title="Ingrandisci" onClick={() => setScale((s) => +Math.min(2, s + 0.1).toFixed(2))}>
              +
            </button>
            <button className={btn} onClick={fitWidth}>
              Adatta
            </button>
          </div>
        </div>

        <div ref={containerRef} className="flex-1 overflow-auto bg-zinc-900 flex flex-col items-center gap-6 px-6 py-7">
          {error && <p className="m-auto text-zinc-500 text-sm">Impossibile aprire la presentazione.</p>}
          {loading && !error && (
            <div className="m-auto h-7 w-7 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
          )}
          {doc &&
            doc.slides.map((s, i) => (
              <div key={i} id={`pptx-${i}`} style={{ scrollMarginTop: 16 }}>
                <Slide slide={s} doc={doc} scale={scale} urls={urlsRef.current} />
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
