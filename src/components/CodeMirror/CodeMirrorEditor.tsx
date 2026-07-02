import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { GFM } from '@lezer/markdown'
import { tags as t } from '@lezer/highlight'
import { oneDark } from '@codemirror/theme-one-dark'
import { livePreview } from './livePreview'
import { tableEditor } from './tableEditor'

// Stile per il SOLO codice (dentro i blocchi ```): colora i token di programmazione
// ma NON i tag markdown (titoli/grassetto restano neutri in Ibrida).
const codeHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#c678dd' },
  { tag: [t.function(t.variableName), t.labelName], color: '#61afef' },
  { tag: [t.constant(t.name), t.standard(t.name), t.bool, t.atom], color: '#d19a66' },
  { tag: [t.typeName, t.className, t.number, t.annotation, t.self], color: '#e5c07b' },
  { tag: [t.operator, t.operatorKeyword], color: '#56b6c2' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#98c379' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#7d8799', fontStyle: 'italic' },
  { tag: [t.propertyName], color: '#e06c75' },
  { tag: [t.meta, t.punctuation], color: '#abb2bf' },
])

// Tema di base: riempie l'altezza, font monospazio, niente outline di focus.
const baseTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '13px',
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '16px' },
  '&.cm-focused': { outline: 'none' },
})

// ---- Menu contestuale (tasto destro nei .md, stile Obsidian) ----

interface CtxItem {
  label: string
  disabled?: boolean
  action?: () => void
  children?: CtxItem[]
  separator?: boolean
}

const itemCls = 'w-full text-left px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-transparent flex items-center justify-between gap-3'

// Sottomenu che si auto-ribalta: misura dove finisce e, se sborda dal bordo
// destro (o dal basso) della finestra, si apre a sinistra (o si alza).
function SubMenu({ items, onClose }: { items: CtxItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({ left: '100%', top: 0, visibility: 'hidden' })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const s: React.CSSProperties = { top: 0 }
    if (r.right > window.innerWidth - 4) s.right = '100%'
    else s.left = '100%'
    if (r.bottom > window.innerHeight - 4) s.top = -(r.bottom - window.innerHeight + 8)
    setStyle(s)
  }, [])
  return (
    <div ref={ref} className="absolute z-10" style={style}>
      <CtxMenuList items={items} onClose={onClose} />
    </div>
  )
}

function CtxMenuList({ items, onClose }: { items: CtxItem[]; onClose: () => void }) {
  const [sub, setSub] = useState<string | null>(null)
  return (
    <div className="w-52 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1">
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="h-px bg-zinc-700 my-1" />
        ) : (
          <div key={it.label} className="relative" onMouseEnter={() => setSub(it.children ? it.label : null)}>
            <button
              className={itemCls}
              disabled={it.disabled}
              onClick={() => {
                if (it.children) return
                onClose()
                it.action?.()
              }}
            >
              <span>{it.label}</span>
              {it.children && <span className="text-zinc-500 text-xs">▸</span>}
            </button>
            {it.children && sub === it.label && <SubMenu items={it.children} onClose={onClose} />}
          </div>
        ),
      )}
    </div>
  )
}

// Editor di testo basato su CodeMirror 6, integrato con lo stato React.
// `value` è la fonte di verità lato React; le modifiche dell'utente risalgono
// via `onChange`, mentre i cambi esterni di `value` (cambio file) vengono
// applicati al documento senza ri-emettere onChange.
export function CodeMirrorEditor({
  value,
  onChange,
  markdownMode,
  livePreviewMode = false,
  fileDir = '',
  onWikilink,
  viewRef,
}: {
  value: string
  onChange: (v: string) => void
  markdownMode: boolean
  livePreviewMode?: boolean
  fileDir?: string
  onWikilink?: (name: string) => void
  viewRef?: React.MutableRefObject<EditorView | null>
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const settingExternally = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onWikilinkRef = useRef(onWikilink)
  onWikilinkRef.current = onWikilink
  // Menu contestuale: posizione + se c'era testo selezionato all'apertura.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; hasSel: boolean } | null>(null)

  // Crea l'editor (ricreato solo se cambia la modalità markdown/plain).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // In Ibrida NON usiamo oneDark: il tema "documento" di livePreview controlla
    // sfondo/colori. In Codice usiamo oneDark pieno (sfondo + syntax highlight).
    const liveMode = markdownMode && livePreviewMode
    const extensions = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.lineWrapping,
      liveMode ? [] : oneDark,
      // In Ibrida: evidenzia solo il codice nei blocchi, non il markdown.
      liveMode ? syntaxHighlighting(codeHighlightStyle) : [],
      baseTheme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !settingExternally.current) {
          onChangeRef.current(u.state.doc.toString())
        }
      }),
    ]
    if (markdownMode) extensions.push(markdown({ extensions: GFM, codeLanguages: languages }))
    if (liveMode) {
      extensions.push(livePreview(fileDir, (name) => onWikilinkRef.current?.(name)))
      extensions.push(tableEditor()) // tabelle vere, editabili, stile Obsidian
    }

    const v = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host,
    })
    view.current = v
    if (viewRef) viewRef.current = v

    return () => {
      v.destroy()
      view.current = null
      if (viewRef) viewRef.current = null
    }
    // `value` volutamente escluso: il valore iniziale basta alla creazione,
    // gli aggiornamenti successivi sono gestiti dall'effetto sotto. L'editor si
    // ricrea quando cambia la modalità o la cartella del file (per le immagini).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdownMode, livePreviewMode, fileDir])

  // Applica i cambi esterni di `value` (es. caricamento di un nuovo file).
  useEffect(() => {
    const v = view.current
    if (!v) return
    const cur = v.state.doc.toString()
    if (value !== cur) {
      settingExternally.current = true
      v.dispatch({ changes: { from: 0, to: cur.length, insert: value } })
      settingExternally.current = false
    }
  }, [value])

  // ---- Comandi del menu contestuale (operano sull'EditorView corrente) ----

  // Avvolge la selezione in marcatori (o li inserisce col cursore in mezzo).
  function wrapSel(before: string, after: string) {
    const v = view.current
    if (!v) return
    const { from, to } = v.state.selection.main
    const sel = v.state.sliceDoc(from, to)
    v.dispatch({
      changes: { from, to, insert: before + sel + after },
      selection: sel
        ? { anchor: from + before.length, head: from + before.length + sel.length }
        : { anchor: from + before.length },
    })
    v.focus()
  }

  // Link markdown [testo](url): cursore nelle () se c'è selezione, nelle [] se no.
  function addMdLink() {
    const v = view.current
    if (!v) return
    const { from, to } = v.state.selection.main
    const sel = v.state.sliceDoc(from, to)
    const insert = `[${sel}]()`
    v.dispatch({
      changes: { from, to, insert },
      selection: { anchor: sel ? from + insert.length - 1 : from + 1 },
    })
    v.focus()
  }

  // Prefissa (o togglie) ogni riga selezionata: liste, citazioni, attività.
  function prefixLines(prefix: string) {
    const v = view.current
    if (!v) return
    const { state } = v
    const range = state.selection.main
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    const changes = []
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n)
      if (line.text.startsWith(prefix)) changes.push({ from: line.from, to: line.from + prefix.length, insert: '' })
      else changes.push({ from: line.from, insert: prefix })
    }
    v.dispatch({ changes })
    v.focus()
  }

  // Imposta/toglie il titolo di livello dato sulle righe selezionate.
  function setHeading(level: number) {
    const v = view.current
    if (!v) return
    const { state } = v
    const range = state.selection.main
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    const target = '#'.repeat(level) + ' '
    const changes = []
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n)
      const m = /^(#{1,6})\s+/.exec(line.text)
      if (m && m[1].length === level) changes.push({ from: line.from, to: line.from + m[0].length, insert: '' })
      else if (m) changes.push({ from: line.from, to: line.from + m[0].length, insert: target })
      else changes.push({ from: line.from, insert: target })
    }
    v.dispatch({ changes })
    v.focus()
  }

  // Inserisce un blocco su una riga nuova dopo quella corrente.
  function insertBlock(text: string, cursorOffset: number) {
    const v = view.current
    if (!v) return
    const line = v.state.doc.lineAt(v.state.selection.main.to)
    const nl = line.text.trim() ? '\n' : ''
    v.dispatch({
      changes: { from: line.to, insert: nl + text },
      selection: { anchor: line.to + nl.length + cursorOffset },
    })
    v.focus()
  }

  async function doCopy(cut: boolean) {
    const v = view.current
    if (!v) return
    const { from, to } = v.state.selection.main
    if (from === to) return
    try {
      await navigator.clipboard.writeText(v.state.sliceDoc(from, to))
      if (cut) v.dispatch({ changes: { from, to, insert: '' } })
    } catch (e) {
      console.error('Appunti non disponibili:', e)
    }
    v.focus()
  }

  async function doPaste() {
    const v = view.current
    if (!v) return
    try {
      const text = await navigator.clipboard.readText()
      const { from, to } = v.state.selection.main
      v.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } })
    } catch (e) {
      console.error('Lettura appunti non permessa (usa Ctrl+V):', e)
    }
    v.focus()
  }

  function selectAll() {
    const v = view.current
    if (!v) return
    v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } })
    v.focus()
  }

  const ctxItems = (hasSel: boolean): CtxItem[] => [
    { label: '🔗 Aggiungi collegamento', action: () => wrapSel('[[', ']]') },
    { label: '↗ Aggiungi link', action: addMdLink },
    { label: '', separator: true },
    {
      label: 'Formattazione',
      children: [
        { label: 'Grassetto', action: () => wrapSel('**', '**') },
        { label: 'Corsivo', action: () => wrapSel('*', '*') },
        { label: 'Barrato', action: () => wrapSel('~~', '~~') },
        { label: 'Evidenziato', action: () => wrapSel('==', '==') },
        { label: 'Codice', action: () => wrapSel('`', '`') },
      ],
    },
    {
      label: 'Paragrafo',
      children: [
        { label: 'Titolo 1', action: () => setHeading(1) },
        { label: 'Titolo 2', action: () => setHeading(2) },
        { label: 'Titolo 3', action: () => setHeading(3) },
        { label: 'Elenco puntato', action: () => prefixLines('- ') },
        { label: 'Elenco numerato', action: () => prefixLines('1. ') },
        { label: 'Attività', action: () => prefixLines('- [ ] ') },
        { label: 'Citazione', action: () => prefixLines('> ') },
      ],
    },
    {
      label: 'Inserisci',
      children: [
        {
          label: 'Tabella',
          action: () => insertBlock('| Colonna 1 | Colonna 2 |\n| --- | --- |\n|  |  |', 2),
        },
        { label: 'Blocco codice', action: () => insertBlock('```\n\n```', 4) },
        { label: 'Callout', action: () => insertBlock('> [!nota] Titolo\n> Testo', 10) },
        { label: 'Riga orizzontale', action: () => insertBlock('---', 3) },
      ],
    },
    { label: '', separator: true },
    { label: '✂ Taglia', disabled: !hasSel, action: () => doCopy(true) },
    { label: '⧉ Copia', disabled: !hasSel, action: () => doCopy(false) },
    { label: '⎘ Incolla', action: doPaste },
    { label: '⬚ Seleziona tutto', action: selectAll },
  ]

  return (
    <div
      ref={hostRef}
      className="flex-1 overflow-hidden"
      onContextMenu={(e) => {
        if (!markdownMode) return // nei file non-md resta il menu nativo
        e.preventDefault()
        const v = view.current
        const { from, to } = v ? v.state.selection.main : { from: 0, to: 0 }
        setCtxMenu({ x: e.clientX, y: e.clientY, hasSel: from !== to })
      }}
    >
      {ctxMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onMouseDown={() => setCtxMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setCtxMenu(null)
            }}
          />
          <div
            className="fixed z-50"
            style={{
              left: Math.min(ctxMenu.x, window.innerWidth - 230),
              top: Math.min(ctxMenu.y, window.innerHeight - 420),
            }}
          >
            <CtxMenuList items={ctxItems(ctxMenu.hasSel)} onClose={() => setCtxMenu(null)} />
          </div>
        </>
      )}
    </div>
  )
}
