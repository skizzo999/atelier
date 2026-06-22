import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { Range, Extension } from '@codemirror/state'

// Live preview stile Obsidian: nasconde i marcatori markdown e formatta il
// contenuto inline, ma mostra la sintassi grezza sulla riga dove c'è il cursore
// (così la puoi modificare). Costruito sopra l'albero sintattico di CodeMirror.

const hide = Decoration.replace({})
const strong = Decoration.mark({ class: 'cm-lp-strong' })
const em = Decoration.mark({ class: 'cm-lp-em' })
const code = Decoration.mark({ class: 'cm-lp-code' })
const link = Decoration.mark({ class: 'cm-lp-link' })
const headings = [
  null,
  Decoration.mark({ class: 'cm-lp-h1' }),
  Decoration.mark({ class: 'cm-lp-h2' }),
  Decoration.mark({ class: 'cm-lp-h3' }),
  Decoration.mark({ class: 'cm-lp-h4' }),
  Decoration.mark({ class: 'cm-lp-h5' }),
  Decoration.mark({ class: 'cm-lp-h6' }),
]

function buildDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = []
  try {
    const { state } = view
    const doc = state.doc

    // Righe che contengono cursore/selezione → mostra il markdown grezzo.
    const active = new Set<number>()
    for (const r of state.selection.ranges) {
      const a = doc.lineAt(r.from).number
      const b = doc.lineAt(r.to).number
      for (let l = a; l <= b; l++) active.add(l)
    }

    for (const { from, to } of view.visibleRanges) {
      syntaxTree(state).iterate({
        from,
        to,
        enter: (node) => {
          if (active.has(doc.lineAt(node.from).number)) return
          const name = node.name

          const hm = name.match(/^ATXHeading(\d)$/)
          if (hm) {
            const level = +hm[1]
            const headerMark = node.node.getChild('HeaderMark')
            if (headerMark) {
              const contentFrom = Math.min(headerMark.to + 1, node.to)
              if (node.from < contentFrom) ranges.push(hide.range(node.from, contentFrom))
              const h = headings[level]
              if (h && contentFrom < node.to) ranges.push(h.range(contentFrom, node.to))
            }
            return
          }

          if (name === 'StrongEmphasis' || name === 'Emphasis' || name === 'InlineCode') {
            const markName = name === 'InlineCode' ? 'CodeMark' : 'EmphasisMark'
            const marks = node.node.getChildren(markName)
            if (marks.length >= 2) {
              const open = marks[0]
              const close = marks[marks.length - 1]
              ranges.push(hide.range(open.from, open.to))
              ranges.push(hide.range(close.from, close.to))
              const deco = name === 'StrongEmphasis' ? strong : name === 'Emphasis' ? em : code
              if (open.to < close.from) ranges.push(deco.range(open.to, close.from))
            }
            return
          }

          if (name === 'Link') {
            const marks = node.node.getChildren('LinkMark')
            if (marks.length >= 2) {
              const openBr = marks[0] // [
              const closeBr = marks[1] // ]
              ranges.push(hide.range(openBr.from, openBr.to))
              if (closeBr.from < node.to) ranges.push(hide.range(closeBr.from, node.to))
              if (openBr.to < closeBr.from) ranges.push(link.range(openBr.to, closeBr.from))
            }
            return
          }
        },
      })
    }
  } catch (e) {
    console.error('livePreview build error:', e)
    return Decoration.none
  }
  return Decoration.set(ranges, true)
}

const livePreviewTheme = EditorView.theme({
  '.cm-lp-h1': { fontSize: '1.7em', fontWeight: '700' },
  '.cm-lp-h2': { fontSize: '1.45em', fontWeight: '700' },
  '.cm-lp-h3': { fontSize: '1.25em', fontWeight: '700' },
  '.cm-lp-h4': { fontSize: '1.1em', fontWeight: '700' },
  '.cm-lp-h5': { fontWeight: '700' },
  '.cm-lp-h6': { fontWeight: '700', opacity: '0.8' },
  '.cm-lp-strong': { fontWeight: '700' },
  '.cm-lp-em': { fontStyle: 'italic' },
  '.cm-lp-code': {
    fontFamily: 'ui-monospace, monospace',
    background: 'rgba(255,255,255,0.08)',
    padding: '0.05em 0.3em',
    borderRadius: '3px',
  },
  '.cm-lp-link': { color: '#7aa2f7', textDecoration: 'underline' },
})

export function livePreview(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        constructor(view: EditorView) {
          this.decorations = buildDecorations(view)
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.selectionSet || u.viewportChanged) {
            this.decorations = buildDecorations(u.view)
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    livePreviewTheme,
  ]
}
