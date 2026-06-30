import { useState } from 'react'
import type { Editor } from '@tiptap/react'

// Formati foglio (px a 96dpi, ritratto).
const FORMATS: Record<string, { w: number; h: number }> = {
  A4: { w: 794, h: 1123 },
  Letter: { w: 816, h: 1056 },
  Legal: { w: 816, h: 1344 },
  A3: { w: 1123, h: 1587 },
  A5: { w: 559, h: 794 },
}

const cmToPx = (cm: number) => Math.round((cm / 2.54) * 96)

const field = 'w-full h-8 bg-zinc-800 border border-zinc-700 rounded px-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500'
const lab = 'text-xs text-zinc-400 mb-1 block'

export function DocSettings({
  editor,
  onClose,
  paper,
  setPaper,
  canvas,
  setCanvas,
}: {
  editor: Editor
  onClose: () => void
  paper: string
  setPaper: (c: string) => void
  canvas: string
  setCanvas: (c: string) => void
}) {
  const [tab, setTab] = useState<'doc' | 'hf'>('doc')
  const [format, setFormat] = useState('A4')
  const [landscape, setLandscape] = useState(false)
  const [m, setM] = useState({ top: 2.5, bottom: 2.5, left: 2, right: 2 }) // cm
  const [gap, setGap] = useState(30)
  const [hf, setHf] = useState({ hl: '', hr: '', fl: '', fr: '' })

  function applyPageSize(fmt: string, land: boolean) {
    const f = FORMATS[fmt]
    if (!f) return
    const w = land ? f.h : f.w
    const h = land ? f.w : f.h
    editor.chain().focus().updatePageWidth(w).updatePageHeight(h).run()
  }
  function applyMargins(next: typeof m) {
    editor
      .chain()
      .focus()
      .updateMargins({ top: cmToPx(next.top), bottom: cmToPx(next.bottom), left: cmToPx(next.left), right: cmToPx(next.right) })
      .run()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onMouseDown={onClose}>
      <div
        className="mt-14 mr-4 w-80 max-h-[80vh] overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex bg-zinc-800 rounded-lg p-0.5 text-xs">
            <button
              onClick={() => setTab('doc')}
              className={`px-3 py-1 rounded-md ${tab === 'doc' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400'}`}
            >
              Documento
            </button>
            <button
              onClick={() => setTab('hf')}
              className={`px-3 py-1 rounded-md ${tab === 'hf' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400'}`}
            >
              Intestazioni e piè
            </button>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200 text-lg leading-none">
            ✕
          </button>
        </div>

        {tab === 'doc' ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={lab}>Formato</label>
                <select
                  className={field}
                  value={format}
                  onChange={(e) => {
                    setFormat(e.target.value)
                    applyPageSize(e.target.value, landscape)
                  }}
                >
                  {Object.keys(FORMATS).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={lab}>Orientamento</label>
                <select
                  className={field}
                  value={landscape ? 'l' : 'p'}
                  onChange={(e) => {
                    const land = e.target.value === 'l'
                    setLandscape(land)
                    applyPageSize(format, land)
                  }}
                >
                  <option value="p">Verticale</option>
                  <option value="l">Orizzontale</option>
                </select>
              </div>
            </div>

            <div>
              <label className={lab}>Margini (cm)</label>
              <div className="grid grid-cols-4 gap-1.5">
                {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
                  <input
                    key={side}
                    type="number"
                    step="0.1"
                    min="0"
                    title={{ top: 'Alto', bottom: 'Basso', left: 'Sinistra', right: 'Destra' }[side]}
                    className={field + ' px-1 text-center'}
                    value={m[side]}
                    onChange={(e) => {
                      const next = { ...m, [side]: parseFloat(e.target.value) || 0 }
                      setM(next)
                      applyMargins(next)
                    }}
                  />
                ))}
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-[10px] text-zinc-500 mt-0.5 text-center">
                <span>Alto</span>
                <span>Basso</span>
                <span>Sin.</span>
                <span>Des.</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 items-end">
              <div>
                <label className={lab}>Spazio tra pagine (px)</label>
                <input
                  type="number"
                  min="0"
                  className={field}
                  value={gap}
                  onChange={(e) => {
                    const g = parseInt(e.target.value) || 0
                    setGap(g)
                    editor.chain().focus().updatePageGap(g).run()
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lab}>Colore foglio</label>
                <input type="color" className="w-full h-8 bg-transparent rounded cursor-pointer" value={paper} onChange={(e) => setPaper(e.target.value)} />
              </div>
              <div>
                <label className={lab}>Colore sfondo</label>
                <input
                  type="color"
                  className="w-full h-8 bg-transparent rounded cursor-pointer"
                  value={canvas}
                  onChange={(e) => {
                    setCanvas(e.target.value)
                    editor.chain().focus().updatePageBreakBackground(e.target.value).run()
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-[11px] text-zinc-500">
              Usa <code className="text-zinc-300">{'{page}'}</code> per il numero di pagina e{' '}
              <code className="text-zinc-300">{'{pages}'}</code> per il totale.
            </p>
            <div>
              <label className={lab}>Intestazione (sinistra / destra)</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={field}
                  placeholder="Sinistra"
                  value={hf.hl}
                  onChange={(e) => {
                    const next = { ...hf, hl: e.target.value }
                    setHf(next)
                    editor.chain().focus().updateHeaderContent(next.hl, next.hr).run()
                  }}
                />
                <input
                  className={field}
                  placeholder="Destra"
                  value={hf.hr}
                  onChange={(e) => {
                    const next = { ...hf, hr: e.target.value }
                    setHf(next)
                    editor.chain().focus().updateHeaderContent(next.hl, next.hr).run()
                  }}
                />
              </div>
            </div>
            <div>
              <label className={lab}>Piè di pagina (sinistra / destra)</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  className={field}
                  placeholder="Sinistra"
                  value={hf.fl}
                  onChange={(e) => {
                    const next = { ...hf, fl: e.target.value }
                    setHf(next)
                    editor.chain().focus().updateFooterContent(next.fl, next.fr).run()
                  }}
                />
                <input
                  className={field}
                  placeholder="Destra"
                  value={hf.fr}
                  onChange={(e) => {
                    const next = { ...hf, fr: e.target.value }
                    setHf(next)
                    editor.chain().focus().updateFooterContent(next.fl, next.fr).run()
                  }}
                />
              </div>
            </div>
            <button
              className="self-start text-xs px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-zinc-300 hover:bg-zinc-700"
              onClick={() => {
                const next = { ...hf, fr: 'Pagina {page} di {pages}' }
                setHf(next)
                editor.chain().focus().updateFooterContent(next.fl, next.fr).run()
              }}
            >
              + Numero pagina nel piè (a destra)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
