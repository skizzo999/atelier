import { useCallback, useEffect, useRef, useState } from 'react'
import { readFile } from '@tauri-apps/plugin-fs'
import { revealInExplorer } from '../../lib/imageActions'
import { ConvertButton } from '../Convert/ConvertButton'

// Viewer PowerPoint ad alta fedeltà: rendering di @aiden0z/pptx-renderer
// (Apache-2.0, HTML/SVG, scelto con lo spike sui file veri — vedi
// docs/sessions/2026-07-16). Il FILE resta la verità: qui solo lettura;
// l'editor arriverà con la chirurgia XML sullo zip.
// Modalità PRESENTA: schermo intero, click/frecce avanti, Esc esce.

const btn = 'tbtn' // pattern toolbar condiviso (index.css)

// Tipi minimi della libreria (caricata pigra: pesa, serve solo per i .pptx).
interface LibViewer {
  goToSlide(i: number): void
  setZoom(percent: number): void
  // NB: possono restituire sia una Promise sia un valore sincrono
  renderSlideToContainer(i: number, el: HTMLElement): unknown
  renderThumbnailToContainer(i: number, el: HTMLElement): unknown
  renderList(opts?: { windowed?: boolean }): Promise<unknown>
  load(pres: unknown): void
  destroy(): void
}
interface LibModule {
  PptxViewer: {
    new (el: HTMLElement, opts?: Record<string, unknown>): LibViewer
    open(buf: ArrayBuffer, el: HTMLElement, opts?: Record<string, unknown>): Promise<LibViewer>
  }
  parseZip(buf: ArrayBuffer, limits?: unknown): Promise<unknown>
  buildPresentation(files: unknown): { slides?: unknown[] }
  RECOMMENDED_ZIP_LIMITS: unknown
}

export function PptxViewer({ filePath }: { filePath: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [count, setCount] = useState(0)
  const [zoom, setZoomState] = useState(100)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [presenting, setPresenting] = useState<number | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<LibViewer | null>(null)
  const presentingRef = useRef<number | null>(null)
  presentingRef.current = presenting
  const countRef = useRef(0)
  countRef.current = count
  const stageRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // ---- Apertura del file ----
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setCount(0)
    setPresenting(null)
    ;(async () => {
      const bytes = await readFile(filePath)
      const mod = (await import('@aiden0z/pptx-renderer')) as unknown as LibModule
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      const files = await mod.parseZip(buf, mod.RECOMMENDED_ZIP_LIMITS)
      const pres = mod.buildPresentation(files)
      if (cancelled || !containerRef.current) return
      const viewer = new mod.PptxViewer(containerRef.current, { fitMode: 'contain' })
      viewer.load(pres)
      await viewer.renderList({ windowed: true })
      if (cancelled) {
        viewer.destroy()
        return
      }
      viewerRef.current = viewer
      setCount(pres.slides?.length ?? 0)
      // Lo zoom della libreria è RELATIVO al contenitore (100 = tutta la
      // larghezza utile): 96 lascia un piccolo margine, come "Adatta".
      viewer.setZoom(96)
      zoomRef.current = 96
      setZoomState(96)
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
      viewerRef.current?.destroy()
      viewerRef.current = null
    }
  }, [filePath])

  // zoomRef evita la chiusura stantia sui click rapidi di +/−.
  const zoomRef = useRef(100)
  function applyZoom(p: number) {
    const z = Math.max(20, Math.min(200, Math.round(p)))
    zoomRef.current = z
    setZoomState(z)
    viewerRef.current?.setZoom(z)
  }
  function fitWidth() {
    applyZoom(96)
  }

  // ---- Miniature (rese dalla libreria, una per slide) ----
  const thumbRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || el.childElementCount > 0) return
      const i = Number(el.dataset.slide)
      try {
        void Promise.resolve(viewerRef.current?.renderThumbnailToContainer(i, el)).catch(() => {})
      } catch (e) {
        console.error('Miniatura pptx:', e)
      }
    },
    // le miniature vanno ricreate quando cambia file (count torna a 0 e poi al nuovo valore)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filePath, count],
  )

  // ---- Modalità Presenta ----
  const showSlide = useCallback(async (i: number) => {
    const stage = stageRef.current
    const v = viewerRef.current
    if (!stage || !v) return
    stage.innerHTML = ''
    await v.renderSlideToContainer(i, stage)
    // La libreria rende a dimensione modello: scala per riempire lo schermo.
    const child = stage.firstElementChild as HTMLElement | null
    if (child) {
      const w = child.offsetWidth || 960
      const h = child.offsetHeight || 540
      const k = Math.min(window.innerWidth / w, window.innerHeight / h)
      stage.style.width = `${w}px`
      stage.style.height = `${h}px`
      stage.style.transform = `scale(${k})`
      stage.style.transformOrigin = 'center center'
    }
  }, [])

  const startPresent = useCallback(() => {
    setPresenting(0)
  }, [])
  const stopPresent = useCallback(() => {
    setPresenting(null)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }, [])

  useEffect(() => {
    if (presenting === null) return
    // Schermo intero sull'overlay (se il permesso manca, resta a finestra piena).
    overlayRef.current?.requestFullscreen?.().catch(() => {})
    void showSlide(presenting)

    const step = (d: number) => {
      const cur = presentingRef.current ?? 0
      const next = Math.max(0, Math.min(countRef.current - 1, cur + d))
      if (next !== cur) setPresenting(next)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        stopPresent()
      } else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown' || e.key === 'Enter') {
        e.preventDefault()
        step(1)
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace') {
        e.preventDefault()
        step(-1)
      }
    }
    const onFsChange = () => {
      if (!document.fullscreenElement && presentingRef.current !== null) setPresenting(null)
    }
    const onResize = () => {
      if (presentingRef.current !== null) void showSlide(presentingRef.current)
    }
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('fullscreenchange', onFsChange)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('fullscreenchange', onFsChange)
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenting === null])

  // Cambio slide durante la presentazione.
  useEffect(() => {
    if (presenting !== null) void showSlide(presenting)
  }, [presenting, showSlide])

  const raw = filePath.split('\\').pop() ?? ''
  let fileName = raw
  try {
    fileName = decodeURIComponent(raw)
  } catch {
    /* tieni il grezzo */
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {sidebarOpen && count > 0 && (
        <aside className="w-52 shrink-0 border-r border-zinc-800 bg-zinc-900/40 overflow-y-auto p-2 flex flex-col gap-2">
          {Array.from({ length: count }, (_, i) => (
            <button key={`${filePath}-${i}`} className="block group" onClick={() => viewerRef.current?.goToSlide(i)}>
              <div
                ref={thumbRef}
                data-slide={i}
                className="mx-auto rounded-md overflow-hidden ring-1 ring-black/20 group-hover:ring-2 group-hover:ring-blue-500"
              />
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
            {count > 0 && <span className="text-xs text-zinc-500 shrink-0">· {count} slide</span>}
          </span>
          <div className="flex items-center gap-1 text-xs text-zinc-300">
            <ConvertButton filePath={filePath} className={btn} />
            <button className={btn} title="Apri in Explorer" onClick={() => revealInExplorer(filePath).catch((e) => console.error(e))}>
              Explorer
            </button>
            <div className="tsep" />
            <button className={btn} title="Riduci" onClick={() => applyZoom(zoomRef.current - 10)}>
              −
            </button>
            <span className="w-12 text-center text-zinc-400 tabular-nums">{zoom}%</span>
            <button className={btn} title="Ingrandisci" onClick={() => applyZoom(zoomRef.current + 10)}>
              +
            </button>
            <button className={btn} onClick={fitWidth}>
              Adatta
            </button>
            <div className="tsep" />
            <button
              className="btn-accent rounded-md h-7 px-3 text-xs font-medium disabled:opacity-40"
              disabled={count === 0}
              onClick={startPresent}
              title="Presenta a schermo intero (frecce o click per avanzare, Esc per uscire)"
            >
              Presenta
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-zinc-900 relative">
          {error && <p className="absolute inset-0 grid place-items-center text-zinc-500 text-sm">Impossibile aprire la presentazione.</p>}
          {loading && !error && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="h-7 w-7 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
            </div>
          )}
          <div ref={containerRef} className="px-6 py-7 [&_*]:select-text" />
        </div>
      </div>

      {presenting !== null && (
        <div
          ref={overlayRef}
          className="fixed inset-0 z-[100] bg-black grid place-items-center cursor-pointer select-none"
          onClick={() => {
            const next = Math.min(countRef.current - 1, (presentingRef.current ?? 0) + 1)
            if (next === presentingRef.current) stopPresent()
            else setPresenting(next)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            const prev = Math.max(0, (presentingRef.current ?? 0) - 1)
            setPresenting(prev)
          }}
        >
          <div ref={stageRef} />
          <div className="absolute bottom-3 right-4 text-zinc-600 text-xs tabular-nums pointer-events-none">
            {presenting + 1} / {count}
          </div>
        </div>
      )}
    </div>
  )
}
