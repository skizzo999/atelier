import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { Range, Extension, Text } from '@codemirror/state'
import { loadImage } from '../../lib/images'

// Live preview stile Obsidian: nasconde i marcatori markdown e formatta il
// contenuto inline, mostrando la sintassi grezza sulla riga col cursore.

class BulletWidget extends WidgetType {
  toDOM() {
    const s = document.createElement('span')
    s.textContent = '•'
    s.className = 'cm-lp-bullet'
    return s
  }
  eq() {
    return true
  }
}
const bullet = Decoration.replace({ widget: new BulletWidget() })

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  toDOM() {
    const i = document.createElement('input')
    i.type = 'checkbox'
    i.checked = this.checked
    i.disabled = true
    i.className = 'cm-lp-checkbox'
    return i
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked
  }
}

// Renderizza un'immagine ![alt](path) caricando il file (path relativo al vault).
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly fileDir: string,
  ) {
    super()
  }
  toDOM() {
    const img = document.createElement('img')
    img.alt = this.alt
    img.className = 'cm-lp-image'
    loadImage(this.src, this.fileDir).then((url) => {
      if (url) img.src = url
    })
    return img
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.fileDir === this.fileDir
  }
}

const hide = Decoration.replace({})
const strong = Decoration.mark({ class: 'cm-lp-strong' })
const em = Decoration.mark({ class: 'cm-lp-em' })
const strike = Decoration.mark({ class: 'cm-lp-strike' })
const code = Decoration.mark({ class: 'cm-lp-code' })
const link = Decoration.mark({ class: 'cm-lp-link' })
const highlight = Decoration.mark({ class: 'cm-lp-highlight' })
const wikilink = Decoration.mark({ class: 'cm-lp-wikilink' })
const headings = [
  null,
  Decoration.mark({ class: 'cm-lp-h1' }),
  Decoration.mark({ class: 'cm-lp-h2' }),
  Decoration.mark({ class: 'cm-lp-h3' }),
  Decoration.mark({ class: 'cm-lp-h4' }),
  Decoration.mark({ class: 'cm-lp-h5' }),
  Decoration.mark({ class: 'cm-lp-h6' }),
]

// Decorazioni di riga.
const quoteLine = Decoration.line({ class: 'cm-lp-quote' })
const calloutLine = Decoration.line({ class: 'cm-lp-callout' })
const codeBlockLine = Decoration.line({ class: 'cm-lp-codeblock' })
const tableLine = Decoration.line({ class: 'cm-lp-table' })
const hrLine = Decoration.line({ class: 'cm-lp-hr' })
const blockspace = Decoration.line({ class: 'cm-lp-blockspace' })

function eachLine(doc: Text, from: number, to: number, fn: (lineFrom: number) => void) {
  const first = doc.lineAt(from).number
  const last = doc.lineAt(Math.min(to, doc.length)).number
  for (let n = first; n <= last; n++) fn(doc.line(n).from)
}

function buildDecorations(view: EditorView, fileDir: string): DecorationSet {
  const ranges: Range<Decoration>[] = []
  try {
    const { state } = view
    const doc = state.doc

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
          const name = node.name

          // --- Blocchi multi-riga ---
          if (name === 'Blockquote') {
            // Callout stile Obsidian: prima riga tipo "> [!nota] Titolo".
            const firstLine = doc.lineAt(node.from)
            const cm = /\[!(\w+)\]/.exec(firstLine.text)
            const lineDeco = cm ? calloutLine : quoteLine
            eachLine(doc, node.from, node.to, (lf) => ranges.push(lineDeco.range(lf)))
            if (cm && !active.has(firstLine.number)) {
              const s = firstLine.from + cm.index
              ranges.push(hide.range(s, s + cm[0].length))
            }
            return
          }
          if (name === 'FencedCode' || name === 'CodeBlock') {
            eachLine(doc, node.from, node.to, (lf) => ranges.push(codeBlockLine.range(lf)))
            return false
          }
          if (name === 'Table') {
            eachLine(doc, node.from, node.to, (lf) => ranges.push(tableLine.range(lf)))
            return false
          }

          // --- Nodi su singola riga: grezzo sulla riga attiva ---
          if (active.has(doc.lineAt(node.from).number)) return

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
            ranges.push(blockspace.range(doc.lineAt(node.from).from))
            return
          }

          const sm = name.match(/^SetextHeading(\d)$/)
          if (sm) {
            const level = +sm[1]
            const headerMark = node.node.getChild('HeaderMark')
            const contentTo = headerMark ? headerMark.from : node.to
            const h = headings[level]
            if (h && node.from < contentTo) ranges.push(h.range(node.from, contentTo))
            if (headerMark) ranges.push(hide.range(headerMark.from, headerMark.to))
            ranges.push(blockspace.range(doc.lineAt(node.from).from))
            return false
          }

          if (name === 'StrongEmphasis' || name === 'Emphasis' || name === 'InlineCode' || name === 'Strikethrough') {
            const markName =
              name === 'InlineCode' ? 'CodeMark' : name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark'
            const marks = node.node.getChildren(markName)
            if (marks.length >= 2) {
              const open = marks[0]
              const close = marks[marks.length - 1]
              ranges.push(hide.range(open.from, open.to))
              ranges.push(hide.range(close.from, close.to))
              const deco =
                name === 'StrongEmphasis'
                  ? strong
                  : name === 'Emphasis'
                    ? em
                    : name === 'Strikethrough'
                      ? strike
                      : code
              if (open.to < close.from) ranges.push(deco.range(open.to, close.from))
            }
            return
          }

          if (name === 'Task') {
            const text = doc.sliceString(node.from, node.to)
            const checked = /\[x\]/i.test(text)
            ranges.push(
              Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to),
            )
            return
          }

          if (name === 'ListMark') {
            const item = node.node.parent
            const list = item?.parent
            if (list && list.name === 'BulletList') {
              // Task list: niente bullet (il checkbox lo rende il nodo Task).
              if (item?.getChild('Task')) ranges.push(hide.range(node.from, node.to))
              else ranges.push(bullet.range(node.from, node.to))
            }
            return
          }

          if (name === 'QuoteMark') {
            ranges.push(hide.range(node.from, node.to))
            return
          }

          if (name === 'HorizontalRule') {
            ranges.push(hrLine.range(doc.lineAt(node.from).from))
            ranges.push(hide.range(node.from, node.to))
            return
          }

          if (name === 'Image') {
            const text = doc.sliceString(node.from, node.to)
            const m = /^!\[([^\]]*)\]\(([^)\s]+)/.exec(text)
            if (m) {
              ranges.push(
                Decoration.replace({ widget: new ImageWidget(m[2], m[1], fileDir) }).range(
                  node.from,
                  node.to,
                ),
              )
            }
            return false
          }

          if (name === 'Link') {
            const marks = node.node.getChildren('LinkMark')
            if (marks.length >= 2) {
              const openBr = marks[0]
              const closeBr = marks[1]
              ranges.push(hide.range(openBr.from, openBr.to))
              if (closeBr.from < node.to) ranges.push(hide.range(closeBr.from, node.to))
              if (openBr.to < closeBr.from) ranges.push(link.range(openBr.to, closeBr.from))
            }
            return
          }
        },
      })
    }

    // Evidenziato ==testo== (estensione stile Obsidian, non nel parser): regex.
    for (const { from, to } of view.visibleRanges) {
      const first = doc.lineAt(from).number
      const last = doc.lineAt(to).number
      const re = /==([^=\n]+)==/g
      for (let n = first; n <= last; n++) {
        if (active.has(n)) continue
        const line = doc.line(n)
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(line.text))) {
          const s = line.from + m.index
          const e = s + m[0].length
          ranges.push(hide.range(s, s + 2))
          ranges.push(highlight.range(s + 2, e - 2))
          ranges.push(hide.range(e - 2, e))
        }
      }
    }

    // Embed immagine ![[file]] (stile Obsidian): renderizza l'immagine.
    for (const { from, to } of view.visibleRanges) {
      const first = doc.lineAt(from).number
      const last = doc.lineAt(to).number
      const re = /!\[\[([^\]\n]+)\]\]/g
      for (let n = first; n <= last; n++) {
        if (active.has(n)) continue
        const line = doc.line(n)
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(line.text))) {
          const s = line.from + m.index
          const e = s + m[0].length
          ranges.push(
            Decoration.replace({ widget: new ImageWidget(m[1], m[1], fileDir) }).range(s, e),
          )
        }
      }
    }

    // Wikilink [[nota]] (stile Obsidian): mostra "nota" come link, nasconde [[ ]].
    // Salta i match preceduti da '!' (sono embed immagine, gestiti sopra).
    for (const { from, to } of view.visibleRanges) {
      const first = doc.lineAt(from).number
      const last = doc.lineAt(to).number
      const re = /\[\[([^\]\n]+)\]\]/g
      for (let n = first; n <= last; n++) {
        if (active.has(n)) continue
        const line = doc.line(n)
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(line.text))) {
          if (m.index > 0 && line.text[m.index - 1] === '!') continue
          const s = line.from + m.index
          const e = s + m[0].length
          ranges.push(hide.range(s, s + 2))
          ranges.push(wikilink.range(s + 2, e - 2))
          ranges.push(hide.range(e - 2, e))
        }
      }
    }
  } catch (e) {
    console.error('livePreview build error:', e)
    return Decoration.none
  }
  return Decoration.set(ranges, true)
}

// Aspetto "documento" (come la vista Lettura): font proporzionale, sfondo app.
const HEAD = '#e4e4e7'
const PROSE_FONT = 'Inter, system-ui, Avenir, Helvetica, Arial, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

const livePreviewTheme = EditorView.theme({
  '&': { backgroundColor: '#18181b' },
  '.cm-scroller': { fontFamily: PROSE_FONT },
  '.cm-content': {
    fontFamily: PROSE_FONT,
    fontSize: '16px',
    lineHeight: '1.9',
    padding: '28px 36px',
    caretColor: '#e4e4e7',
    color: '#dcddde',
  },
  '.cm-lp-blockspace': { paddingTop: '1em' },
  '.cm-lp-h1': { fontSize: '2em', fontWeight: '700', color: HEAD },
  '.cm-lp-h2': { fontSize: '1.5em', fontWeight: '700', color: HEAD },
  '.cm-lp-h3': { fontSize: '1.25em', fontWeight: '700', color: HEAD },
  '.cm-lp-h4': { fontSize: '1.05em', fontWeight: '700', color: HEAD },
  '.cm-lp-h5': { fontWeight: '700', color: HEAD },
  '.cm-lp-h6': { fontWeight: '700', color: HEAD },
  '.cm-lp-strong': { fontWeight: '700', color: HEAD },
  '.cm-lp-em': { fontStyle: 'italic' },
  '.cm-lp-strike': { textDecoration: 'line-through', color: '#9aa0aa' },
  '.cm-lp-highlight': { backgroundColor: 'rgba(250, 204, 21, 0.25)', borderRadius: '3px', padding: '0 0.1em' },
  '.cm-lp-code': {
    fontFamily: MONO,
    fontSize: '0.875em',
    background: 'rgba(255,255,255,0.08)',
    padding: '0.1em 0.35em',
    borderRadius: '4px',
  },
  '.cm-lp-link': { color: '#7aa2f7', textDecoration: 'underline' },
  '.cm-lp-wikilink': { color: '#7aa2f7', textDecoration: 'underline' },
  '.cm-lp-callout': {
    borderLeft: '3px solid #7aa2f7',
    paddingLeft: '1em',
    background: 'rgba(122,162,247,0.08)',
  },
  '.cm-lp-bullet': { color: '#9aa0aa' },
  '.cm-lp-checkbox': { marginRight: '0.4em', verticalAlign: 'middle' },
  '.cm-lp-quote': {
    borderLeft: '3px solid #52525b',
    paddingLeft: '1em',
    color: '#a1a1aa',
    fontStyle: 'italic',
  },
  '.cm-lp-codeblock': { fontFamily: MONO, fontSize: '0.875em', background: 'rgba(255,255,255,0.05)' },
  '.cm-lp-table': { fontFamily: MONO, fontSize: '0.875em', background: 'rgba(255,255,255,0.03)' },
  '.cm-lp-hr': { borderBottom: '1px solid #52525b' },
  '.cm-lp-image': { display: 'block', maxWidth: '100%', borderRadius: '6px', margin: '0.3em 0' },
  '.cm-cursor': { borderLeftColor: '#e4e4e7' },
  '.cm-gutters': { display: 'none' },
}, { dark: true })

export function livePreview(fileDir: string): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        constructor(view: EditorView) {
          this.decorations = buildDecorations(view, fileDir)
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.selectionSet || u.viewportChanged) {
            this.decorations = buildDecorations(u.view, fileDir)
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    livePreviewTheme,
  ]
}
