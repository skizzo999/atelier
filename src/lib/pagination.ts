import { Extension } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

// Paginazione "a blocchi" stile Word/Google Docs: il contenuto scorre su fogli A4
// distinti e, quando un blocco non entra nella pagina, viene spinto INTERO alla
// pagina successiva (come "mantieni assieme"). Implementata con decorazioni widget
// (niente modifica dello schema): se qualcosa va storto, si degrada a flusso continuo.

// Geometria A4 a 96dpi.
const PAGE_H = 1123 // altezza foglio
const GAP = 26 // spazio grigio tra due fogli
const MARGIN = 76 // margine pagina (alto/basso/lati)
const USABLE = PAGE_H - MARGIN * 2 // altezza utile del contenuto per pagina
const PITCH = PAGE_H + GAP

const KEY = new PluginKey<DecorationSet>('atelierPagination')

// Calcola dove inserire i "salti pagina" misurando l'altezza reale dei blocchi.
function measure(view: EditorView): { set: DecorationSet; sig: string } {
  const doc = view.state.doc
  const decos: Decoration[] = []
  const sig: string[] = []
  let y = MARGIN // posizione del prossimo blocco (parte dal margine alto di pag. 1)
  let page = 0

  doc.forEach((_node, offset) => {
    const dom = view.nodeDOM(offset)
    if (!(dom instanceof HTMLElement)) return
    const st = getComputedStyle(dom)
    const h = dom.offsetHeight + (parseFloat(st.marginTop) || 0) + (parseFloat(st.marginBottom) || 0)
    const pageBottom = page * PITCH + (PAGE_H - MARGIN) // fondo area-testo della pagina corrente

    // Il blocco non entra (e ci sta in una pagina vuota) → salto pagina prima di lui.
    if (h > 0 && h <= USABLE && y + h > pageBottom + 1) {
      const nextTop = (page + 1) * PITCH + MARGIN
      const spacerH = Math.round(nextTop - y)
      const whiteBottom = spacerH - GAP - MARGIN // resto bianco della pagina corrente
      decos.push(
        Decoration.widget(
          offset,
          () => {
            const el = document.createElement('div')
            el.className = 'docx-page-break'
            el.style.height = `${spacerH}px`
            // bianco (resto pagina) → grigio (gap) → bianco (margine alto pagina nuova)
            el.style.background = `linear-gradient(to bottom,#fff 0,#fff ${whiteBottom}px,#6b7280 ${whiteBottom}px,#6b7280 ${whiteBottom + GAP}px,#fff ${whiteBottom + GAP}px,#fff 100%)`
            el.setAttribute('contenteditable', 'false')
            return el
          },
          { side: -1, key: `pb-${offset}-${spacerH}` },
        ),
      )
      sig.push(`${offset}:${spacerH}`)
      y = nextTop
      page++
    }
    y += h
  })

  return { set: DecorationSet.create(doc, decos), sig: sig.join('|') }
}

export const Pagination = Extension.create({
  name: 'atelierPagination',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: KEY,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(KEY)
            if (meta) return meta as DecorationSet
            return old.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return KEY.getState(state)
          },
        },
        view(view) {
          let raf = 0
          let lastSig = ''
          const run = () => {
            cancelAnimationFrame(raf)
            raf = requestAnimationFrame(() => {
              try {
                const { set, sig } = measure(view)
                if (sig !== lastSig) {
                  lastSig = sig
                  view.dispatch(view.state.tr.setMeta(KEY, set).setMeta('addToHistory', false))
                }
              } catch {
                /* fail-safe: nessuna paginazione (flusso continuo) */
              }
            })
          }
          run()
          const ro = new ResizeObserver(run)
          ro.observe(view.dom)
          return {
            update(v, prevState) {
              if (v.state.doc !== prevState.doc) run()
            },
            destroy() {
              cancelAnimationFrame(raf)
              ro.disconnect()
            },
          }
        },
      }),
    ]
  },
})
