import { useState } from 'react'
import type { Editor } from '@tiptap/react'

export type PageNumMode = 'none' | 'page' | 'page-total' | 'page-of-total'

// Impostazioni di impaginazione riportate a DocxEditor (per salvarle nel .docx).
export interface DocLayout {
  format: string
  landscape: boolean
  margins: { top: number; bottom: number; left: number; right: number } // cm
  headerLeft: string
  headerRight: string
}

// Formati foglio (px a 96dpi, ritratto).
export const FORMATS: Record<string, { w: number; h: number }> = {
  A4: { w: 794, h: 1123 },
  Letter: { w: 816, h: 1056 },
  Legal: { w: 816, h: 1344 },
  A3: { w: 1123, h: 1587 },
  A5: { w: 559, h: 794 },
}

export const cmToPx = (cm: number) => Math.round((cm / 2.54) * 96)

const field = 'w-full h-8 bg-zinc-800 border border-zinc-700 rounded px-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500'
const lab = 'text-xs text-zinc-400 mb-1 block'

export function DocSettings({
  editor,
  onClose,
  paper,
  setPaper,
  pageNumMode,
  setPageNumMode,
  footerLeft,
  setFooterLeft,
  onLayout,
  initial,
}: {
  editor: Editor
  onClose: () => void
  paper: string
  setPaper: (c: string) => void
  pageNumMode: PageNumMode
  setPageNumMode: (m: PageNumMode) => void
  footerLeft: string
  setFooterLeft: (t: string) => void
  onLayout: (patch: Partial<DocLayout>) => void
  initial: DocLayout
}) {
  const [tab, setTab] = useState<'doc' | 'hf'>('doc')
  const [format, setFormat] = useState(initial.format)
  const [landscape, setLandscape] = useState(initial.landscape)
  const [m, setM] = useState(initial.margins) // cm
  const [gap, setGap] = useState(30)
  const [hf, setHf] = useState({ hl: initial.headerLeft, hr: initial.headerRight })

  function applyPageSize(fmt: string, land: boolean) {
    const f = FORMATS[fmt]
    if (!f) return
    const w = land ? f.h : f.w
    const h = land ? f.w : f.h
    editor.chain().updatePageWidth(w).updatePageHeight(h).run()
  }
  function applyMargins(next: typeof m) {
    editor
      .chain()
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
                    onLayout({ format: e.target.value })
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
                    onLayout({ landscape: land })
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
                      onLayout({ margins: next })
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

            <div className="grid grid-cols-2 gap-3 items-end">
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
                    editor.chain().updatePageGap(g).run()
                  }}
                />
              </div>
              <div>
                <label className={lab}>Colore foglio</label>
                <input type="color" className="w-full h-8 bg-transparent rounded cursor-pointer" value={paper} onChange={(e) => setPaper(e.target.value)} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
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
                    editor.commands.updateHeaderContent(next.hl, next.hr)
                    onLayout({ headerLeft: next.hl, headerRight: next.hr })
                  }}
                />
                <input
                  className={field}
                  placeholder="Destra"
                  value={hf.hr}
                  onChange={(e) => {
                    const next = { ...hf, hr: e.target.value }
                    setHf(next)
                    editor.commands.updateHeaderContent(next.hl, next.hr)
                    onLayout({ headerLeft: next.hl, headerRight: next.hr })
                  }}
                />
              </div>
            </div>

            <div>
              <label className={lab}>Piè di pagina (basso a sinistra)</label>
              <input
                className={field}
                placeholder="Testo libero"
                value={footerLeft}
                onChange={(e) => setFooterLeft(e.target.value)}
              />
            </div>

            <div>
              <label className={lab}>Numero di pagina (basso a destra)</label>
              <select className={field} value={pageNumMode} onChange={(e) => setPageNumMode(e.target.value as PageNumMode)}>
                <option value="none">Nessuno</option>
                <option value="page">Solo numero — “3”</option>
                <option value="page-total">Numero / totale — “3 / 8”</option>
                <option value="page-of-total">Esteso — “Pagina 3 di 8”</option>
              </select>
              <p className="text-[11px] text-zinc-500 mt-1.5">Il totale è calcolato automaticamente.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
